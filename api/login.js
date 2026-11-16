'use strict';

const crypto = require('crypto');
const redis = require('../lib/redis');
const auth = require('../lib/auth');
const { json, readJson, clientIp } = require('../lib/http');

const MAX_FAILS = 8;
const WINDOW_SECONDS = 900;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    const state = auth.passwordState();
    if (state !== 'ok') {
      return json(res, 503, { ok: false, error: state === 'missing' ? 'password_missing' : 'password_short' });
    }

    const ip = crypto.createHash('sha1').update(String(clientIp(req))).digest('hex').slice(0, 16);
    const failKey = 'antojos:fail:' + ip;
    const useLimit = redis.enabled();

    if (useLimit) {
      try {
        const n = Number(await redis.cmd('GET', failKey)) || 0;
        if (n >= MAX_FAILS) {
          return json(res, 429, { ok: false, error: 'too_many', retryAfter: WINDOW_SECONDS });
        }
      } catch (e) {
        /* si la base falla, solo se pierde el límite de intentos */
      }
    }

    const body = await readJson(req, 20000);
    if (!auth.checkPassword(body && body.password)) {
      await sleep(600);
      if (useLimit) {
        try {
          await redis.pipeline([
            ['SET', failKey, '0', 'EX', WINDOW_SECONDS, 'NX'],
            ['INCR', failKey]
          ]);
        } catch (e) {
          /* ignorar */
        }
      }
      return json(res, 401, { ok: false, error: 'bad_password' });
    }

    if (useLimit) {
      try {
        await redis.cmd('DEL', failKey);
      } catch (e) {
        /* ignorar */
      }
    }
    const t = auth.newToken();
    return json(res, 200, { ok: true, token: t.token, exp: t.exp });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return json(res, status, { ok: false, error: (e && e.code) || 'server_error' });
  }
};
