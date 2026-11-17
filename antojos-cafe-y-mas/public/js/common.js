/* Utilidades compartidas por el sitio y el panel. Funciona en el navegador (window.AC) y en Node (pruebas). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TZ = 'America/Costa_Rica';
  const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const JS_DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_NAMES = { mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo' };
  const DAY_SHORT = { mon: 'Lun', tue: 'Mar', wed: 'Mié', thu: 'Jue', fri: 'Vie', sat: 'Sáb', sun: 'Dom' };
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const NB = ' ';

  /* ---------- texto y dinero ---------- */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  function money(n) {
    return '₡' + String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
  }

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function slug(s) {
    return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  }

  function uid(prefix) {
    let r = '';
    try {
      const a = new Uint8Array(5);
      (self.crypto || window.crypto).getRandomValues(a);
      r = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      r = Math.random().toString(16).slice(2, 12).padEnd(10, '0');
    }
    return (prefix || 'x') + r;
  }

  /* ---------- teléfono / WhatsApp ---------- */
  function digits(v) {
    let d = String(v == null ? '' : v).replace(/\D/g, '');
    if (d.length === 8) d = '506' + d;
    return d;
  }

  function validPhone(d) {
    return /^[1-9]\d{7,14}$/.test(d);
  }

  function phoneDisplay(d) {
    d = String(d || '');
    if (/^506\d{8}$/.test(d)) return d.slice(3, 7) + ' ' + d.slice(7);
    return d ? '+' + d : '';
  }

  function waLink(d, text) {
    return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
  }

  /* ---------- hora de Costa Rica ---------- */
  function crNow(date) {
    const d = date || new Date();
    try {
      const f = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        hourCycle: 'h23',
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      const p = {};
      f.formatToParts(d).forEach((x) => {
        p[x.type] = x.value;
      });
      const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
      if (dow === undefined) throw new Error('tz');
      return { dow: dow, minutes: (+p.hour % 24) * 60 + +p.minute, ymd: p.year + '-' + p.month + '-' + p.day };
    } catch (e) {
      const t = new Date(d.getTime() - 6 * 3600 * 1000); // Costa Rica no usa horario de verano: UTC-6
      return { dow: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), ymd: t.toISOString().slice(0, 10) };
    }
  }

  function fmtTime(hhmm) {
    const h = +hhmm.slice(0, 2);
    const m = hhmm.slice(3, 5);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + m + NB + (h < 12 ? 'a.' + NB + 'm.' : 'p.' + NB + 'm.');
  }

  function fmtDate(ymd) {
    const p = String(ymd).split('-');
    return +p[2] + ' ' + MONTHS[+p[1] - 1];
  }

  function toMin(t) {
    return +t.slice(0, 2) * 60 + +t.slice(3, 5);
  }

  function dayRange(sch, key) {
    const x = sch && sch[key];
    if (!x || !x.open) return null;
    const from = toMin(x.from);
    const to = toMin(x.to);
    return { from: from, to: to, fromStr: x.from, toStr: x.to, all: from === to, overnight: to < from };
  }

  // Estado del negocio: { open, mode, label, detail }
  function getStatus(settings, date) {
    const s = settings || {};
    if (s.mode === 'closed') {
      return { open: false, mode: 'closed', label: 'Cerrado', detail: s.closedMessage || '' };
    }
    if (s.mode !== 'auto') return { open: true, mode: 'open', label: 'Abierto', detail: '' };

    const now = crNow(date);
    const today = JS_DAY[now.dow];
    const yesterday = JS_DAY[(now.dow + 6) % 7];
    const t = dayRange(s.schedule, today);
    const y = dayRange(s.schedule, yesterday);
    let open = false;
    let closeAt = null;
    if (t) {
      if (t.all) open = true;
      else if (!t.overnight) {
        if (now.minutes >= t.from && now.minutes < t.to) {
          open = true;
          closeAt = t.toStr;
        }
      } else if (now.minutes >= t.from) {
        open = true;
        closeAt = t.toStr;
      }
    }
    if (!open && y && y.overnight && now.minutes < y.to) {
      open = true;
      closeAt = y.toStr;
    }
    if (open) {
      return { open: true, mode: 'auto', label: 'Abierto', detail: closeAt ? 'Cierra a las ' + fmtTime(closeAt) : 'Abierto las 24 horas' };
    }
    for (let i = 0; i < 8; i++) {
      const key = JS_DAY[(now.dow + i) % 7];
      const r = dayRange(s.schedule, key);
      if (!r) continue;
      if (i === 0 && r.from <= now.minutes) continue;
      const when = i === 0 ? 'hoy' : i === 1 ? 'mañana' : 'el ' + DAY_NAMES[key].toLowerCase();
      return { open: false, mode: 'auto', label: 'Cerrado', detail: 'Abrimos ' + when + ' a las ' + fmtTime(r.fromStr) };
    }
    return { open: false, mode: 'auto', label: 'Cerrado', detail: 'Horario por definir' };
  }

  // Agrupa días consecutivos con el mismo horario: [{keys, days, text, closed}]
  function scheduleLines(sch) {
    const groups = [];
    KEYS.forEach((k) => {
      const x = (sch && sch[k]) || { open: false, from: '08:00', to: '17:00' };
      const sig = x.open ? x.from + '-' + x.to : 'closed';
      const last = groups[groups.length - 1];
      if (last && last.sig === sig) last.keys.push(k);
      else groups.push({ sig: sig, keys: [k], closed: !x.open, from: x.from, to: x.to });
    });
    return groups.map((g) => ({
      keys: g.keys,
      closed: g.closed,
      days:
        g.keys.length === 1
          ? DAY_SHORT[g.keys[0]]
          : g.keys.length === 2
          ? DAY_SHORT[g.keys[0]] + ' y ' + DAY_SHORT[g.keys[1]]
          : DAY_SHORT[g.keys[0]] + ' a ' + DAY_SHORT[g.keys[g.keys.length - 1]],
      text: g.closed ? 'Cerrado' : g.from === g.to ? '24 horas' : fmtTime(g.from) + ' – ' + fmtTime(g.to)
    }));
  }

  /* ---------- promociones ---------- */
  function promoOn(p, today) {
    return p.promoPrice !== null && p.promoPrice !== undefined && (!p.promoUntil || today <= p.promoUntil);
  }

  function unitPrice(p, today) {
    return promoOn(p, today) ? p.promoPrice : p.price;
  }

  function bannerOn(b, today) {
    return !!b.active && (!b.until || today <= b.until);
  }

  /* ---------- textos del sitio ---------- */
  function joinNames(names) {
    const n = names.filter(Boolean);
    if (!n.length) return 'Antojos y más';
    const low = n.slice(0, 3).map((x, i) => (i === 0 || x === x.toUpperCase() ? x : x.charAt(0).toLowerCase() + x.slice(1)));
    if (n.length > 3) return low.join(', ') + ' y más';
    if (low.length === 1) return low[0];
    return low.slice(0, -1).join(', ') + ' y ' + low[low.length - 1];
  }

  /* ---------- iconos ---------- */
  const ICONS = {
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    cart: '<path d="M3 4h2.2l1.8 9.4a1.7 1.7 0 0 0 1.7 1.4h7.6a1.7 1.7 0 0 0 1.7-1.3L19.6 7H6.2"/><circle cx="9.5" cy="19.2" r="1.3"/><circle cx="16.5" cy="19.2" r="1.3"/>',
    search: '<circle cx="11" cy="11" r="6.8"/><path d="M20 20l-4.2-4.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    home: '<path d="M4 11l8-7 8 7v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1V11z"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2.5z"/>',
    chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    cup: '<path d="M5 9h11v3.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9z"/><path d="M16 10.5h1.2a2.3 2.3 0 0 1 0 4.6H15.7"/><path d="M8.5 3.8c-.9.9.9 1.8 0 2.7M12 3.8c-.9.9.9 1.8 0 2.7"/><path d="M4.5 20.5h12"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
    waffle: '<circle cx="12" cy="12" r="8.2"/><path d="M8 4.84V19.16M16 4.84V19.16M4.84 8H19.16M4.84 16H19.16"/>',
    donut: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="2.8"/><path d="M7.6 8.6l1.5.8M15.6 7.3l1 1.4M16.6 14.7l-1.5-.6M8 15.6l1.4-.9M12.4 6.3v1.5"/>',
    fork: '<path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M17 3c-2 1-3 3.5-3 6s1 3.5 3 4v8"/>',
    tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a1.5 1.5 0 0 1-2.1 0L3.5 12.2z"/><circle cx="8" cy="8" r="1.4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
    camera: '<path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
    up: '<path d="M6 14l6-6 6 6"/>',
    down: '<path d="M6 10l6 6 6-6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    eyeoff: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/><path d="M4 4l16 16"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    logout: '<path d="M10 4.5H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H10M15 8l4 4-4 4M19 12H9.5"/>',
    download: '<path d="M12 4v11M7.5 11l4.5 4.5L16.5 11M5 19.5h14"/>',
    upload: '<path d="M12 15V4M7.5 8L12 3.5 16.5 8M5 19.5h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    external: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10"/>',
    alert: '<path d="M12 4l9 15.5H3L12 4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    box: '<path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4v-9z"/><path d="M3.5 7.5L12 11.5l8.5-4M12 11.5v9"/>',
    list: '<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/>',
    // comida y bebida (para las categorías)
    icedcup: '<path d="M6.8 9.5l1.1 9.9a1.6 1.6 0 0 0 1.6 1.4h5a1.6 1.6 0 0 0 1.6-1.4l1.1-9.9"/><path d="M5.8 9.5h12.4"/><path d="M7.3 9.5V8.6a1.2 1.2 0 0 1 1.2-1.2h7a1.2 1.2 0 0 1 1.2 1.2v.9"/><path d="M13.2 7.4L14.6 3.2h2.6"/><path d="M7.9 14.2c1.1-.8 2 .8 3.1 0s2 .8 3.1 0 1.4.4 2 .1"/>',
    glass: '<path d="M6.6 5.5h10.8l-1.2 13.4a1.6 1.6 0 0 1-1.6 1.5H9.4a1.6 1.6 0 0 1-1.6-1.5L6.6 5.5z"/><path d="M7.3 11h9.4"/><path d="M13 5.5l1.8-3.2h2.4"/>',
    bottle: '<path d="M10 3h4v2.6c0 .9 1.5 1.6 1.5 3.5v9.9a1.6 1.6 0 0 1-1.6 1.6h-3.8a1.6 1.6 0 0 1-1.6-1.6V9.1C8.5 7.2 10 6.5 10 5.6V3z"/><path d="M8.5 12.5h7M8.5 16.5h7"/>',
    tea: '<path d="M5.5 12.6c0-1 .8-1.8 1.8-1.8h6.9c1 0 1.8.8 1.8 1.8v1.2a5.3 5.3 0 0 1-5.3 5.3h-.1a5.3 5.3 0 0 1-5.1-5.3z"/><path d="M7.6 10.8V9.9c0-.5.4-.9.9-.9h3.2c.5 0 .9.4.9.9v.9"/><path d="M10 9V7.6"/><path d="M16 12.8c1.8-.2 2.9-1.6 3.3-3.8"/><path d="M5.5 11.9H4.9A1.9 1.9 0 0 0 3 13.8v.3a1.9 1.9 0 0 0 1.9 1.9h.9"/>',
    croissant: '<path d="M3.4 16.6C3.3 10.8 7.2 6.4 12 6.4s8.7 4.4 8.6 10.2c0 .9-.7 1.5-1.5 1.4-1.2-.2-1.9-1.1-2.5-2.2-.8-1.5-2.2-2.5-4.6-2.5s-3.8 1-4.6 2.5c-.6 1.1-1.3 2-2.5 2.2-.8.1-1.5-.5-1.5-1.4z"/><path d="M7.9 7.8c.7 2 .9 4.2.5 6.4M16.1 7.8c-.7 2-.9 4.2-.5 6.4M4.8 11.4c1.2 1 1.9 2.3 2 3.9M19.2 11.4c-1.2 1-1.9 2.3-2 3.9"/>',
    bread: '<path d="M4.5 10.2c0-2.7 3.4-4.4 7.5-4.4s7.5 1.7 7.5 4.4c0 1.1-.7 1.9-1.6 2.3v5.4c0 .9-.7 1.6-1.6 1.6H7.7c-.9 0-1.6-.7-1.6-1.6v-5.4c-.9-.4-1.6-1.2-1.6-2.3z"/><path d="M9.2 9.4l1.3 2.4M13.2 9.4l1.3 2.4"/>',
    sandwich: '<path d="M3 11.5l8.2-6.4a1.5 1.5 0 0 1 1.6 0l8.2 6.4"/><path d="M3 11.5h18"/><path d="M5 14.3l2.3-1.6 2.4 1.6 2.3-1.6 2.4 1.6 2.3-1.6 2.3 1.6"/><path d="M3.5 16.4h17v1.4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-1.4z"/>',
    burger: '<path d="M4.2 10.8C4.2 7.4 7.7 5 12 5s7.8 2.4 7.8 5.8z"/><path d="M9 8.2h.01M12.4 7.2h.01M15.4 8.4h.01"/><path d="M3.5 13.4q1.06-1.6 2.12 0t2.12 0 2.12 0 2.12 0 2.12 0 2.12 0 2.12 0 2.12 0"/><path d="M4.4 15.9h15.2"/><path d="M5 17.8h14v.5a2.2 2.2 0 0 1-2.2 2.2H7.2A2.2 2.2 0 0 1 5 18.3v-.5z"/>',
    pizza: '<path d="M12 20.8L3.9 7.4C6.3 5.6 9.1 4.7 12 4.7s5.7.9 8.1 2.7L12 20.8z"/><path d="M5 9.6c4.3-2.5 9.7-2.5 14 0"/><circle cx="10.3" cy="11.4" r="1"/><circle cx="14" cy="12.5" r="1"/><circle cx="11.9" cy="15.7" r=".9"/>',
    fries: '<path d="M6.3 10.2l1.2 9.1a1.4 1.4 0 0 0 1.4 1.2h6.2a1.4 1.4 0 0 0 1.4-1.2l1.2-9.1z"/><path d="M8.7 10.2V4.8M11.2 10.2V3.4M13.7 10.2V4.2M16 10.2V5.8"/>',
    bowl: '<path d="M3.5 11.5h17c0 4.7-3.8 8.5-8.5 8.5s-8.5-3.8-8.5-8.5z"/><path d="M9 21.2h6"/><path d="M8.5 8.6c-.9-.9.9-1.8 0-2.7M12 8.6c-.9-.9.9-1.8 0-2.7M15.5 8.6c-.9-.9.9-1.8 0-2.7"/>',
    egg: '<path d="M12.00 3.80C13.77 3.86 15.68 5.10 17.14 6.27C18.60 7.45 20.44 9.15 20.76 10.85C21.09 12.56 20.06 14.86 19.10 16.50C18.14 18.14 16.65 20.10 15.01 20.67C13.37 21.24 11.01 20.58 9.26 19.92C7.52 19.26 5.43 18.19 4.55 16.70C3.68 15.21 3.69 12.80 4.02 10.99C4.35 9.19 5.21 7.09 6.54 5.89C7.87 4.69 10.23 3.74 12.00 3.80z"/><circle cx="12" cy="12.4" r="3.2"/>',
    cookie: '<path d="M12 3a9 9 0 1 0 9 9 3.6 3.6 0 0 1-4.5-4.5A3.6 3.6 0 0 1 12 3z"/><path d="M8.6 9h.01M12.2 13.9h.01M8 14h.01M15.2 15.6h.01"/>',
    cupcake: '<path d="M6.3 12.5h11.4l-1.3 6.9a1.6 1.6 0 0 1-1.6 1.3H9.2a1.6 1.6 0 0 1-1.6-1.3l-1.3-6.9z"/><path d="M10 13.2v6.8M14 13.2v6.8"/><path d="M5.6 12.5c-.9-1.1-.8-2.6.3-3.4.6-.4 1.3-.5 2-.3.3-2 2-3.3 4.1-3.3s3.8 1.3 4.1 3.3c.7-.2 1.4-.1 2 .3 1.1.8 1.2 2.3.3 3.4"/>',
    cake: '<path d="M3.5 18.6v-6.4a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v6.4a1.4 1.4 0 0 1-1.4 1.4H4.9a1.4 1.4 0 0 1-1.4-1.4z"/><path d="M3.5 15q1.4 1.6 2.83 0t2.83 0 2.83 0 2.83 0 2.83 0 2.83 0"/><path d="M12 11.2V8.4"/><path d="M12 5.2c.9.9.9 1.9 0 2.8-.9-.9-.9-1.9 0-2.8z"/>',
    icecream: '<path d="M7.7 12.8A5.6 5.6 0 1 1 16.3 12.8"/><path d="M6.4 12.8h11.2"/><path d="M7.9 12.8L12 21.2l4.1-8.4"/>',
    candy: '<circle cx="12" cy="12" r="4.4"/><path d="M8.7 9.3L4.2 7.2v9.6l4.5-2.1M15.3 9.3l4.5-2.1v9.6l-4.5-2.1"/>',
    fruit: '<path d="M12 7.6c-1.4-1-3-1.4-4.6-.9C5 7.5 4 10.1 4.8 13.1c.8 3 2.6 6.4 4.9 6.4 1 0 1.3-.5 2.3-.5s1.3.5 2.3.5c2.3 0 4.1-3.4 4.9-6.4.8-3-.2-5.6-2.6-6.4-1.6-.5-3.2-.1-4.6.9z"/><path d="M12 7.6c0-2 .8-3.3 2.5-4"/>',
    leaf: '<path d="M5 19C5 10.5 9.5 5.5 19 5c0 9-4.5 13.5-12 13.5"/><path d="M5 19l8.4-8.4"/>',
    star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8L12 3.8z"/>',
    gift: '<path d="M4.5 11.5h15V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19v-7.5z"/><path d="M3.5 8h17v3.5h-17z"/><path d="M12 8v12.5"/><path d="M12 8C10 8 8 7.2 8 5.7s1.4-1.8 2.6-1S12 7.1 12 8zM12 8c2 0 4-.8 4-2.3s-1.4-1.8-2.6-1S12 7.1 12 8z"/>'
  };

  function icon(name, size) {
    const s = size || 20;
    return (
      '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || '') +
      '</svg>'
    );
  }

  // Íconos que se pueden elegir para una categoría: [clave, nombre que ve la persona].
  // La misma lista de claves está en lib/menu.js (el servidor solo guarda estas).
  const CAT_ICONS = [
    ['cup', 'Café'], ['icedcup', 'Bebida fría'], ['glass', 'Jugo o batido'], ['tea', 'Té'], ['bottle', 'Refresco'],
    ['waffle', 'Waffles'], ['donut', 'Donas'], ['croissant', 'Pastelería'], ['bread', 'Pan'], ['cookie', 'Galletas'],
    ['cupcake', 'Queques'], ['cake', 'Postres'], ['icecream', 'Helados'], ['candy', 'Dulces'], ['egg', 'Desayuno'],
    ['sandwich', 'Sándwich'], ['burger', 'Hamburguesa'], ['pizza', 'Pizza'], ['fries', 'Papas'], ['bowl', 'Sopa o bowl'],
    ['fruit', 'Frutas'], ['leaf', 'Saludable'], ['fork', 'Comidas'], ['gift', 'Combos'], ['star', 'Especiales']
  ];

  // Si la categoría no tiene un ícono elegido, se adivina por su nombre (de lo más específico a lo más general).
  const AUTO_ICON = [
    [/waffle|wafle|crepa|panqueque|pancake|hotcake/, 'waffle'],
    [/dona|donut|rosquilla/, 'donut'],
    [/croissant|cruasan|pasteleria|reposteria|hojaldre|pan dulce/, 'croissant'],
    [/sandwich|sanduche|emparedado/, 'sandwich'],
    [/hamburgues|burger/, 'burger'],
    [/pizza/, 'pizza'],
    [/papas|snack|frituras|fritas/, 'fries'],
    [/(cafe|te|bebidas?) helad/, 'icedcup'],
    [/helado|nieve|gelato|paleta/, 'icecream'],
    [/galleta|cookie/, 'cookie'],
    [/queque|muffin|cupcake|magdalena/, 'cupcake'],
    [/pastel|torta|tarta|postre|brownie/, 'cake'],
    [/dulce|golosina|confite|bombon/, 'candy'],
    [/desayuno|huevo|brunch/, 'egg'],
    [/frapp|frio|fria|iced|granizad/, 'icedcup'],
    [/jugo|batido|smoothie|licuado|limonada|natural/, 'glass'],
    [/refresco|gaseosa|soda|agua/, 'bottle'],
    [/(^| )te( |$)|infusion|tisana/, 'tea'],
    [/cafe|capuch|latte|espresso|americano|moka|chocolate caliente|bebida|caliente/, 'cup'],
    [/ensalada|saludable|vegan|vegetar/, 'leaf'],
    [/fruta/, 'fruit'],
    [/sopa|bowl|casado|arroz|almuerzo/, 'bowl'],
    [/(^| )pan(es)?( |$)|panaderia/, 'bread'],
    [/combo|promo|regalo|paquete/, 'gift'],
    [/especial|favorit|destacad|popular/, 'star']
  ];

  function categoryIcon(name) {
    const n = norm(name);
    for (let i = 0; i < AUTO_ICON.length; i++) {
      if (AUTO_ICON[i][0].test(n)) return AUTO_ICON[i][1];
    }
    return 'fork';
  }

  // Ícono de una categoría: el que se eligió, o el que se adivina por el nombre.
  function catIcon(c) {
    const id = c && c.icon;
    return CAT_ICONS.some((x) => x[0] === id) ? id : categoryIcon(c && c.name);
  }

  function hydrateIcons(rootEl) {
    (rootEl || document).querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = icon(el.getAttribute('data-icon'), el.getAttribute('data-size'));
      el.removeAttribute('data-icon');
    });
  }

  return {
    TZ, KEYS, DAY_NAMES, DAY_SHORT, JS_DAY,
    esc, money, norm, slug, uid, digits, validPhone, phoneDisplay, waLink,
    crNow, fmtTime, fmtDate, getStatus, scheduleLines,
    promoOn, unitPrice, bannerOn, joinNames,
    ICONS, icon, CAT_ICONS, categoryIcon, catIcon, hydrateIcons
  };
});
