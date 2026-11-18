import { createServer } from 'node:http';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const env = Object.fromEntries((await readFile(resolve(root, '.env.local'), 'utf8').catch(() => '')).split(/\r?\n/).filter(line => /^[A-Z0-9_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^(['"])(.*)\1$/, '$2')]; }));
let pin = env.ADMIN_PIN || '1234';
let pinVersion = 'initial';
const secret = env.ADMIN_SESSION_SECRET || randomBytes(32).toString('hex');

const defaultQuestions = JSON.parse(await readFile(resolve(root, 'api/_lib/default-pool.json'), 'utf8'));
const pools = new Map();
const tests = new Map();
const submissions = new Map();
let settings = { questionCount: 25, timeLimitMinutes: 15 };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, status, value, headers = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': typeof value === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 5_000_000) throw Object.assign(new Error('Request body is too large.'), { status: 413 }); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
function mac(scope, value) { return createHmac('sha256', secret).update(`${scope}:${value}`).digest('base64url'); }
function ticketFor(id) { const payload = Buffer.from(JSON.stringify({ testId: id })).toString('base64url'); return `${payload}.${mac('bankshield-test', payload)}`; }
function ticketId(value) {
  if (typeof value !== 'string') return null;
  const [payload, signature, extra] = value.split('.'); if (!payload || !signature || extra) return null;
  const expected = Buffer.from(mac('bankshield-test', payload)); const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { const id = JSON.parse(Buffer.from(payload, 'base64url').toString()).testId; return /^[a-f0-9-]{36}$/i.test(id) ? id : null; } catch { return null; }
}
function isAdmin(req) {
  const value = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('bankshield_admin='))?.slice('bankshield_admin='.length);
  if (!value) return false;
  const [expiresText, version, signature, extra] = value.split('.'); const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000) || !signature || extra || version !== pinVersion) return false;
  const a = Buffer.from(signature), b = Buffer.from(mac('bankshield-admin', `${expiresText}:${version}`));
  return a.length === b.length && timingSafeEqual(a, b);
}
function testSafe(test) { const { accessCode, ...safe } = test; return { ...safe, accessTicket: ticketFor(test.id) }; }
function poolRead(id) { return id === 'default' ? { id, name: 'BankShield standard pool', ...settings, questions: defaultQuestions } : pools.get(id) || null; }
function poolSummary(pool) { return { id: pool.id, name: pool.name, questionCount: pool.questionCount, timeLimitMinutes: pool.timeLimitMinutes, totalQuestions: pool.questions.length, topics: [...new Set(pool.questions.map(q => q.topic))] }; }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
    if (path.startsWith('/api/')) {
      if (path === '/api/admin/login' && req.method === 'POST') {
        const input = await body(req); if (input.pin !== pin) return send(res, 401, { error: 'Incorrect administrator PIN.' });
        const expires = String(Math.floor(Date.now() / 1000) + 8 * 60 * 60);
        const signature = mac('bankshield-admin', `${expires}:${pinVersion}`);
        return send(res, 200, { ok: true }, { 'Set-Cookie': `bankshield_admin=${expires}.${pinVersion}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
      }
      if (path === '/api/admin/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': 'bankshield_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      if (path === '/api/admin/change-pin' && req.method === 'POST') { if (!isAdmin(req)) return send(res, 401, { error: 'Administrator sign-in required.' }); const input = await body(req); if (input.currentPin !== pin) return send(res, 401, { error: 'Current PIN is incorrect.' }); if (typeof input.newPin !== 'string' || !/^\d{4,12}$/.test(input.newPin)) return send(res, 400, { error: 'New PIN must contain 4 to 12 digits.' }); if (input.newPin === pin) return send(res, 400, { error: 'Choose a PIN different from the current PIN.' }); pin = input.newPin; pinVersion = randomUUID(); return send(res, 200, { ok: true }, { 'Set-Cookie': 'bankshield_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }

      const protectedRoute = path === '/api/tests' || path === '/api/pools' || path.startsWith('/api/admin/');
      if (protectedRoute && !isAdmin(req)) return send(res, 401, { error: 'Administrator sign-in required.' });
      if (path === '/api/admin/settings' && req.method === 'GET') return send(res, 200, { ...settings, maxQuestions: 93 });
      if (path === '/api/admin/settings' && req.method === 'PUT') { const x = await body(req); if (!Number.isInteger(x.questionCount) || x.questionCount < 5 || x.questionCount > 93 || !Number.isInteger(x.timeLimitMinutes) || x.timeLimitMinutes < 1 || x.timeLimitMinutes > 180) return send(res, 400, { error: 'Invalid quiz settings.' }); settings = { questionCount: x.questionCount, timeLimitMinutes: x.timeLimitMinutes }; return send(res, 200, settings); }
      if (path === '/api/settings' && req.method === 'GET') return send(res, 200, { ...settings, maxQuestions: 93 });
      if (path === '/api/pools' && req.method === 'GET') return send(res, 200, [poolSummary({ id: 'default', name: 'BankShield standard pool', ...settings, questions: defaultQuestions }), ...[...pools.values()].map(poolSummary)]);
      if (path === '/api/pools' && req.method === 'POST') { const input = await body(req); if (typeof input.name !== 'string' || !Array.isArray(input.questions) || input.questions.length < 5) return send(res, 400, { error: 'Pool must include a name and at least five questions.' }); const id = randomUUID(); const pool = { id, name: input.name.trim(), questionCount: input.questionCount ?? Math.min(25, input.questions.length), timeLimitMinutes: input.timeLimitMinutes ?? 15, questions: input.questions }; pools.set(id, pool); return send(res, 201, poolSummary(pool)); }
      if (path === '/api/pools' && req.method === 'DELETE') { const id = url.searchParams.get('id'); if ([...tests.values()].some(test => test.poolId === id)) return send(res, 409, { error: 'Revoke tests using this pool first.' }); return send(res, pools.delete(id) ? 200 : 404, { ok: pools.has(id) }); }
      if (path === '/api/tests' && req.method === 'GET') return send(res, 200, [...tests.values()].map(testSafe).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      if (path === '/api/tests' && req.method === 'POST') { const input = await body(req); const pool = poolRead(input.poolId); if (!pool) return send(res, 400, { error: 'Choose an available question pool.' }); const questionCount = Number(input.questionCount), timeLimitMinutes = Number(input.timeLimitMinutes); if (!Number.isInteger(questionCount) || questionCount < 5 || questionCount > pool.questions.length || !Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1 || timeLimitMinutes > 180) return send(res, 400, { error: 'Invalid question count or time limit.' }); const id = randomUUID(); const accessCode = randomBytes(16).toString('hex').toUpperCase(); const test = { id, poolId: pool.id, poolName: pool.name, questionCount, timeLimitMinutes, accessCode, createdAt: new Date().toISOString() }; tests.set(id, test); return send(res, 201, testSafe(test)); }
      if (path === '/api/tests' && req.method === 'DELETE') return send(res, tests.delete(url.searchParams.get('id')) ? 200 : 404, { ok: true });
      if (path === '/api/test-access' && req.method === 'POST') { const id = ticketId((await body(req)).ticket); const test = id && tests.get(id); const pool = test && poolRead(test.poolId); if (!test || !pool) return send(res, 404, { error: 'That secure test link is invalid or inactive.' }); return send(res, 200, { test: { id: test.id, poolId: test.poolId, questionCount: test.questionCount, timeLimitMinutes: test.timeLimitMinutes }, pool: { id: pool.id, name: pool.name, questions: pool.questions } }); }
      if (path === '/api/admin/submissions' && req.method === 'GET') return send(res, 200, [...submissions.values()].sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')));
      if (path === '/api/admin/submissions' && req.method === 'DELETE') { submissions.clear(); return send(res, 200, { ok: true }); }
      if (path === '/api/submissions' && req.method === 'POST') { const record = await body(req); const test = tests.get(record.testId); if (!test || record.poolId !== test.poolId || record.scoreOutOf !== test.questionCount) return send(res, 400, { error: 'Submission does not match an active test.' }); submissions.set(record.submissionId, record); return send(res, 201, { ok: true }); }
      return send(res, 404, { error: 'API route not found.' });
    }
    let filePath = path === '/' ? resolve(root, 'BankShield_Frontline_Assessment.html') : resolve(root, `.${decodeURIComponent(path)}`);
    if (filePath !== root && !filePath.startsWith(root + sep)) return send(res, 403, 'Forbidden');
    const data = await readFile(filePath); res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
  } catch (error) { send(res, error.status || 500, { error: error.message || 'Local preview error.' }); }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => process.stdout.write(`BankShield local preview: http://127.0.0.1:${port}/\nInitial local admin PIN: ${env.ADMIN_PIN ? 'configured in .env.local' : pin}\n`));
