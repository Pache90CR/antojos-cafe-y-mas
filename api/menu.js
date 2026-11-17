'use strict';

const redis = require('../lib/redis');
const auth = require('../lib/auth');
const M = require('../lib/menu');
const { json, readJson, query } = require('../lib/http');

const KEY = 'antojos:menu';
const IMG = 'antojos:img:';
const IMGS = 'antojos:imgs';

async function loadStored() {
  const raw = await redis.cmd('GET', KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && o.menu) return { rev: Number(o.rev) || 0, updatedAt: o.updatedAt || null, menu: M.sanitize(o.menu) };
  } catch (e) {
    /* contenido dañado: se trata como vacío */
  }
  return null;
}

// Borra fotos que ya no usa ningún producto (con más de 2 días, para no tocar subidas recientes).
async function cleanupImages(menu) {
  const used = new Set();
  const text = JSON.stringify(menu);
  const re = /\/api\/img\?id=([a-z0-9]+)/g;
  let m;
  while ((m = re.exec(text))) used.add(m[1]);
  const all = (await redis.cmd('SMEMBERS', IMGS)) || [];
  const now = Date.now();
  const dead = [];
  all.forEach((id) => {
    if (used.has(id)) return;
    const ts = parseInt(String(id).slice(1, 9), 36);
    if (!ts || now - ts < 2 * 86400000) return;
    dead.push(id);
  });
  if (dead.length) {
    await redis.pipeline([
      ['DEL'].concat(dead.map((i) => IMG + i)),
      ['SREM', IMGS].concat(dead)
    ]);
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const q = query(req);
      const fresh = q.get('fresh') === '1';
      // nocache=1: lectura directa de la base de datos, sin pasar por la caché (el sitio la usa al volver a la página).
      const nocache = fresh || q.get('nocache') === '1';
      let storage = redis.enabled() ? 'redis' : 'none';
      let rev = 0;
      let menu = M.defaults();
      if (storage === 'redis') {
        try {
          const st = await loadStored();
          if (st) {
            menu = st.menu;
            rev = st.rev;
          }
        } catch (e) {
          storage = 'error';
        }
      }
      const body = { ok: true, storage: storage, rev: rev, menu: menu };
      if (fresh) {
        body.authed = auth.isAuthed(req);
        body.password = auth.passwordState();
      }
      // Solo se guarda en caché una lectura correcta de la base de datos; un fallo pasajero no debe quedarse pegado.
      // La caché dura 10 s y el sitio cambia de dirección (?b=) cada 10 s, así que nadie ve un menú más viejo que eso.
      const cacheable = !nocache && storage === 'redis';
      return json(res, 200, body, {
        'Cache-Control': cacheable ? 'public, max-age=0, s-maxage=10' : 'no-store'
      });
    }

    if (req.method === 'PUT') {
      if (!auth.isAuthed(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
      if (!redis.enabled()) return json(res, 503, { ok: false, error: 'storage_not_configured' });
      const body = await readJson(req);
      const menu = M.sanitize(body && body.menu);
      const baseRev = Number(body && body.baseRev);
      let stored;
      try {
        stored = await loadStored();
      } catch (e) {
        return json(res, 502, { ok: false, error: 'storage_error' });
      }
      const current = stored ? stored.rev : 0;
      if (baseRev !== current) return json(res, 409, { ok: false, error: 'conflict', rev: current });
      const next = { rev: current + 1, updatedAt: new Date().toISOString(), menu: menu };
      try {
        await redis.cmd('SET', KEY, JSON.stringify(next));
      } catch (e) {
        return json(res, 502, { ok: false, error: 'storage_error' });
      }
      try {
        await cleanupImages(menu);
      } catch (e) {
        /* limpiar fotos es opcional */
      }
      return json(res, 200, { ok: true, rev: next.rev, menu: menu });
    }

    res.setHeader('Allow', 'GET, PUT');
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return json(res, status, { ok: false, error: (e && e.code) || 'server_error' });
  }
};
