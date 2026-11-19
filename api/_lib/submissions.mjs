import { del, get, list, put } from '@vercel/blob';

const PREFIX = 'bankshield/submissions/';

export function validSubmission(r) {
  return r && typeof r === 'object' && typeof r.submissionId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(r.submissionId) &&
    ['name', 'department', 'branch', 'email'].every(k => typeof r[k] === 'string' && r[k].trim().length > 0 && r[k].length <= 200) &&
    typeof r.testId === 'string' && typeof r.poolId === 'string' && typeof r.testCategory === 'string' &&
    typeof r.startedAt === 'string' && Number.isFinite(Date.parse(r.startedAt)) &&
    typeof r.completedAt === 'string' && Number.isFinite(Date.parse(r.completedAt)) &&
    Number.isInteger(r.durationSeconds) && r.durationSeconds >= 0 && r.durationSeconds <= 86400 &&
    typeof r.timedOut === 'boolean' && Array.isArray(r.responses) && r.responses.length >= 5 && r.responses.length <= 93 &&
    r.responses.every(x => x && (Number.isInteger(x.questionId) || (typeof x.questionId === 'string' && x.questionId.length > 0 && x.questionId.length <= 100)) && typeof x.answerRaw === 'string' && x.answerRaw.length <= 20000);
}

export async function saveSubmission(record) {
  await put(`${PREFIX}${record.submissionId}.json`, JSON.stringify(record), {
    access: 'private',
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false,
  });
}

async function allBlobs() {
  const found = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, limit: 1000, cursor });
    found.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return found;
}

export async function getSubmissions() {
  const blobs = await allBlobs();
  return Promise.all(blobs.map(async blob => {
    const file = await get(blob.pathname, { access: 'private' });
    if (!file) return null;
    return JSON.parse(await new Response(file.stream).text());
  })).then(records => records.filter(Boolean).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)));
}

export async function clearSubmissions() {
  const blobs = await allBlobs();
  if (blobs.length) await del(blobs.map(blob => blob.url));
}
