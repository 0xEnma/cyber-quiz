import { get, list, put, del } from '@vercel/blob';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readPool } from './pools.mjs';

const PREFIX = 'bankshield/tests/';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function publicQuestion(question) {
  const { answer, explanation, keywords, sample, ...visible } = question;
  if (Array.isArray(visible.nodes)) {
    visible.nodes = visible.nodes.map(({ answer: nodeAnswer, ...node }) => node);
  }
  return visible;
}

function accessTicket(testId) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET must be configured.');
  const payload = Buffer.from(JSON.stringify({ testId })).toString('base64url');
  const signature = createHmac('sha256', secret).update('bankshield-test:' + payload).digest('base64url');
  return payload + '.' + signature;
}

function verifyTicket(ticket) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || typeof ticket !== 'string') return null;
  const [payload, provided] = ticket.split('.');
  if (!payload || !provided) return null;
  const expected = createHmac('sha256', secret).update('bankshield-test:' + payload).digest('base64url');
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return /^[a-f0-9-]{36}$/i.test(data.testId) ? data.testId : null; }
  catch { return null; }
}

function newAccessCode() {
  return [...randomBytes(16)].map(byte => CODE_ALPHABET[byte & 31]).join('');
}

async function allTests() {
  const blobs = []; let cursor;
  do { const page = await list({ prefix: PREFIX, limit: 1000, cursor }); blobs.push(...page.blobs); cursor = page.hasMore ? page.cursor : undefined; } while (cursor);
  return Promise.all(blobs.map(async blob => {
    const file = await get(blob.pathname, { access: 'private' });
    return file ? { blob, test: JSON.parse(await new Response(file.stream).text()) } : null;
  })).then(rows => rows.filter(Boolean));
}

export async function listTests() {
  const rows = await allTests();
  return rows.map(({ test }) => { const { accessCode, poolSnapshot, ...safe } = test; return { ...safe, accessTicket: accessTicket(test.id) }; }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function createTest(input) {
  const poolId = typeof input?.poolId === 'string' ? input.poolId : '';
  const pool = await readPool(poolId);
  if (!pool) throw Object.assign(new Error('Choose an available question pool.'), { status: 400 });
  const questionCount = Number(input?.questionCount ?? pool.questionCount);
  const timeLimitMinutes = Number(input?.timeLimitMinutes ?? pool.timeLimitMinutes);
  if (!Number.isInteger(questionCount) || questionCount < 5 || questionCount > 93 || questionCount > pool.questions.length) {
    throw Object.assign(new Error(`Question count must be 5 to ${Math.min(93, pool.questions.length)} for this pool.`), { status: 400 });
  }
  if (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1 || timeLimitMinutes > 180) {
    throw Object.assign(new Error('Time limit must be between 1 and 180 minutes.'), { status: 400 });
  }
  let accessCode, pathname;
  for (let attempt = 0; attempt < 5; attempt++) {
    accessCode = newAccessCode(); pathname = `${PREFIX}${accessCode}.json`;
    if (!await get(pathname, { access: 'private' })) break;
    if (attempt === 4) throw new Error('Could not generate a unique access code. Try again.');
  }
  const poolSnapshot = { id: pool.id, name: pool.name, questions: pool.questions };
  const test = { id: randomUUID(), poolId, poolName: pool.name, questionCount, timeLimitMinutes, accessCode, poolSnapshot, createdAt: new Date().toISOString() };
  await put(pathname, JSON.stringify(test), { access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false });
  const { accessCode: _storedAccessCode, ...safe } = test;
  return { ...safe, accessTicket: accessTicket(test.id) };
}

export async function readTestById(id) {
  if (!id) return null;
  const row = (await allTests()).find(entry => entry.test.id === id);
  return row?.test || null;
}

async function snapshotPoolForTest(test, pool) {
  if (test.poolSnapshot) return test.poolSnapshot;
  const snapshot = { id: pool.id, name: pool.name, questions: pool.questions };
  test.poolSnapshot = snapshot;
  if (test.accessCode) {
    await put(`${PREFIX}${test.accessCode}.json`, JSON.stringify(test), {
      access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false, allowOverwrite: true,
    });
  }
  return snapshot;
}

export async function resolveTicket(ticket) {
  const testId = verifyTicket(ticket);
  if (!testId) return null;
  const test = await readTestById(testId);
  if (!test) return null;
  const currentPool = test.poolSnapshot || await readPool(test.poolId);
  if (!currentPool) return null;
  const pool = await snapshotPoolForTest(test, currentPool);
  return {
    test: { id: test.id, poolId: test.poolId, questionCount: test.questionCount, timeLimitMinutes: test.timeLimitMinutes },
    pool: { id: pool.id, name: pool.name, questions: pool.questions.map(publicQuestion) },
  };
}

export async function resolveTicketSummary(ticket) {
  const testId = verifyTicket(ticket);
  if (!testId) return null;
  const test = await readTestById(testId);
  if (!test) return null;
  const currentPool = test.poolSnapshot || await readPool(test.poolId);
  if (!currentPool) return null;
  const pool = await snapshotPoolForTest(test, currentPool);
  const topics = [...new Set(pool.questions.map(question => question.topic))];
  const available = topics.map(topic => pool.questions.filter(question => question.topic === topic).length);
  const allocated = topics.map(() => 0);
  const standardTopics = ['Customer identity & privacy', 'Phishing & suspicious emails', 'Incident reporting & evidence care', 'Compliance & customer verification', 'Phone calls & social engineering', 'Customer-reported fraud & alerts', 'Email details & header checks', 'Payment instructions & record keeping', 'Branch & physical security', 'Passwords, devices & safe access'];
  const weights = [4, 4, 3, 3, 3, 2, 2, 2, 1, 1];
  for (let i = 0; i < test.questionCount; i++) {
    let pick = -1, priority = -1;
    topics.forEach((topic, index) => {
      const known = standardTopics.indexOf(topic);
      const weight = known < 0 ? 1 : weights[known];
      const score = weight / (allocated[index] + 1);
      if (allocated[index] < available[index] && score > priority) { pick = index; priority = score; }
    });
    if (pick < 0) break;
    allocated[pick]++;
  }
  return {
    test: { id: test.id, poolId: test.poolId, questionCount: test.questionCount, timeLimitMinutes: test.timeLimitMinutes },
    pool: { id: pool.id, name: pool.name, totalQuestions: pool.questions.length, coverage: topics.map((topic, index) => ({ topic, count: allocated[index] })).filter(item => item.count > 0) },
  };
}

export async function deleteTest(id) {
  const rows = await allTests();
  const match = rows.find(row => row.test.id === id);
  if (!match) return false;
  await del(match.blob.url);
  return true;
}

export async function testsForPool(poolId) {
  return (await allTests()).map(row => row.test).filter(test => test.poolId === poolId);
}

export async function snapshotTestsForPool(poolId) {
  const tests = await testsForPool(poolId);
  const pool = tests.some(test => !test.poolSnapshot) ? await readPool(poolId) : null;
  if (!pool && tests.some(test => !test.poolSnapshot)) {
    throw new Error('This pool is needed by an older test link and could not be loaded. Revoke that link before removing the pool.');
  }
  for (const test of tests) {
    if (!test.poolSnapshot) await snapshotPoolForTest(test, pool);
  }
  return tests.length;
}
