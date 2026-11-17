'use strict';

function send(res, status, body, headers) {
  res.statusCode = status;
  const h = Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers || {});
  Object.keys(h).forEach((k) => res.setHeader(k, h[k]));
  res.end(body);
}

function json(res, status, obj, headers) {
  send(
    res,
    status,
    JSON.stringify(obj),
    Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {})
  );
}

function fail(status, code) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  return e;
}

// Lee el cuerpo JSON. En Vercel req.body ya viene interpretado; fuera de Vercel se lee el flujo.
async function readJson(req, limit) {
  const max = limit || 2000000;
  let raw;
  try {
    raw = req.body;
  } catch (e) {
    throw fail(400, 'bad_json');
  }
  if (raw !== undefined && raw !== null) {
    if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
    if (typeof raw === 'object') return raw;
    try {
      return raw ? JSON.parse(String(raw)) : {};
    } catch (e) {
      throw fail(400, 'bad_json');
    }
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw fail(413, 'too_large');
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    throw fail(400, 'bad_json');
  }
}

function query(req) {
  try {
    return new URL(req.url, 'http://localhost').searchParams;
  } catch (e) {
    return new URLSearchParams();
  }
}

function clientIp(req) {
  const h = req.headers || {};
  const f = h['x-forwarded-for'];
  if (f) return String(f).split(',')[0].trim();
  return h['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { send, json, fail, readJson, query, clientIp };
