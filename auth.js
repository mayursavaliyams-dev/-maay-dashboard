/**
 * AUTH — JWT (HS256) + scrypt password hashing + role-based access control.
 *
 * Zero external dependencies (Node `crypto` only). OFF by default so the local
 * dashboard stays frictionless; enable for production with env:
 *
 *   AUTH_ENABLED=true
 *   AUTH_SECRET=<long random string>
 *   AUTH_ADMIN_USER=admin           AUTH_ADMIN_PASS=<password>     (auto-hashed at boot)
 *   AUTH_USERS=[{"u":"trader1","p":"<scrypt-hash>","role":"trader"}]   (optional, pre-hashed)
 *   AUTH_TOKEN_TTL_HOURS=12         AUTH_COOKIE_SECURE=true (behind HTTPS)
 *
 * Roles: viewer < trader < admin. Reads need viewer; mutations need trader.
 * Token travels in an HttpOnly cookie (browser auto-sends it) OR a Bearer header,
 * so no existing endpoint or frontend fetch has to change.
 */
'use strict';
const crypto = require('crypto');

const ENABLED = String(process.env.AUTH_ENABLED || 'false').toLowerCase() === 'true';
let SECRET = process.env.AUTH_SECRET || '';
if (ENABLED && !SECRET) {
  SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('[auth] AUTH_ENABLED but no AUTH_SECRET — generated an ephemeral secret (tokens reset on restart). Set AUTH_SECRET in production.');
}
const TOKEN_TTL = Math.max(1, Number(process.env.AUTH_TOKEN_TTL_HOURS || 12)) * 3600; // seconds
const COOKIE = 'ag_token';
const ROLE_RANK = { viewer: 1, trader: 2, admin: 3 };

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uJson = o => b64u(Buffer.from(JSON.stringify(o)));
const fromB64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function signToken(payload, ttl = TOKEN_TTL) {
  const now = Math.floor(Date.now() / 1000);
  const data = b64uJson({ alg: 'HS256', typ: 'JWT' }) + '.' + b64uJson({ ...payload, iat: now, exp: now + ttl });
  const sig = b64u(crypto.createHmac('sha256', SECRET).update(data).digest());
  return data + '.' + sig;
}
function verifyToken(token) {
  if (!token) return null;
  const p = String(token).split('.');
  if (p.length !== 3) return null;
  const data = p[0] + '.' + p[1];
  const expected = b64u(crypto.createHmac('sha256', SECRET).update(data).digest());
  const a = Buffer.from(p[2]), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body; try { body = JSON.parse(fromB64u(p[1]).toString()); } catch (_) { return null; }
  if (body.exp && Math.floor(Date.now() / 1000) > body.exp) return null;
  return body;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pw), salt, 32);
  return 'scrypt$' + salt.toString('hex') + '$' + dk.toString('hex');
}
function verifyPassword(pw, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const dk = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 32);
    const a = Buffer.from(hashHex, 'hex');
    return a.length === dk.length && crypto.timingSafeEqual(a, dk);
  } catch (_) { return false; }
}

function loadUsers() {
  const out = [];
  try {
    const arr = JSON.parse(process.env.AUTH_USERS || '[]');
    for (const u of (Array.isArray(arr) ? arr : [])) if (u && u.u && u.p) out.push({ u: u.u, p: u.p, role: u.role || 'trader' });
  } catch (_) {}
  const au = process.env.AUTH_ADMIN_USER, ap = process.env.AUTH_ADMIN_PASS;
  if (au && ap && !out.find(x => x.u === au)) out.push({ u: au, p: hashPassword(ap), role: 'admin' });
  return out;
}
const USERS = ENABLED ? loadUsers() : [];

const roleOk = (have, min) => (ROLE_RANK[have] || 0) >= (ROLE_RANK[min] || 0);

function readToken(req) {
  const h = req.headers['authorization'];
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  const c = req.headers.cookie;
  if (c) { const m = c.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)')); if (m) return decodeURIComponent(m[1]); }
  return null;
}
function login(username, password) {
  const user = USERS.find(x => x.u === username);
  if (!user || !verifyPassword(password, user.p)) return null;
  return { token: signToken({ sub: user.u, role: user.role }), role: user.role, user: user.u };
}
function cookieHeader(token) {
  const secure = String(process.env.AUTH_COOKIE_SECURE || 'false').toLowerCase() === 'true' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL}${secure}`;
}
const clearCookieHeader = () => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

// Express middleware: gate an API route at a minimum role (no-op when auth is off).
function requireRole(minRole = 'viewer') {
  return (req, res, next) => {
    if (!ENABLED) return next();
    const u = verifyToken(readToken(req));
    if (!u) return res.status(401).json({ error: 'unauthorized', login: '/login.html' });
    if (!roleOk(u.role, minRole)) return res.status(403).json({ error: 'forbidden', need: minRole, have: u.role });
    req.user = u; next();
  };
}

module.exports = {
  ENABLED, COOKIE, TOKEN_TTL,
  signToken, verifyToken, hashPassword, verifyPassword,
  loadUsers, login, readToken, roleOk, requireRole, cookieHeader, clearCookieHeader,
  userCount: () => USERS.length,
};
