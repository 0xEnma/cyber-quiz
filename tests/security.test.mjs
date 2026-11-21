import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 4183;
const base = `http://127.0.0.1:${port}`;
let server;
let cookie;

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Preview did not start.');
}

before(async () => {
  server = spawn(process.execPath, ['local-preview.mjs'], {
    env: { ...process.env, ADMIN_PIN: '8642', ADMIN_SESSION_SECRET: 'security-test-secret', BANKSHIELD_PREVIEW_PORT: String(port) },
    stdio: 'ignore',
  });
  await waitForServer();
  const response = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin: '8642' }),
  });
  assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie').split(';', 1)[0];
});

after(() => server?.kill());

test('does not expose repository files and sends browser hardening headers', async () => {
  const file = await fetch(`${base}/package.json`);
  assert.equal(file.status, 404);
  const traversal = await fetch(`${base}/%2e%2e/.env.local`);
  assert.equal(traversal.status, 404);
  const page = await fetch(`${base}/admin.html`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('keeps answer keys private and grades submissions on the server', async () => {
  const testResponse = await fetch(`${base}/api/tests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ poolId: 'default', questionCount: 5, timeLimitMinutes: 5 }),
  });
  const created = await testResponse.json();
  const accessResponse = await fetch(`${base}/api/test-access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket: created.accessTicket }),
  });
  const access = await accessResponse.json();
  assert.ok(access.pool.questions.every(question => !('answer' in question) && !('explanation' in question) && !('keywords' in question)));
  assert.ok(access.pool.questions.every(question => !question.nodes || question.nodes.every(node => !('answer' in node))));
  const record = {
    submissionId: `BSH-security-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    testId: created.id,
    testCategory: 'BankShield standard pool',
    poolId: 'default',
    name: 'Throwaway',
    department: 'Test',
    branch: 'Test',
    email: 'throwaway@example.test',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationSeconds: 60,
    timedOut: false,
    score: 5,
    scoreOutOf: 5,
    responses: access.pool.questions.slice(0, 5).map(question => ({
      questionId: question.id,
      answerRaw: JSON.stringify(question.type === 'single' ? 999 : []),
      correct: true,
      correctAnswer: 'forged answer',
    })),
  };
  const response = await fetch(`${base}/api/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  });
  assert.equal(response.status, 201);
  const adminResponse = await fetch(`${base}/api/admin/submissions`, { headers: { cookie } });
  const submissions = await adminResponse.json();
  const saved = submissions.find(item => item.submissionId === record.submissionId);
  assert.equal(saved.score, 0);
  assert.ok(saved.responses.every(item => item.correct === false));
});

test('grades a candidate against the answer version captured by the test link', async () => {
  const poolResponse = await fetch(`${base}/api/pools?id=default`, { headers: { cookie } });
  const originalPool = await poolResponse.json();
  const testResponse = await fetch(`${base}/api/tests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ poolId: 'default', questionCount: 5, timeLimitMinutes: 5 }),
  });
  const created = await testResponse.json();
  const accessResponse = await fetch(`${base}/api/test-access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket: created.accessTicket }),
  });
  const access = await accessResponse.json();
  const candidatesQuestions = access.pool.questions.slice(0, 5);
  const target = candidatesQuestions.find(question => question.type === 'single');
  assert.ok(target, 'the selected test questions include a single-choice question');
  const answerFromLinkVersion = originalPool.questions.find(question => String(question.id) === String(target.id)).answer;

  const editedPool = structuredClone(originalPool);
  const editedQuestion = editedPool.questions.find(question => String(question.id) === String(target.id));
  editedQuestion.answer = (editedQuestion.answer + 1) % editedQuestion.options.length;
  try {
    const updateResponse = await fetch(`${base}/api/pools?id=default`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(editedPool),
    });
    assert.equal(updateResponse.status, 200);

    const record = {
      submissionId: `BSH-version-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      testId: created.id, poolId: 'default', testCategory: 'BankShield standard pool',
      name: 'Version test', department: 'Test', branch: 'Test', email: 'version@example.test',
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationSeconds: 1, timedOut: false,
      responses: candidatesQuestions.map(question => ({
        questionId: question.id,
        answerRaw: String(question.id) === String(target.id) ? JSON.stringify(answerFromLinkVersion) : JSON.stringify(999),
      })),
    };
    const submission = await fetch(`${base}/api/submissions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(record),
    });
    assert.equal(submission.status, 201);
    const submissionsResponse = await fetch(`${base}/api/admin/submissions`, { headers: { cookie } });
    const saved = (await submissionsResponse.json()).find(item => item.submissionId === record.submissionId);
    assert.equal(saved.score, 1);
  } finally {
    const restoreResponse = await fetch(`${base}/api/pools?id=default`, {
      method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(originalPool),
    });
    assert.equal(restoreResponse.status, 200);
  }
});

test('throttles repeated administrator PIN failures', async () => {
  let response;
  for (let attempt = 0; attempt < 6; attempt++) {
    response = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '0000' }),
    });
  }
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '900');
});

test('rejects cross-origin administrator sign-in', async () => {
  const response = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
    body: JSON.stringify({ pin: '8642' }),
  });
  assert.equal(response.status, 403);
});
