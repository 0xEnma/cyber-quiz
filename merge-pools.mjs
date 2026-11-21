#!/usr/bin/env node
// merge-pools.mjs - merge BankShield question-pool JSON parts into one import file.
//
// Usage:
//   node merge-pools.mjs part1.json part2.json part3.json [options]
//
// Part 1 is the full pool: { "name", "questionCount", "timeLimitMinutes", "questions": [...] }.
// Later parts only need the questions: a bare array [ {...}, {...} ], or any object
// that has a "questions" array (other keys are ignored). Also accepted: a fragment
// starting with "questions": [...], or question objects separated by commas.
//
// Options:
//   -o, --out <file>     Output file (default: merged-question-pool.json)
//   --count <n>          questionCount per candidate attempt (default: from part 1)
//   --time <minutes>     timeLimitMinutes (default: from part 1)
//   --skip-invalid       Drop invalid questions with a warning instead of aborting
//   --keep-newlines      Keep line breaks inside question text (default: joined with a space)
//   -h, --help           Show this help
//
// The quiz name, questionCount and timeLimitMinutes come from the FIRST part.
// Questions keep file order and are renumbered 1..N. Exact duplicates are skipped.
// Common AI-output problems are repaired automatically (and reported): ```json
// fences, raw line breaks inside strings, trailing commas, missing closing brackets.
// Requires Node 18+, no dependencies.

import { readFileSync, writeFileSync } from 'node:fs';

const TYPES = ['single', 'multi', 'match', 'order', 'diff', 'tabletop', 'branch'];
const DIFFS = ['Basic', 'Intermediate', 'Advanced'];
const REQUIRED = ['id', 'topic', 'type', 'prompt', 'explanation', 'difficulty', 'formatLabel'];

// ---------------------------------------------------------------- arguments
const files = [];
const opt = { out: 'merged-question-pool.json', skipInvalid: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-h' || a === '--help') usage(0);
  else if (a === '-o' || a === '--out') opt.out = argv[++i];
  else if (a === '--count') opt.count = Number(argv[++i]);
  else if (a === '--time') opt.time = Number(argv[++i]);
  else if (a === '--skip-invalid') opt.skipInvalid = true;
  else if (a === '--keep-newlines') opt.keepNewlines = true;
  else if (a.startsWith('-')) { console.error(`Unknown option: ${a}`); usage(1); }
  else files.push(a);
}
if (!files.length) usage(1);
function usage(code) {
  const lines = readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1);
  const doc = [];
  for (const l of lines) { if (!l.startsWith('//')) break; doc.push(l.replace(/^\/\/ ?/, '')); }
  (code ? console.error : console.log)(doc.join('\n'));
  process.exit(code);
}

// ---------------------------------------------------------------- helpers
const isIdx = (n, len) => Number.isInteger(n) && n >= 0 && n < len;
const isStr = s => typeof s === 'string' && s.trim() !== '';
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function fail(msg) { console.error('ERROR: ' + msg); process.exit(1); }

// ---------------------------------------------------------------- tolerant JSON loading
// Fixes raw control characters inside strings, trailing commas and unclosed brackets.
function repairJson(src, notes) {
  const out = [];
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { out.push(c); esc = false; continue; }
      if (c === '\\') { out.push(c); esc = true; continue; }
      if (c === '"') { out.push(c); inStr = false; continue; }
      if (c === '\r' || c === '\n') {
        // A raw line break inside a string is a soft wrap (copy/paste artefact): join with one space.
        while (out.length && out[out.length - 1] === ' ') out.pop();
        out.push(' ');
        while (i + 1 < src.length && /[ \t\r\n]/.test(src[i + 1])) i++;
        notes.breaks++;
        continue;
      }
      if (c === '\t') { out.push(' '); notes.breaks++; continue; }
      if (c < ' ') { out.push('\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')); notes.breaks++; continue; }
      out.push(c);
      continue;
    }
    if (c === '"') { inStr = true; out.push(c); continue; }
    if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); out.push(c); continue; }
    if (c === '}' || c === ']') {
      dropTrailingComma(out, notes);
      if (stack[stack.length - 1] === c) stack.pop();
      out.push(c);
      continue;
    }
    out.push(c);
  }
  if (inStr) { out.push('"'); notes.cut = true; }
  if (stack.length) {
    dropTrailingComma(out, notes);
    notes.closed += stack.length;
    notes.cut = true;
    while (stack.length) out.push(stack.pop());
  }
  return out.join('');
}
function dropTrailingComma(out, notes) {
  let j = out.length - 1;
  while (j >= 0 && /^\s$/.test(out[j])) j--;
  if (j >= 0 && out[j] === ',') { out.splice(j, 1); notes.commas++; }
}

const shapeOk = d => Array.isArray(d) || (isObj(d) && Array.isArray(d.questions));

function loadPart(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { fail(`${file}: cannot read file (${e.code || e.message})`); }
  const text = raw.replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const candidates = [text];
  if (/^"questions"\s*:/.test(text)) candidates.push('{' + text + '}');
  if (text.startsWith('{')) candidates.push('[' + text + ']');
  let firstError = null;
  for (const c of candidates) {
    try { const d = JSON.parse(c); if (shapeOk(d)) return wrap(file, d, null); } catch (e) { firstError ??= e; }
    const notes = { breaks: 0, commas: 0, closed: 0, cut: false };
    try { const d = JSON.parse(repairJson(c, notes)); if (shapeOk(d)) return wrap(file, d, notes); } catch (e) { firstError ??= e; }
  }
  fail(`${file}: could not read a question list (${firstError ? firstError.message : 'unrecognised structure'}). ` +
       'The file may be truncated mid-question; check its end.');
}
function wrap(file, data, notes) {
  if (notes && (notes.breaks || notes.commas || notes.closed)) {
    const bits = [];
    if (notes.breaks) bits.push(`${notes.breaks} wrapped line break(s) inside strings joined with a space`);
    if (notes.commas) bits.push(`${notes.commas} trailing comma(s) removed`);
    if (notes.closed) bits.push(`${notes.closed} missing closing bracket(s) added - the file looked cut off, so check its last question`);
    console.warn(`REPAIRED ${file}: ${bits.join('; ')}.`);
  }
  return Array.isArray(data)
    ? { file, root: null, questions: data }
    : { file, root: data, questions: data.questions };
}

// ---------------------------------------------------------------- validation
function checkAnswerSet(q, errs) {
  const a = q.answer;
  if (!Array.isArray(q.options) || q.options.length < 2 || !q.options.every(isStr)) return errs.push('options must be an array of at least 2 strings');
  if (!Array.isArray(a) || !a.length || !a.every(x => isIdx(x, q.options.length)) || new Set(a).size !== a.length)
    errs.push('answer must be a non-empty array of distinct valid option indexes');
}

function validate(q) {
  const errs = [];
  if (!isObj(q)) return ['question is not an object'];
  for (const k of REQUIRED) if (q[k] === undefined || q[k] === null || q[k] === '') errs.push(`missing "${k}"`);
  if (!TYPES.includes(q.type)) errs.push(`invalid type "${q.type}"`);
  if (!DIFFS.includes(q.difficulty)) errs.push(`invalid difficulty "${q.difficulty}"`);
  if (errs.length) return errs;
  switch (q.type) {
    case 'single':
      if (!Array.isArray(q.options) || q.options.length < 2 || !q.options.every(isStr)) errs.push('options must be an array of at least 2 strings');
      else if (!isIdx(q.answer, q.options.length)) errs.push('answer must be one valid option index');
      break;
    case 'multi': case 'tabletop': checkAnswerSet(q, errs); break;
    case 'diff':
      checkAnswerSet(q, errs);
      if (!isObj(q.evidence) || !isObj(q.evidence.a) || !isObj(q.evidence.b) ||
          !Object.keys(q.evidence.a).length || !Object.keys(q.evidence.b).length) errs.push('evidence needs non-empty objects "a" and "b"');
      break;
    case 'match':
      if (!Array.isArray(q.left) || !Array.isArray(q.right) || q.left.length < 2 || q.left.length !== q.right.length) errs.push('left and right must be equal-length arrays (min 2)');
      else if (!Array.isArray(q.answer) || q.answer.length !== q.left.length ||
               !q.answer.every(x => isIdx(x, q.right.length)) || new Set(q.answer).size !== q.answer.length)
        errs.push('answer needs one distinct right-side index per left item');
      break;
    case 'order':
      if (!Array.isArray(q.options) || q.options.length < 2) errs.push('options must be an array of at least 2 steps');
      else if (!Array.isArray(q.answer) || q.answer.length !== q.options.length ||
               [...q.answer].sort((x, y) => x - y).some((x, i) => x !== i)) errs.push('answer must use every option index exactly once');
      break;
    case 'branch': validateBranch(q, errs); break;
  }
  return errs;
}

function validateBranch(q, errs) {
  if (!Array.isArray(q.nodes) || !q.nodes.length) return errs.push('nodes must be a non-empty array');
  const nodes = new Map();
  for (const n of q.nodes) {
    if (!isObj(n) || !isStr(n.id) || !isStr(n.prompt)) return errs.push('every node needs "id" and "prompt"');
    if (nodes.has(n.id)) return errs.push(`duplicate node id "${n.id}"`);
    if (!Array.isArray(n.options) || n.options.length < 2 || !n.options.every(o => isObj(o) && isStr(o.text) && isStr(o.next)))
      return errs.push(`node "${n.id}": options need "text" and "next"`);
    if (!isIdx(n.answer, n.options.length)) return errs.push(`node "${n.id}": answer index out of range`);
    nodes.set(n.id, n);
  }
  if (!nodes.has('s1')) return errs.push('missing start node "s1"');
  const depths = new Set();
  const walk = (id, depth, stack) => {
    if (stack.has(id)) return errs.push(`cycle at node "${id}"`);
    const n = nodes.get(id);
    if (!n) return errs.push(`unknown node "${id}"`);
    for (const o of n.options) {
      if (o.next === 'END') depths.add(depth + 1);
      else walk(o.next, depth + 1, new Set([...stack, id]));
      if (errs.length) return;
    }
  };
  walk('s1', 0, new Set());
  if (!errs.length && !(depths.size === 1 && depths.has(3))) errs.push(`every path must have exactly 3 decisions (found ${[...depths].join(', ')})`);
}

function fingerprint(q) {
  return norm([q.prompt, ...(q.options || []), ...(q.left || []), ...(q.right || []),
    q.evidence ? JSON.stringify(q.evidence) : '', q.nodes ? q.nodes.map(n => n.prompt).join(' ') : ''].join(' | '));
}

// ---------------------------------------------------------------- merge
const parts = files.map(loadPart);
const first = parts[0].root;
if (!first) fail(`${parts[0].file}: the FIRST part must be the full pool (an object with "name", "questionCount", "timeLimitMinutes" and "questions"), not a bare array.`);
if (!isStr(first.name)) fail(`${parts[0].file}: the first part needs a "name" - it becomes the merged quiz title.`);

const out = [];
const seen = new Map();
const topicCase = new Map();
const stats = [];
let problems = 0;
let joined = 0;
// AI output often hard-wraps text with \n; join those line breaks with a space.
const clean = v => {
  if (typeof v === 'string') { const t = v.replace(/[ \t]*\r?\n[ \t]*/g, ' '); if (t !== v) joined++; return t; }
  if (Array.isArray(v)) return v.map(clean);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
  return v;
};

for (const part of parts) {
  const s = { file: part.file, read: part.questions.length, kept: 0, dup: 0, invalid: 0 };
  part.questions.forEach((rawQ, i) => {
    const q = opt.keepNewlines ? rawQ : clean(rawQ);
    const errs = validate(q);
    const label = `${part.file} question #${i + 1}${q && q.id !== undefined ? ` (id ${q.id})` : ''}`;
    if (errs.length) {
      problems++; s.invalid++;
      console.error(`${opt.skipInvalid ? 'SKIPPED' : 'INVALID'}: ${label}: ${errs.join('; ')}`);
      return;
    }
    const fp = fingerprint(q);
    if (seen.has(fp)) {
      s.dup++;
      console.warn(`DUPLICATE skipped: ${label} repeats ${seen.get(fp)}`);
      return;
    }
    seen.set(fp, label);
    const topic = q.topic.replace(/\s+/g, ' ').trim();
    const key = topic.toLowerCase();
    if (!topicCase.has(key)) topicCase.set(key, topic);
    out.push({ ...q, id: out.length + 1, topic: topicCase.get(key) });
    s.kept++;
  });
  stats.push(s);
}

if (problems && !opt.skipInvalid) fail(`${problems} invalid question(s). Fix them or re-run with --skip-invalid.`);
if (out.length < 5) fail(`only ${out.length} usable question(s); a pool needs at least 5`);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
const pick = (cli, fromFirst, dflt) => Number.isFinite(cli) ? cli : (Number.isFinite(fromFirst) ? fromFirst : dflt);
const merged = {
  name: first.name.trim(),
  questionCount: clamp(pick(opt.count, first.questionCount, 25), 5, Math.min(93, out.length)),
  timeLimitMinutes: clamp(pick(opt.time, first.timeLimitMinutes, 15), 1, 180),
  questions: out
};

const text = JSON.stringify(merged, null, 2);
JSON.parse(text);
writeFileSync(opt.out, text, 'utf8');

// ---------------------------------------------------------------- report
const tally = (arr, f) => arr.reduce((m, x) => (m[f(x)] = (m[f(x)] || 0) + 1, m), {});
console.log(`\nMerged ${files.length} part(s) -> ${opt.out}`);
console.log(`Title: ${merged.name}`);
for (const s of stats) console.log(`  ${s.file}: ${s.read} read, ${s.kept} kept, ${s.dup} duplicate, ${s.invalid} invalid`);
console.log(`Total: ${out.length} questions | per attempt: ${merged.questionCount} | time limit: ${merged.timeLimitMinutes} min`);
console.log('By type:      ', JSON.stringify(tally(out, q => q.type)));
console.log('By difficulty:', JSON.stringify(tally(out, q => q.difficulty)));
console.log('By topic:     ', JSON.stringify(tally(out, q => q.topic)));
const singles = out.filter(q => q.type === 'single');
if (singles.length >= 8) {
  const dist = tally(singles, q => q.answer);
  const top = Math.max(...Object.values(dist));
  if (top / singles.length > 0.5) console.warn(`WARNING: over half of single-choice answers use the same index (${JSON.stringify(dist)}). Consider shuffling.`);
}
if (joined) console.log(`NOTE: joined line breaks inside ${joined} text value(s) with a space (use --keep-newlines to keep them).`);
if (opt.count && opt.count > out.length) console.warn('NOTE: --count was reduced to fit the pool size.');
