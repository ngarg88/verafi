import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Single-user auth. Not a user system — one passcode, one cookie, one person.
 *
 * The moment this is reachable from the internet, "no auth" stops being an acceptable
 * trade. This is the smallest thing that is actually safe: a passcode you set, verified
 * in constant time, exchanged for an HMAC-signed cookie.
 */
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const TTL_MS = 30 * 86400000;                      // 30 days, then re-enter the passcode

const sign = (payload) => createHmac('sha256', SECRET).update(payload).digest('base64url');

export function issueCookie() {
  const exp = Date.now() + TTL_MS;
  const payload = `me.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyCookie(value) {
  if (!value) return false;
  const i = value.lastIndexOf('.');
  if (i < 0) return false;
  const payload = value.slice(0, i), mac = value.slice(i + 1);
  const expected = sign(payload);
  if (mac.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  const exp = +payload.split('.')[1];
  return Number.isFinite(exp) && Date.now() < exp;
}

export function checkPasscode(input) {
  const real = process.env.APP_PASSCODE ?? '';
  if (!real) return false;
  const a = Buffer.from(String(input ?? '').padEnd(64).slice(0, 64));
  const b = Buffer.from(real.padEnd(64).slice(0, 64));
  return timingSafeEqual(a, b);
}

export const authRequired = () => !!process.env.APP_PASSCODE;

export function cookieFrom(req) {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'vf') return decodeURIComponent(v.join('='));
  }
  return null;
}

export const setCookieHeader = (value, secure) =>
  `vf=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL_MS/1000}${secure ? '; Secure' : ''}`;
