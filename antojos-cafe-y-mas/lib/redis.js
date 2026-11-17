'use strict';

// Cliente mínimo de Upstash Redis por REST (sin dependencias).
// Vercel agrega las variables al conectar la base de datos desde Storage.

function config() {
  const env = process.env;
  let url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
  let token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) {
    // Prefijo personalizado al conectar la base (por ejemplo STORAGE_REST_API_URL).
    for (const k of Object.keys(env)) {
      const m = /^(.+)_REST_API_URL$/.exec(k);
      if (m && env[m[1] + '_REST_API_TOKEN']) {
        url = env[k];
        token = env[m[1] + '_REST_API_TOKEN'];
        break;
      }
    }
  }
  url = String(url || '').trim().replace(/\/+$/, '');
  token = String(token || '').trim();
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!url || !token) return null;
  return { url, token };
}

function enabled() {
  return !!config();
}

class RedisError extends Error {
  constructor(code, detail) {
    super(detail ? code + ': ' + detail : code);
    this.code = code;
  }
}

async function call(path, body) {
  const c = config();
  if (!c) throw new RedisError('not_configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try {
    res = await fetch(c.url + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    throw new RedisError('network', e && e.name === 'AbortError' ? 'timeout' : e && e.message);
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) throw new RedisError('http_' + res.status, data && data.error ? data.error : res.statusText);
  return data;
}

// cmd('SET', 'k', 'v') -> resultado
async function cmd(...args) {
  const d = await call('', args);
  if (d && d.error) throw new RedisError('command', d.error);
  return d ? d.result : null;
}

// pipeline([['SET','a','1'], ['GET','a']]) -> [resultado, resultado]
async function pipeline(cmds) {
  const d = await call('/pipeline', cmds);
  if (!Array.isArray(d)) throw new RedisError('pipeline', 'respuesta inesperada');
  return d.map((x) => {
    if (x && x.error) throw new RedisError('command', x.error);
    return x ? x.result : null;
  });
}

module.exports = { enabled, cmd, pipeline, RedisError };
