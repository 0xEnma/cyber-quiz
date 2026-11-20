import { createServer } from 'node:http';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeSubmission } from './api/_lib/grading.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const env = Object.fromEntries((await readFile(resolve(root, '.env.local'), 'utf8').catch(() => '')).split(/\r?\n/).filter(line => /^[A-Z0-9_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^(['"])(.*)\1$/, '$2')]; }));
let pin = process.env.ADMIN_PIN || env.ADMIN_PIN;
let pinVersion = 'initial';
const secret = process.env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET;
if (!pin || !/^\d{4,12}$/.test(pin)) throw new Error('ADMIN_PIN must be configured as 4 to 12 digits.');
if (!secret) throw new Error('ADMIN_SESSION_SECRET must be configured.');

const defaultQuestions = JSON.parse(await readFile(resolve(root, 'api/_lib/default-pool.json'), 'utf8'));
const pools = new Map();
const tests = new Map();
const submissions = new Map();
const loginFailures = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
let settings = { questionCount: 25, timeLimitMinutes: 15 };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const publicFiles = new Set(['BankShield_Frontline_Assessment.html', 'admin.html', 'admin-qr.js', 'language.js', 'lang_hi.js', 'QUESTION_POOL_AI_PROMPT.md']);

function send(res, status, value, headers = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': typeof value === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...headers
  });
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
  if (!trustedOrigin(req)) return false;
  const value = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('bankshield_admin='))?.slice('bankshield_admin='.length);
  if (!value) return false;
  const [expiresText, version, signature, extra] = value.split('.'); const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000) || !signature || extra || version !== pinVersion) return false;
  const a = Buffer.from(signature), b = Buffer.from(mac('bankshield-admin', `${expiresText}:${version}`));
  return a.length === b.length && timingSafeEqual(a, b);
}
function trustedOrigin(req) {
  const expected = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`).origin;
  const origin = req.headers.origin;
  if (origin && origin !== expected) return false;
  const referer = req.headers.referer;
  if (referer) { try { if (new URL(referer).origin !== expected) return false; } catch { return false; } }
  return true;
}
function testSafe(test) { const { accessCode, ...safe } = test; return { ...safe, accessTicket: ticketFor(test.id) }; }
function poolRead(id) { return id === 'default' ? { id, name: 'BankShield standard pool', ...settings, questions: defaultQuestions } : pools.get(id) || null; }
function publicQuestion(question) { const { answer, explanation, keywords, sample, ...visible } = question; if (Array.isArray(visible.nodes)) visible.nodes = visible.nodes.map(({ answer: nodeAnswer, ...node }) => node); return visible; }
function poolSummary(pool) { return { id: pool.id, name: pool.name, questionCount: pool.questionCount, timeLimitMinutes: pool.timeLimitMinutes, totalQuestions: pool.questions.length, topics: [...new Set(pool.questions.map(q => q.topic))] }; }
function poolCoverage(pool, count) { const topics = [...new Set(pool.questions.map(q => q.topic))], available = topics.map(topic => pool.questions.filter(q => q.topic === topic).length), allocated = topics.map(() => 0), standard = ['Customer identity & privacy', 'Phishing & suspicious emails', 'Incident reporting & evidence care', 'Compliance & customer verification', 'Phone calls & social engineering', 'Customer-reported fraud & alerts', 'Email details & header checks', 'Payment instructions & record keeping', 'Branch & physical security', 'Passwords, devices & safe access'], weights = [4,4,3,3,3,2,2,2,1,1]; for(let n=0;n<count;n++){let pick=-1,priority=-1;topics.forEach((topic,i)=>{const known=standard.indexOf(topic),score=(known<0?1:weights[known])/(allocated[i]+1);if(allocated[i]<available[i]&&score>priority){pick=i;priority=score;}});if(pick<0)break;allocated[pick]++;}return topics.map((topic,i)=>({topic,count:allocated[i]})).filter(item=>item.count>0); }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
    if (path.startsWith('/api/')) {
      if (path === '/api/admin/login' && req.method === 'POST') {
        if (!trustedOrigin(req)) return send(res, 403, { error: 'Cross-origin sign-in requests are not allowed.' });
        const address = req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const failures = loginFailures.get(address);
        if (failures && now - failures.startedAt < LOGIN_WINDOW_MS && failures.count >= LOGIN_LIMIT) return send(res, 429, { error: 'Too many sign-in attempts. Try again later.' }, { 'Retry-After': String(Math.ceil((LOGIN_WINDOW_MS - (now - failures.startedAt)) / 1000)) });
        const input = await body(req);
        if (input.pin !== pin) {
          const current = failures && now - failures.startedAt < LOGIN_WINDOW_MS ? failures : { startedAt: now, count: 0 };
          loginFailures.set(address, { startedAt: current.startedAt, count: current.count + 1 });
          return send(res, 401, { error: 'Incorrect administrator PIN.' });
        }
        loginFailures.delete(address);
        const expires = String(Math.floor(Date.now() / 1000) + 8 * 60 * 60);
        const signature = mac('bankshield-admin', `${expires}:${pinVersion}`);
        return send(res, 200, { ok: true }, { 'Set-Cookie': `bankshield_admin=${expires}.${pinVersion}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
      }
      if (path === '/api/admin/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': 'bankshield_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      if (path === '/api/admin/change-pin' && req.method === 'POST') { if (!isAdmin(req)) return send(res, 401, { error: 'Administrator sign-in required.' }); const input = await body(req); if (input.currentPin !== pin) return send(res, 401, { error: 'Current PIN is incorrect.' }); if (typeof input.newPin !== 'string' || !/^\d{4,12}$/.test(input.newPin)) return send(res, 400, { error: 'New PIN must contain 4 to 12 digits.' }); if (input.newPin === pin) return send(res, 400, { error: 'Choose a PIN different from the current PIN.' }); pin = input.newPin; pinVersion = randomUUID(); return send(res, 200, { ok: true }, { 'Set-Cookie': 'bankshield_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }

      const protectedRoute = path.startsWith('/api/tests') || path === '/api/pools' || path.startsWith('/api/admin/');
      if (protectedRoute && !isAdmin(req)) return send(res, 401, { error: 'Administrator sign-in required.' });
      if (path === '/api/tests/qr' && req.method === 'POST') {
        const input = await body(req);
        if (typeof input.ticket !== 'string' || !/^[A-Za-z0-9_.-]{40,300}$/.test(input.ticket)) return send(res, 400, { error: 'A valid test link is required.' });
        const origin = req.headers.origin || `http://${req.headers.host || 'localhost'}`;
        const link = new URL('/', origin);
        link.searchParams.set('ticket', input.ticket);
        const QRCode = (await import('qrcode')).default;
        const png = await QRCode.toBuffer(link.href, { type: 'png', width: 512, margin: 2, errorCorrectionLevel: 'M' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Disposition': 'attachment; filename="bankshield-test-qr.png"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(png);
      }
      if (path === '/api/admin/settings' && req.method === 'GET') return send(res, 200, { ...settings, maxQuestions: 93 });
      if (path === '/api/admin/settings' && req.method === 'PUT') { const x = await body(req); if (!Number.isInteger(x.questionCount) || x.questionCount < 5 || x.questionCount > 93 || !Number.isInteger(x.timeLimitMinutes) || x.timeLimitMinutes < 1 || x.timeLimitMinutes > 180) return send(res, 400, { error: 'Invalid quiz settings.' }); settings = { questionCount: x.questionCount, timeLimitMinutes: x.timeLimitMinutes }; return send(res, 200, settings); }
      if (path === '/api/settings' && req.method === 'GET') return send(res, 200, { ...settings, maxQuestions: 93 });
      if (path === '/api/pools' && req.method === 'GET') return send(res, 200, [poolSummary({ id: 'default', name: 'BankShield standard pool', ...settings, questions: defaultQuestions }), ...[...pools.values()].map(poolSummary)]);
      if (path === '/api/pools' && req.method === 'POST') { const input = await body(req); if (typeof input.name !== 'string' || !Array.isArray(input.questions) || input.questions.length < 5) return send(res, 400, { error: 'Pool must include a name and at least five questions.' }); const id = randomUUID(); const pool = { id, name: input.name.trim(), questionCount: input.questionCount ?? Math.min(25, input.questions.length), timeLimitMinutes: input.timeLimitMinutes ?? 15, questions: input.questions }; pools.set(id, pool); return send(res, 201, poolSummary(pool)); }
      if (path === '/api/pools' && req.method === 'DELETE') { const id = url.searchParams.get('id'); if ([...tests.values()].some(test => test.poolId === id)) return send(res, 409, { error: 'Revoke tests using this pool first.' }); return send(res, pools.delete(id) ? 200 : 404, { ok: pools.has(id) }); }
      if (path === '/api/tests' && req.method === 'GET') return send(res, 200, [...tests.values()].map(testSafe).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      if (path === '/api/tests' && req.method === 'POST') { const input = await body(req); const pool = poolRead(input.poolId); if (!pool) return send(res, 400, { error: 'Choose an available question pool.' }); const questionCount = Number(input.questionCount), timeLimitMinutes = Number(input.timeLimitMinutes); if (!Number.isInteger(questionCount) || questionCount < 5 || questionCount > pool.questions.length || !Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1 || timeLimitMinutes > 180) return send(res, 400, { error: 'Invalid question count or time limit.' }); const id = randomUUID(); const accessCode = randomBytes(16).toString('hex').toUpperCase(); const test = { id, poolId: pool.id, poolName: pool.name, questionCount, timeLimitMinutes, accessCode, createdAt: new Date().toISOString() }; tests.set(id, test); return send(res, 201, testSafe(test)); }
      if (path === '/api/tests' && req.method === 'DELETE') return send(res, tests.delete(url.searchParams.get('id')) ? 200 : 404, { ok: true });
      if (path === '/api/test-access' && req.method === 'POST') { const input = await body(req); const id = ticketId(input.ticket); const test = id && tests.get(id); const pool = test && poolRead(test.poolId); if (!test || !pool) return send(res, 404, { error: 'That secure test link is invalid or inactive.' }); const testInfo = { id: test.id, poolId: test.poolId, questionCount: test.questionCount, timeLimitMinutes: test.timeLimitMinutes }; const poolInfo = input.summary ? { id: pool.id, name: pool.name, totalQuestions: pool.questions.length, coverage: poolCoverage(pool, test.questionCount) } : { id: pool.id, name: pool.name, questions: pool.questions.map(publicQuestion) }; return send(res, 200, { test: testInfo, pool: poolInfo }); }
      if (path === '/api/admin/submissions' && req.method === 'GET') return send(res, 200, [...submissions.values()].sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')));
      if (path === '/api/admin/submissions' && req.method === 'DELETE') { submissions.clear(); return send(res, 200, { ok: true }); }
      if (path === '/api/submissions' && req.method === 'POST') { const record = await body(req); const test = tests.get(record.testId); const pool = test && poolRead(test.poolId); const ids = (record.responses || []).map(response => String(response.questionId)); const validProfile = ['name','department','branch','email'].every(key => typeof record[key] === 'string' && record[key].trim() && record[key].length <= 200); const validTimes = typeof record.startedAt === 'string' && Number.isFinite(Date.parse(record.startedAt)) && typeof record.completedAt === 'string' && Number.isFinite(Date.parse(record.completedAt)) && Number.isInteger(record.durationSeconds) && record.durationSeconds >= 0 && record.durationSeconds <= 86400 && typeof record.timedOut === 'boolean'; if (!test || !pool || !validProfile || !validTimes || typeof record.submissionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(record.submissionId) || !Array.isArray(record.responses) || record.poolId !== test.poolId || record.testCategory !== test.poolName || record.responses.length < 5 || record.responses.length > 93 || record.responses.length !== test.questionCount || record.responses.some(response => !response || typeof response.answerRaw !== 'string' || response.answerRaw.length > 20000) || ids.some(id => !pool.questions.some(q => String(q.id) === id)) || new Set(ids).size !== ids.length) return send(res, 400, { error: 'Submission does not match an active test link.' }); const grade = gradeSubmission(record, pool); if (!grade) return send(res, 400, { error: 'Submission answers are invalid.' }); const saved = { submissionId: record.submissionId, testId: test.id, poolId: test.poolId, poolName: test.poolName, testCategory: test.poolName, startedAt: record.startedAt, completedAt: record.completedAt, durationSeconds: record.durationSeconds, status: record.timedOut ? 'Timed out - auto-submitted' : 'Submitted', name: record.name, department: record.department, branch: record.branch, email: record.email, score: grade.score, scoreOutOf: test.questionCount, percent: Math.round(grade.score / test.questionCount * 100), responses: grade.responses }; submissions.set(saved.submissionId, saved); return send(res, 201, { ok: true }); }
      return send(res, 404, { error: 'API route not found.' });
    }
    const relativePath = path === '/' ? 'BankShield_Frontline_Assessment.html' : decodeURIComponent(path).replace(/^[/\\]+/, '');
    if (!publicFiles.has(relativePath) || relativePath.includes('..') || relativePath.includes('\\')) return send(res, 404, 'Not found');
    const filePath = resolve(root, relativePath);
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mime[extname(filePath).toLowerCase()] || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    res.end(data);
  } catch (error) { send(res, error.status || 500, { error: error.message || 'Local preview error.' }); }
});

const port = Number(process.env.BANKSHIELD_PREVIEW_PORT || 4173);
server.listen(port, '127.0.0.1', () => process.stdout.write(`BankShield local preview: http://127.0.0.1:${port}/\n`));
