'use strict';

const crypto = require('crypto');
const DEFAULTS = require('../public/data/menu.default.json');

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const LIMIT = { categories: 30, products: 300, promos: 20 };

function str(v, max) {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Precio en colones: entero >= 0 o null.
function money(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0) return null;
  return Math.min(99999999, Math.round(n));
}

function flag(v) {
  return v === true || v === 'true' || v === 1;
}

function ymd(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? v : '';
}

function hhmm(v, fallback) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback;
}

function digits(v, fallback) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length === 8) d = '506' + d;
  return /^[1-9]\d{7,14}$/.test(d) ? d : fallback;
}

function image(v) {
  if (typeof v !== 'string') return '';
  if (/^\/api\/img\?id=[a-z0-9]{8,40}$/.test(v)) return v;
  if (/^\/assets\/art\/[a-z0-9-]{1,40}\.svg$/.test(v)) return v;
  return '';
}

function uniqueId(v, used, prefix) {
  let id = typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(v) ? v : '';
  while (!id || used.has(id)) id = prefix + crypto.randomBytes(5).toString('hex');
  used.add(id);
  return id;
}

function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function sanitize(input) {
  const src = obj(input);
  const st = obj(src.settings);
  const D = DEFAULTS.settings;

  const schedule = {};
  DAYS.forEach((d) => {
    const x = obj(obj(st.schedule)[d]);
    schedule[d] = { open: flag(x.open), from: hhmm(x.from, '08:00'), to: hhmm(x.to, '17:00') };
  });

  const settings = {
    name: str(st.name, 60) || D.name,
    whatsapp: digits(st.whatsapp, D.whatsapp),
    address: str(st.address, 160),
    heroTitle: str(st.heroTitle, 60),
    orderIntro: str(st.orderIntro, 120) || D.orderIntro,
    mode: st.mode === 'auto' || st.mode === 'closed' ? st.mode : 'open',
    closedMessage: str(st.closedMessage, 160),
    acceptWhenClosed: flag(st.acceptWhenClosed),
    schedule: schedule
  };

  const usedCat = new Set();
  const categories = [];
  (Array.isArray(src.categories) ? src.categories : []).slice(0, LIMIT.categories).forEach((c) => {
    c = obj(c);
    const name = str(c.name, 40);
    if (!name) return;
    categories.push({ id: uniqueId(c.id, usedCat, 'c'), name: name, hidden: flag(c.hidden) });
  });

  const rawProducts = (Array.isArray(src.products) ? src.products : []).slice(0, LIMIT.products);
  if (!categories.length && rawProducts.length) {
    usedCat.add('general');
    categories.push({ id: 'general', name: 'General', hidden: false });
  }
  const catIds = new Set(categories.map((c) => c.id));

  const usedProd = new Set();
  const products = [];
  rawProducts.forEach((p) => {
    p = obj(p);
    const name = str(p.name, 60);
    if (!name) return;
    const promoPrice = money(p.promoPrice);
    products.push({
      id: uniqueId(p.id, usedProd, 'p'),
      categoryId: catIds.has(p.categoryId) ? p.categoryId : categories[0].id,
      name: name,
      desc: str(p.desc, 220),
      price: money(p.price),
      promoPrice: promoPrice,
      promoLabel: promoPrice === null ? '' : str(p.promoLabel, 14),
      promoUntil: promoPrice === null ? '' : ymd(p.promoUntil),
      image: image(p.image),
      soldOut: flag(p.soldOut),
      hidden: flag(p.hidden)
    });
  });

  const productIds = new Set(products.map((p) => p.id));
  const usedPromo = new Set();
  const promos = [];
  (Array.isArray(src.promos) ? src.promos : []).slice(0, LIMIT.promos).forEach((p) => {
    p = obj(p);
    const title = str(p.title, 60);
    if (!title) return;
    promos.push({
      id: uniqueId(p.id, usedPromo, 'm'),
      title: title,
      text: str(p.text, 200),
      badge: str(p.badge, 14),
      active: flag(p.active),
      until: ymd(p.until),
      productId: productIds.has(p.productId) ? p.productId : ''
    });
  });

  return { settings: settings, categories: categories, products: products, promos: promos };
}

function defaults() {
  return sanitize(JSON.parse(JSON.stringify(DEFAULTS)));
}

module.exports = { sanitize, defaults, LIMIT, DAYS };
