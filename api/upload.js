'use strict';

const crypto = require('crypto');
const redis = require('../lib/redis');
const auth = require('../lib/auth');
const { json, readJson } = require('../lib/http');

const IMG = 'antojos:img:';
const IMGS = 'antojos:imgs';
const MAX_CHARS = 900000; // ~650 KB de imagen

function sniff(buf) {
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf.slice(1, 4).toString('latin1') === 'PNG') return 'image/png';
  return '';
}

function newId() {
  return 'i' + Date.now().toString(36).padStart(8, '0') + crypto.randomBytes(4).toString('hex');
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { ok: false, error: 'method_not_allowed' });
    }
    if (!auth.isAuthed(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
    if (!redis.enabled()) return json(res, 503, { ok: false, error: 'storage_not_configured' });

    const body = await readJson(req, 1500000);
    const dataUrl = body && typeof body.dataUrl === 'string' ? body.dataUrl : '';
    const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!m || dataUrl.length > MAX_CHARS) return json(res, 400, { ok: false, error: 'bad_image' });

    const buf = Buffer.from(m[2], 'base64');
    if (sniff(buf) !== m[1]) return json(res, 400, { ok: false, error: 'bad_image' });

    const id = newId();
    try {
      await redis.pipeline([
        ['SET', IMG + id, 'data:' + m[1] + ';base64,' + m[2]],
        ['SADD', IMGS, id]
      ]);
    } catch (e) {
      return json(res, 502, { ok: false, error: 'storage_error' });
    }
    return json(res, 200, { ok: true, id: id, url: '/api/img?id=' + id });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return json(res, status, { ok: false, error: (e && e.code) || 'server_error' });
  }
};
