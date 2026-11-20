import defaultQuestions from './default-pool.json' with { type: 'json' };
import { readQuizSettings } from './quiz-settings.mjs';
import { del, get, list, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

const PREFIX = 'bankshield/pools/';
const DEFAULT_POOL_PATH = `${PREFIX}default.json`;
const DEFAULT_POOL_DISABLED_PATH = `${PREFIX}default-disabled.json`;
const TYPES = new Set(['single', 'multi', 'match', 'order', 'diff', 'tabletop', 'branch']);
const MAX_QUESTIONS = 93;

const isText = value => typeof value === 'string' && value.trim().length > 0;
const isIndex = (value, length) => Number.isInteger(value) && value >= 0 && value < length;
const isIndexArray = (value, length, countMin = 1) => Array.isArray(value) && value.length >= countMin && value.every(i => isIndex(i, length)) && new Set(value).size === value.length;

function validateQuestion(q, row, errors) {
  const fail = message => errors.push(`Question row ${row}: ${message}`);
  if (!q || typeof q !== 'object' || Array.isArray(q)) return fail('must be a JSON object.');
  if (!(Number.isInteger(q.id) || isText(q.id))) fail('id must be a non-empty string or integer.');
  if (!isText(q.topic)) fail('topic is required.');
  if (!TYPES.has(q.type)) return fail(`type must be one of ${[...TYPES].join(', ')}.`);
  if (!isText(q.prompt)) fail('prompt is required.');
  if (!isText(q.explanation)) fail('explanation is required.');
  if (!isText(q.difficulty)) fail('difficulty is required.');
  if (!isText(q.formatLabel)) fail('formatLabel is required.');
  const options = q.options;
  if (['single', 'multi', 'order', 'diff', 'tabletop'].includes(q.type) && (!Array.isArray(options) || options.length < 2 || !options.every(isText))) fail('options must contain at least two non-empty strings.');
  if (q.type === 'single' && !isIndex(q.answer, options?.length || 0)) fail('answer must be the zero-based index of one option.');
  if (['multi', 'diff', 'tabletop'].includes(q.type) && !isIndexArray(q.answer, options?.length || 0)) fail('answer must be a non-empty array of unique zero-based option indexes.');
  if (q.type === 'order' && (!Array.isArray(q.answer) || q.answer.length !== options?.length || !q.answer.every(i => isIndex(i, options.length)) || new Set(q.answer).size !== options.length)) fail('answer must list every option index once, in the correct order.');
  if (q.type === 'match') {
    if (!Array.isArray(q.left) || !q.left.length || !q.left.every(isText) || !Array.isArray(q.right) || q.right.length !== q.left.length || !q.right.every(isText)) fail('left and right must be non-empty string arrays of equal length.');
    if (!Array.isArray(q.answer) || q.answer.length !== q.left?.length || !q.answer.every(i => isIndex(i, q.right?.length || 0)) || new Set(q.answer).size !== q.answer.length) fail('answer must map each left item to a valid right-side index.');
  }
  if (q.type === 'diff') {
    if (!q.evidence || typeof q.evidence !== 'object' || !q.evidence.a || !q.evidence.b || typeof q.evidence.a !== 'object' || typeof q.evidence.b !== 'object') fail('evidence must contain objects named a and b.');
  }
  if (q.type === 'branch') {
    if (!Array.isArray(q.nodes) || !q.nodes.length) return fail('nodes must be a non-empty array.');
    const ids = new Set(q.nodes.map(n => n?.id));
    if (ids.size !== q.nodes.length || !ids.has('s1')) fail('nodes must have unique ids and include the starting node s1.');
    for (const node of q.nodes) {
      if (!isText(node?.id) || !isText(node?.prompt) || !Array.isArray(node?.options) || node.options.length < 2 || !Number.isInteger(node?.answer) || !isIndex(node.answer, node.options.length)) fail(`node ${node?.id || '(unnamed)'} needs an id, prompt, choices, and a valid answer index.`);
      for (const option of (Array.isArray(node?.options) ? node.options : [])) if (!isText(option?.text) || !(option?.next === 'END' || ids.has(option?.next))) fail(`node ${node.id || '(unnamed)'} has an invalid choice or next-node reference.`);
    }
    const walk = (id, depth, seen) => {
      if (depth > 3 || seen.has(id)) return false;
      const node = q.nodes.find(n => n?.id === id);
      if (!node || !Array.isArray(node.options)) return false;
      const nextSeen = new Set(seen).add(id);
      return node.options.every(option => option && (option.next === 'END' ? depth === 3 : depth < 3 && walk(option.next, depth + 1, nextSeen)));
    };
    if (ids.has('s1') && !walk('s1', 1, new Set())) fail('every branch path must have three decisions, then end with END.');
  }
}

export function validatePool(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: ['The file root must be a JSON object.'] };
  if (!isText(input.name) || input.name.length > 100) errors.push('name must be 1 to 100 characters.');
  if (!Array.isArray(input.questions) || input.questions.length < 5 || input.questions.length > 2000) errors.push('questions must contain 5 to 2,000 entries.');
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const ids = new Set();
  questions.forEach((q, i) => {
    validateQuestion(q, i + 1, errors);
    if (q && (Number.isInteger(q.id) || isText(q.id))) { const key = String(q.id); if (ids.has(key)) errors.push(`Question row ${i + 1}: id ${key} is duplicated.`); ids.add(key); }
  });
  const questionCount = input.questionCount === undefined ? Math.min(25, questions.length) : input.questionCount;
  const timeLimitMinutes = input.timeLimitMinutes === undefined ? 15 : input.timeLimitMinutes;
  if (!Number.isInteger(questionCount) || questionCount < 5 || questionCount > MAX_QUESTIONS || questionCount > questions.length) errors.push(`questionCount must be 5 to ${Math.min(MAX_QUESTIONS, questions.length)}.`);
  if (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1 || timeLimitMinutes > 180) errors.push('timeLimitMinutes must be between 1 and 180.');
  return { errors, pool: errors.length ? null : { name: input.name.trim(), questionCount, timeLimitMinutes, questions } };
}

export async function savePool(input) {
  const result = validatePool(input);
  if (result.errors.length) throw Object.assign(new Error('Question pool validation failed.'), { status: 400, details: result.errors });
  const id = randomUUID();
  const pool = { id, ...result.pool, uploadedAt: new Date().toISOString() };
  await put(`${PREFIX}${id}.json`, JSON.stringify(pool), { access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false });
  return pool;
}

export async function updatePool(id, input) {
  if (id !== 'default' && !/^[a-f0-9-]{36}$/i.test(id || '')) throw Object.assign(new Error('Question pool not found.'), { status: 404 });
  if (id !== 'default') {
    const existing = await get(`${PREFIX}${id}.json`, { access: 'private' });
    if (!existing) throw Object.assign(new Error('Question pool not found.'), { status: 404 });
  }
  const result = validatePool(input);
  if (result.errors.length) throw Object.assign(new Error('Question pool validation failed.'), { status: 400, details: result.errors });
  const pool = {
    id,
    name: id === 'default' ? 'BankShield standard pool' : result.pool.name,
    ...result.pool,
    id,
    updatedAt: new Date().toISOString(),
  };
  await put(id === 'default' ? DEFAULT_POOL_PATH : `${PREFIX}${id}.json`, JSON.stringify(pool), {
    access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false, allowOverwrite: true,
  });
  if (id === 'default') {
    const disabled = await get(DEFAULT_POOL_DISABLED_PATH, { access: 'private' });
    if (disabled) await del(disabled.url);
  }
  return pool;
}

export async function listPools() {
  const blobs = [];
  let cursor;
  do { const page = await list({ prefix: PREFIX, limit: 1000, cursor }); blobs.push(...page.blobs); cursor = page.hasMore ? page.cursor : undefined; } while (cursor);
  const custom = await Promise.all(blobs.map(async b => {
    const file = await get(b.pathname, { access: 'private' });
    if (!file) return null;
    const pool = JSON.parse(await new Response(file.stream).text());
    if (pool.id === 'default') return null;
    return { id: pool.id, name: pool.name, questionCount: pool.questionCount, timeLimitMinutes: pool.timeLimitMinutes, totalQuestions: pool.questions.length, topics: [...new Set(pool.questions.map(q => q.topic))] };
  }));
  const pool = await readPool('default');
  const standard = pool ? [{ id: 'default', name: pool.name, questionCount: pool.questionCount, timeLimitMinutes: pool.timeLimitMinutes, totalQuestions: pool.questions.length, topics: [...new Set(pool.questions.map(q => q.topic))] }] : [];
  return [...standard, ...custom.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))];
}

export async function readPool(id) {
  if (id === 'default') {
    if (await get(DEFAULT_POOL_DISABLED_PATH, { access: 'private' })) return null;
    const file = await get(DEFAULT_POOL_PATH, { access: 'private' });
    if (file) return JSON.parse(await new Response(file.stream).text());
    const settings = await readQuizSettings();
    return { id: 'default', name: 'BankShield standard pool', questionCount: settings.questionCount, timeLimitMinutes: settings.timeLimitMinutes, questions: defaultQuestions };
  }
  if (!/^[a-f0-9-]{36}$/i.test(id || '')) return null;
  const file = await get(`${PREFIX}${id}.json`, { access: 'private' });
  return file ? JSON.parse(await new Response(file.stream).text()) : null;
}

export async function deletePool(id) {
  if (id === 'default') {
    if (!(await readPool(id))) return false;
    await put(DEFAULT_POOL_DISABLED_PATH, JSON.stringify({ disabledAt: new Date().toISOString() }), {
      access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false, allowOverwrite: true,
    });
    return true;
  }
  if (!/^[a-f0-9-]{36}$/i.test(id || '')) return false;
  const file = await get(`${PREFIX}${id}.json`, { access: 'private' });
  if (!file) return false;
  await del(file.url);
  return true;
}
