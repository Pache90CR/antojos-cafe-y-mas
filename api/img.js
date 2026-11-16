'use strict';

const redis = require('../lib/redis');
const { send, query } = require('../lib/http');

const IMG = 'antojos:img:';

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return send(res, 405, 'Method Not Allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const id = query(req).get('id') || '';
    if (!/^[a-z0-9]{8,40}$/.test(id) || !redis.enabled()) {
      return send(res, 404, 'No encontrada', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
    }
    let value;
    try {
      value = await redis.cmd('GET', IMG + id);
    } catch (e) {
      return send(res, 502, 'Error', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    const m = /^data:(image\/(?:webp|jpeg|png));base64,(.+)$/.exec(value || '');
    if (!m) {
      return send(res, 404, 'No encontrada', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
    }
    const buf = Buffer.from(m[2], 'base64');
    // El id es único por subida, así que la foto nunca cambia: se puede guardar para siempre.
    return send(res, 200, req.method === 'HEAD' ? '' : buf, {
      'Content-Type': m[1],
      'Content-Length': String(buf.length),
      'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable'
    });
  } catch (e) {
    return send(res, 500, 'Error', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  }
};
