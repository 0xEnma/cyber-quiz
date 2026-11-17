import { createHmac, timingSafeEqual } from 'node:crypto';
import { json } from './http.mjs';

const COOKIE = 'bankshield_admin';
const SESSION_SECONDS = 8 * 60 * 60;

function config() {
  const pin = process.env.ADMIN_PIN;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!pin || !secret) throw new Error('ADMIN_PIN and ADMIN_SESSION_SECRET must be configured.');
  return { pin, secret };
}

function signature(expires, secret) {
  return createHmac('sha256', secret).update(`bankshield-admin:${expires}`).digest('base64url');
}

export async function signIn(request) {
  const { pin, secret } = config();
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (typeof body.pin !== 'string' || body.pin !== pin) return json({ error: 'Incorrect administrator PIN.' }, 401);

  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const value = `${expires}.${signature(expires, secret)}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure}`,
  });
}

export function isAdmin(request) {
  const { secret } = config();
  const cookieHeader = request.headers.get('cookie') || '';
  const raw = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return false;
  const [expiresText, provided] = raw.split('.');
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000) || !provided) return false;
  const expected = signature(expires, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unauthorized() {
  return json({ error: 'Administrator sign-in required.' }, 401);
}

export function signOut() {
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  });
}
