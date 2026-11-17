'use strict';

const crypto = require('crypto');

const MIN_LEN = 6;
const TOKEN_DAYS = 30;

function secretPassword() {
  const p = process.env.ADMIN_PASSWORD;
  return typeof p === 'string' ? p.trim() : '';
}

// 'ok' | 'missing' | 'short'
function passwordState() {
  const p = secretPassword();
  if (!p) return 'missing';
  if (p.length < MIN_LEN) return 'short';
  return 'ok';
}

function hmacKey() {
  return crypto
    .createHash('sha256')
    .update('antojos|' + (process.env.SESSION_SECRET || '') + '|' + secretPassword())
    .digest();
}

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64u(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function mac(body) {
  return b64u(crypto.createHmac('sha256', hmacKey()).update(body).digest());
}

function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  return body + '.' + mac(body);
}

function verify(token) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 600) return null;
  const i = token.indexOf('.');
  if (i < 1) return null;
  const body = token.slice(0, i);
  const given = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(mac(body));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let p;
  try {
    p = JSON.parse(fromB64u(body).toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!p || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
  return p;
}

function checkPassword(input) {
  const a = crypto.createHash('sha256').update(String(input == null ? '' : input).trim()).digest();
  const b = crypto.createHash('sha256').update(secretPassword()).digest();
  return crypto.timingSafeEqual(a, b);
}

function newToken() {
  const now = Date.now();
  const exp = now + TOKEN_DAYS * 86400000;
  return { token: sign({ iat: now, exp }), exp };
}

function bearer(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  return m ? m[1].trim() : '';
}

function isAuthed(req) {
  if (passwordState() !== 'ok') return false;
  return !!verify(bearer(req));
}

module.exports = { passwordState, checkPassword, newToken, isAuthed, verify, bearer, MIN_LEN };
