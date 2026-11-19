import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, list, put } from '@vercel/blob';
import { json } from './http.mjs';

const COOKIE = 'bankshield_admin';
const SESSION_SECONDS = 8 * 60 * 60;
const PIN_PREFIX = 'bankshield/settings/admin-pin-';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const loginFailures = new Map();
let loginAttemptsSinceCleanup = 0;

function secret() {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value) throw new Error('ADMIN_SESSION_SECRET must be configured.');
  return value;
}

async function storedCredential() {
  const blobs = []; let cursor;
  do { const page = await list({ prefix: PIN_PREFIX, limit: 1000, cursor }); blobs.push(...page.blobs); cursor = page.hasMore ? page.cursor : undefined; } while (cursor);
  const latest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  if (!latest) return null;
  const blob = await get(latest.pathname, { access: 'private' });
  return blob ? JSON.parse(await new Response(blob.stream).text()) : null;
}

function safeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function pinMatches(pin, credential) {
  if (credential?.hash && credential?.salt) {
    const actual = scryptSync(pin, Buffer.from(credential.salt, 'base64'), 64);
    return safeEqual(actual, Buffer.from(credential.hash, 'base64'));
  }
  const initial = process.env.ADMIN_PIN;
  return Boolean(initial) && safeEqual(pin, initial);
}

function signature(expires, version, key) {
  return createHmac('sha256', key).update(`bankshield-admin:${expires}:${version}`).digest('base64url');
}

function trustedOrigin(request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin && origin !== expected) return false;
  const referer = request.headers.get('referer');
  if (referer) {
    try { if (new URL(referer).origin !== expected) return false; }
    catch { return false; }
  }
  return true;
}

function clientKey(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

export async function signIn(request) {
  const key = secret();
  if (!trustedOrigin(request)) return json({ error: 'Cross-origin sign-in requests are not allowed.' }, 403);
  const now = Date.now();
  if (++loginAttemptsSinceCleanup >= 100) {
    for (const [ip, entry] of loginFailures) if (now - entry.startedAt >= LOGIN_WINDOW_MS) loginFailures.delete(ip);
    loginAttemptsSinceCleanup = 0;
  }
  const address = clientKey(request);
  const failures = loginFailures.get(address);
  if (failures && now - failures.startedAt < LOGIN_WINDOW_MS && failures.count >= LOGIN_LIMIT) {
    return json({ error: 'Too many sign-in attempts. Try again later.' }, 429, { 'Retry-After': String(Math.ceil((LOGIN_WINDOW_MS - (now - failures.startedAt)) / 1000)) });
  }
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON.' }, 400); }
  const credential = await storedCredential();
  if (typeof body?.pin !== 'string' || !(await pinMatches(body.pin, credential))) {
    const current = failures && now - failures.startedAt < LOGIN_WINDOW_MS ? failures : { startedAt: now, count: 0 };
    loginFailures.set(address, { startedAt: current.startedAt, count: current.count + 1 });
    return json({ error: 'Incorrect administrator PIN.' }, 401);
  }
  loginFailures.delete(address);
  const version = credential?.version || 'initial';
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const value = `${expires}.${version}.${signature(expires, version, key)}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure}`,
  });
}

export async function isAdmin(request) {
  const key = secret();
  if (!trustedOrigin(request)) return false;
  const cookieHeader = request.headers.get('cookie') || '';
  const raw = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return false;
  const [expiresText, version, provided, extra] = raw.split('.');
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000) || !version || !provided || extra) return false;
  const credential = await storedCredential();
  if (version !== (credential?.version || 'initial')) return false;
  return safeEqual(provided, signature(expiresText, version, key));
}

export async function changePin(request) {
  const key = secret();
  if (!trustedOrigin(request)) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!(await isAdmin(request))) return json({ error: 'Administrator sign-in required.' }, 401);
  if (typeof body.currentPin !== 'string' || !(await pinMatches(body.currentPin, await storedCredential()))) return json({ error: 'Current PIN is incorrect.' }, 401);
  if (typeof body.newPin !== 'string' || !/^\d{4,12}$/.test(body.newPin)) return json({ error: 'New PIN must contain 4 to 12 digits.' }, 400);
  if (body.currentPin === body.newPin) return json({ error: 'Choose a PIN different from the current PIN.' }, 400);

  const salt = randomBytes(16);
  const version = randomUUID();
  const credential = { salt: salt.toString('base64'), hash: scryptSync(body.newPin, salt, 64).toString('base64'), version, updatedAt: new Date().toISOString() };
  await put(`${PIN_PREFIX}${Date.now()}-${version}.json`, JSON.stringify(credential), {
    access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false,
  });
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}` });
}

export function unauthorized() {
  return json({ error: 'Administrator sign-in required.' }, 401);
}

export function signOut() {
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  });
}
