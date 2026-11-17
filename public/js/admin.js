/* Panel de administración: productos, fotos, categorías, promos, horario y ajustes. */
(function () {
  'use strict';

  const A = window.AC;
  const esc = A.esc, money = A.money, icon = A.icon;
  const $ = (s, r) => (r || document).querySelector(s);

  const TOKEN_KEY = 'antojos_admin_token';
  const LOCAL_KEY = 'antojos_menu_local';
  const PLACEHOLDER = '/assets/art/placeholder.svg';
  const TABS = [
    { id: 'productos', label: 'Productos', ic: 'box' },
    { id: 'categorias', label: 'Categorías', ic: 'list' },
    { id: 'promos', label: 'Promos', ic: 'tag' },
    { id: 'horario', label: 'Horario', ic: 'clock' },
    { id: 'ajustes', label: 'Ajustes', ic: 'sliders' }
  ];

  const S = { token: '', storage: 'redis', menu: null, rev: 0, version: 0, save: 'idle', saveMsg: '', tab: 'productos', pq: '', pcat: 'all', sort: false, today: '', newIcon: '' };
  let DRAFT = null; // borrador del producto o promo que se está editando

  /* ---------- utilidades ---------- */
  async function api(method, url, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    let res;
    try {
      res = await fetch(url, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch (e) {
      throw { status: 0, code: 'network' };
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) throw { status: res.status, code: (data && data.error) || 'http_' + res.status, data: data };
    return data;
  }

  let toastT = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => {
      t.hidden = true;
    }, 2600);
  }

  function confirmDlg(o) {
    return new Promise((resolve) => {
      const d = $('#confirm');
      d.innerHTML =
        '<div class="dlg-body"><h2>' + esc(o.title) + '</h2>' + (o.text ? '<p>' + esc(o.text) + '</p>' : '') + '</div>' +
        '<div class="dlg-foot"><button type="button" class="btn line" data-v="no">' + esc(o.cancel || 'Cancelar') + '</button>' +
        '<button type="button" class="btn ' + (o.danger ? 'danger-solid' : '') + '" data-v="ok">' + esc(o.ok || 'Aceptar') + '</button></div>';
      d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
      d.onclick = (e) => {
        const b = e.target.closest('[data-v]');
        if (b) d.close(b.getAttribute('data-v'));
        else if (e.target === d) d.close('no');
      };
      d.returnValue = '';
      d.showModal();
    });
  }

  function alertDlg(title, text) {
    return confirmDlg({ title: title, text: text, ok: 'Entendido', cancel: 'Cerrar' });
  }

  const dlg = $('#dlg');
  function showDlg(html) {
    dlg.innerHTML = html;
    if (!dlg.open) dlg.showModal();
  }
  function closeDlg() {
    if (dlg.open) dlg.close();
  }
  dlg.addEventListener('close', () => {
    DRAFT = null;
    dlg.innerHTML = '';
  });

  function showErr(el, msg) {
    el.textContent = msg;
    el.hidden = !msg;
  }

  function parseMoney(v) {
    const d = String(v == null ? '' : v).replace(/\D/g, '');
    return d === '' ? null : Math.min(99999999, parseInt(d, 10));
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isFinite(n) && n >= 0 ? Math.round(n) : null;
  }

  function str(v, max) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  const catName = (id) => {
    const c = S.menu.categories.find((x) => x.id === id);
    return c ? c.name : '';
  };

  /* ---------- menú: normalización y guardado ---------- */
  function normalizeMenu(m) {
    if (!m || typeof m !== 'object') return null;
    const st = m.settings && typeof m.settings === 'object' ? m.settings : {};
    const sch = {};
    A.KEYS.forEach((k) => {
      const x = (st.schedule && st.schedule[k]) || {};
      sch[k] = { open: !!x.open, from: /^\d\d:\d\d$/.test(x.from) ? x.from : '08:00', to: /^\d\d:\d\d$/.test(x.to) ? x.to : '17:00' };
    });
    const settings = {
      name: str(st.name, 60) || 'Antojos, Café y Más',
      whatsapp: A.validPhone(String(st.whatsapp || '')) ? String(st.whatsapp) : '50670668903',
      address: str(st.address, 160),
      heroTitle: str(st.heroTitle, 60),
      orderIntro: str(st.orderIntro, 120) || '¡Hola! Quiero hacer un pedido:',
      mode: st.mode === 'auto' || st.mode === 'closed' ? st.mode : 'open',
      closedMessage: str(st.closedMessage, 160),
      acceptWhenClosed: !!st.acceptWhenClosed,
      schedule: sch
    };
    // Los identificadores solo deben ser únicos dentro de su propia lista (una categoría "cafe" y un producto "cafe" pueden convivir).
    const uniqIn = () => {
      const used = new Set();
      return (id, prefix) => {
        let x = typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(id) && !used.has(id) ? id : '';
        while (!x) {
          x = A.uid(prefix);
          if (used.has(x)) x = '';
        }
        used.add(x);
        return x;
      };
    };
    const uniqCat = uniqIn();
    const uniqProd = uniqIn();
    const uniqPromo = uniqIn();
    const categories = (Array.isArray(m.categories) ? m.categories : [])
      .filter((c) => c && str(c.name, 40))
      .map((c) => {
        const o = { id: uniqCat(c.id, 'c'), name: str(c.name, 40), hidden: !!c.hidden };
        if (A.CAT_ICONS.some((x) => x[0] === c.icon)) o.icon = c.icon;
        return o;
      });
    const catIds = new Set(categories.map((c) => c.id));
    const products = (Array.isArray(m.products) ? m.products : [])
      .filter((p) => p && str(p.name, 60))
      .map((p) => {
        const promoPrice = num(p.promoPrice);
        return {
          id: uniqProd(p.id, 'p'),
          categoryId: catIds.has(p.categoryId) ? p.categoryId : categories[0] ? categories[0].id : '',
          name: str(p.name, 60),
          desc: str(p.desc, 220),
          price: num(p.price),
          promoPrice: promoPrice,
          promoLabel: promoPrice === null ? '' : str(p.promoLabel, 14),
          promoUntil: promoPrice === null || !/^\d{4}-\d{2}-\d{2}$/.test(p.promoUntil || '') ? '' : p.promoUntil,
          image: typeof p.image === 'string' ? p.image : '',
          soldOut: !!p.soldOut,
          hidden: !!p.hidden
        };
      });
    const pids = new Set(products.map((p) => p.id));
    const promos = (Array.isArray(m.promos) ? m.promos : [])
      .filter((b) => b && str(b.title, 60))
      .map((b) => ({
        id: uniqPromo(b.id, 'm'),
        title: str(b.title, 60),
        text: str(b.text, 200),
        badge: str(b.badge, 14),
        active: !!b.active,
        until: /^\d{4}-\d{2}-\d{2}$/.test(b.until || '') ? b.until : '',
        productId: pids.has(b.productId) ? b.productId : ''
      }));
    return { settings: settings, categories: categories, products: products, promos: promos };
  }

  function readLocal() {
    try {
      const o = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      return o && o.menu ? o.menu : null;
    } catch (e) {
      return null;
    }
  }

  let saving = false;
  let pending = false;

  function setSave(state, msg) {
    S.save = state;
    S.saveMsg = msg || '';
    renderSync();
    renderBanner();
  }

  function commit(fn) {
    fn(S.menu);
    S.version++;
    queueSave();
  }

  function queueSave() {
    if (S.save === 'conflict') return;
    pending = true;
    setSave('saving');
    if (!saving) runSave();
  }

  async function runSave() {
    saving = true;
    while (pending) {
      pending = false;
      const ok = await doSave();
      if (!ok) {
        pending = false;
        break;
      }
    }
    saving = false;
    if (S.save === 'saving') {
      setSave('saved');
      setTimeout(() => {
        if (S.save === 'saved' && !saving) {
          S.save = 'idle';
          renderSync();
        }
      }, 2500);
    }
  }

  async function doSave() {
    if (S.storage === 'none') {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify({ rev: S.rev, menu: S.menu }));
        return true;
      } catch (e) {
        setSave('error', 'No hay espacio para guardar en este navegador. Usa fotos más pequeñas o conecta la base de datos.');
        return false;
      }
    }
    const sent = S.version;
    try {
      const r = await api('PUT', '/api/menu', { menu: S.menu, baseRev: S.rev });
      S.rev = r.rev;
      if (sent === S.version) S.menu = r.menu;
      // Avisa al sitio si está abierto en otra pestaña de este navegador, para que muestre el cambio de inmediato.
      try {
        localStorage.setItem('antojos_menu_ping', String(Date.now()));
      } catch (e) {
        /* sin aviso entre pestañas: el sitio se actualiza solo en unos segundos */
      }
      return true;
    } catch (e) {
      if (e.status === 401) setSave('error', 'Tu sesión venció. Entra de nuevo para seguir guardando.', 'login');
      else if (e.status === 409) setSave('conflict');
      else if (e.code === 'network') setSave('error', 'Sin conexión. Tus cambios no se han guardado.');
      else setSave('error', 'No se pudo guardar. Inténtalo de nuevo.');
      return false;
    }
  }

  window.addEventListener('beforeunload', (e) => {
    if (S.save === 'saving' || S.save === 'error') {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ---------- pantallas de acceso ---------- */
  function gate(kind, msg) {
    const logo = '<img src="/assets/logo-sm.webp" alt="" width="92" height="84">';
    let html;
    if (kind === 'loading') {
      html = '<p class="boot">Cargando…</p>';
    } else if (kind === 'login') {
      html =
        '<form class="gate card" id="loginForm" novalidate>' + logo + '<h1>Panel de administración</h1>' +
        '<p style="text-align:center">Antojos, Café y Más</p>' +
        '<div class="f"><label for="pw">Contraseña</label><div class="pw"><input class="fld" id="pw" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false">' +
        '<button type="button" class="eye" data-act="toggle-pw" aria-label="Mostrar contraseña">' + icon('eye', 22) + '</button></div></div>' +
        '<p class="err" id="loginErr" hidden></p><button class="btn" id="loginBtn" type="submit">Entrar</button></form>';
    } else if (kind === 'setup' || kind === 'short') {
      html =
        '<div class="gate card">' + logo + '<h1>' + (kind === 'short' ? 'La contraseña es muy corta' : 'Falta crear la contraseña') + '</h1>' +
        '<p>' + (kind === 'short' ? 'La contraseña del panel debe tener al menos 6 caracteres. Cámbiala así:' : 'Para proteger este panel, crea la contraseña en Vercel:') + '</p>' +
        '<ol><li>Abre tu proyecto en Vercel y entra a <b>Settings → Environment Variables</b>.</li>' +
        '<li>Crea (o edita) la variable <code>ADMIN_PASSWORD</code> con la contraseña que quieras.</li>' +
        '<li>Ve a <b>Deployments</b>, abre el menú ⋯ del último y elige <b>Redeploy</b>.</li></ol>' +
        '<button class="btn" type="button" data-act="reload">Ya lo hice, volver a intentar</button></div>';
    } else {
      html =
        '<div class="gate card">' + logo + '<h1>No se pudo abrir el panel</h1><p>' + esc(msg || 'Ocurrió un problema.') + '</p>' +
        '<button class="btn" type="button" data-act="reload">Reintentar</button></div>';
    }
    $('#root').innerHTML = html;
    const pw = $('#pw');
    if (pw) pw.focus();
  }

  async function doLogin() {
    const pw = $('#pw').value;
    const err = $('#loginErr');
    if (!pw.trim()) return showErr(err, 'Escribe la contraseña.');
    const btn = $('#loginBtn');
    btn.disabled = true;
    showErr(err, '');
    try {
      const r = await api('POST', '/api/login', { password: pw });
      S.token = r.token;
      localStorage.setItem(TOKEN_KEY, r.token);
      await boot();
    } catch (e) {
      btn.disabled = false;
      showErr(
        err,
        e.status === 401 ? 'Contraseña incorrecta.' : e.status === 429 ? 'Demasiados intentos. Espera unos 15 minutos y vuelve a intentar.' : e.code === 'network' ? 'Sin conexión. Inténtalo de nuevo.' : 'No se pudo entrar. Inténtalo de nuevo.'
      );
    }
  }

  async function boot() {
    S.token = localStorage.getItem(TOKEN_KEY) || '';
    gate('loading');
    let r;
    try {
      r = await api('GET', '/api/menu?fresh=1&t=' + Date.now());
    } catch (e) {
      return gate('error', 'No hay conexión con el servidor. Revisa tu internet.');
    }
    S.storage = r.storage;
    if (r.password !== 'ok') return gate(r.password === 'short' ? 'short' : 'setup');
    if (!r.authed) {
      S.token = '';
      localStorage.removeItem(TOKEN_KEY);
      return gate('login');
    }
    if (r.storage === 'error') return gate('error', 'La base de datos no responde. Revisa que siga conectada en Vercel (Storage).');
    S.rev = r.rev;
    S.menu = normalizeMenu(r.storage === 'none' ? readLocal() || r.menu : r.menu);
    S.version = 0;
    S.save = 'idle';
    shell();
    setTab(S.tab);
  }

  /* ---------- estructura ---------- */
  function shell() {
    $('#root').innerHTML =
      '<div class="app"><header class="top"><a class="top-brand" href="/" target="_blank" rel="noopener" aria-label="Ver el sitio">' +
      '<img src="/assets/logo-sm.webp" alt="" width="44" height="40"><span><b>Panel</b><small>' + esc(S.menu.settings.name) + '</small></span></a>' +
      '<div class="top-act"><span class="sync" id="sync" hidden></span>' +
      '<a class="btn line sm" href="/" target="_blank" rel="noopener" aria-label="Ver el sitio">' + icon('external', 18) + '<span class="lbl">Ver sitio</span></a>' +
      '<button class="btn ghost sm" type="button" data-act="logout" aria-label="Salir">' + icon('logout', 18) + '<span class="lbl">Salir</span></button></div></header>' +
      '<div id="banner"></div><div class="shell"><nav class="tabs" id="tabs" aria-label="Secciones">' +
      TABS.map((t) => '<button type="button" class="tabbtn" data-act="tab" data-tab="' + t.id + '">' + icon(t.ic, 22) + '<span>' + t.label + '</span></button>').join('') +
      '</nav><main class="view" id="view"></main></div></div>';
    renderSync();
    renderBanner();
  }

  function renderSync() {
    const el = $('#sync');
    if (!el) return;
    const map = {
      saving: ['saving', 'Guardando…'],
      saved: ['saved', S.storage === 'none' ? 'Guardado local' : 'Guardado'],
      error: ['error', 'Sin guardar'],
      conflict: ['conflict', 'Conflicto']
    };
    const m = map[S.save];
    el.hidden = !m;
    if (m) {
      el.className = 'sync ' + m[0];
      el.textContent = m[1];
    }
  }

  function renderBanner() {
    const el = $('#banner');
    if (!el) return;
    let html = '';
    if (S.save === 'conflict') {
      html = '<div class="banner bad"><div>Otro dispositivo cambió el menú mientras lo editabas. Recarga para ver lo más reciente (tus últimos cambios no se guardaron).</div><button class="btn sm" type="button" data-act="reload">Recargar</button></div>';
    } else if (S.save === 'error') {
      html = '<div class="banner bad"><div>' + esc(S.saveMsg) + '</div>' +
        (S.saveMsg.indexOf('sesión') !== -1
          ? '<button class="btn sm" type="button" data-act="logout">Entrar de nuevo</button>'
          : '<button class="btn sm" type="button" data-act="retry-save">Reintentar</button>') + '</div>';
    } else if (S.storage === 'none') {
      html = '<div class="banner warn"><div>La base de datos todavía no está conectada: lo que cambies aquí solo se guarda en este navegador y tus clientes no lo verán. Conéctala en Vercel → Storage y vuelve a desplegar (los pasos están en el README).</div></div>';
    }
    el.innerHTML = html;
  }

  function setTab(id, keep) {
    S.tab = id;
    if (!keep) S.newIcon = '';
    document.querySelectorAll('.tabbtn').forEach((b) => {
      if (b.getAttribute('data-tab') === id) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    const v = $('#view');
    const views = { productos: viewProductos, categorias: viewCategorias, promos: viewPromos, horario: viewHorario, ajustes: viewAjustes };
    v.innerHTML = views[id]();
    if (id === 'productos') {
      renderSummary();
      renderPList();
    }
    if (id === 'horario') renderHoursPreview();
    if (!keep) window.scrollTo(0, 0);
  }

  /* ---------- productos ---------- */
  function viewProductos() {
    const cats = S.menu.categories;
    if (!cats.length) {
      return '<div class="vh"><h1>Productos</h1></div><div class="empty"><h3>Primero crea una categoría</h3><p>Las categorías agrupan el menú, por ejemplo Café, Waffles o Donas.</p><button class="btn accent" type="button" data-act="tab" data-tab="categorias">' + icon('plus', 18) + 'Crear categoría</button></div>';
    }
    return (
      '<div class="vh"><h1>Productos</h1><button class="btn accent" type="button" data-act="new-product">' + icon('plus', 18) + 'Nuevo producto</button></div>' +
      '<div class="toolbar"><label class="tsearch">' + icon('search', 18) + '<input class="fld" id="pq" type="search" placeholder="Buscar producto" aria-label="Buscar producto" autocomplete="off" value="' + esc(S.pq) + '"></label>' +
      '<select class="fld" id="pcat" aria-label="Filtrar por categoría"><option value="all">Todas las categorías</option>' +
      cats.map((c) => '<option value="' + esc(c.id) + '"' + (S.pcat === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select>' +
      '<button class="btn line sm" type="button" data-act="sort-toggle" aria-pressed="' + S.sort + '">' + icon('up', 16) + icon('down', 16) + (S.sort ? 'Listo' : 'Ordenar') + '</button></div>' +
      '<p class="psum" id="psum"></p><div id="plist"></div>'
    );
  }

  function renderSummary() {
    const el = $('#psum');
    if (!el) return;
    S.today = A.crNow().ymd;
    const ps = S.menu.products;
    const sold = ps.filter((p) => p.soldOut).length;
    const promo = ps.filter((p) => A.promoOn(p, S.today)).length;
    const hid = ps.filter((p) => p.hidden).length;
    const parts = [ps.length + (ps.length === 1 ? ' producto' : ' productos')];
    if (sold) parts.push(sold + (sold === 1 ? ' agotado' : ' agotados'));
    if (promo) parts.push(promo + ' en promo');
    if (hid) parts.push(hid + (hid === 1 ? ' oculto' : ' ocultos'));
    el.textContent = parts.join(' · ');
  }

  function productRow(p) {
    const state = p.promoPrice == null ? '' : A.promoOn(p, S.today) ? 'on' : 'old';
    const price = p.price == null ? '<span class="noprice">Sin precio</span>' : '<span>' + esc(money(p.price)) + '</span>';
    const promo =
      state === 'on' ? '<span class="tag promo">' + esc(p.promoLabel || 'Promo') + ' · ' + esc(money(p.promoPrice)) + '</span>' : state === 'old' ? '<span class="tag off">Promo vencida</span>' : '';
    const tags = (p.soldOut ? '<span class="tag sold">Agotado</span>' : '') + (p.hidden ? '<span class="tag off">Oculto</span>' : '');
    const info =
      '<img class="thumb" src="' + esc(p.image || PLACEHOLDER) + '" alt="" loading="lazy"><span style="min-width:0"><span class="prow-name">' + esc(p.name) + '</span>' +
      '<span class="prow-meta">' + price + promo + tags + '</span></span>';
    if (S.sort) {
      return (
        '<div class="prow"><div class="prow-main">' + info + '</div><div class="mv">' +
        '<button class="rb sm" type="button" data-act="move-up" data-id="' + esc(p.id) + '" aria-label="Subir ' + esc(p.name) + '">' + icon('up', 18) + '</button>' +
        '<button class="rb sm" type="button" data-act="move-down" data-id="' + esc(p.id) + '" aria-label="Bajar ' + esc(p.name) + '">' + icon('down', 18) + '</button></div></div>'
      );
    }
    return (
      '<div class="prow"><button class="prow-main" type="button" data-act="edit-product" data-id="' + esc(p.id) + '" aria-label="Editar ' + esc(p.name) + '">' + info + '</button>' +
      '<div class="swcol"><button class="sw warn" type="button" role="switch" aria-checked="' + p.soldOut + '" data-act="toggle-sold" data-id="' + esc(p.id) + '" aria-label="Agotado: ' + esc(p.name) + '"></button><span>Agotado</span></div></div>'
    );
  }

  function renderPList() {
    const el = $('#plist');
    if (!el) return;
    S.today = A.crNow().ymd;
    const q = A.norm(S.pq.trim());
    let html = '';
    let shown = 0;
    S.menu.categories.forEach((c) => {
      if (S.pcat !== 'all' && S.pcat !== c.id) return;
      const list = S.menu.products.filter((p) => p.categoryId === c.id && (!q || A.norm(p.name + ' ' + p.desc).indexOf(q) !== -1));
      if (!list.length) return;
      shown += list.length;
      html += '<h3 class="grp">' + esc(c.name) + ' · ' + list.length + (c.hidden ? ' <span class="tag off">Categoría oculta</span>' : '') + '</h3>' + list.map(productRow).join('');
    });
    if (!shown) {
      html = S.menu.products.length
        ? '<div class="empty"><h3>No hay resultados</h3><p>Prueba con otra palabra o categoría.</p></div>'
        : '<div class="empty"><h3>Aún no hay productos</h3><p>Agrega el primero para que aparezca en el menú.</p><button class="btn accent" type="button" data-act="new-product">' + icon('plus', 18) + 'Nuevo producto</button></div>';
    }
    el.innerHTML = html;
  }

  function moveProduct(id, dir) {
    const arr = S.menu.products;
    const i = arr.findIndex((p) => p.id === id);
    if (i < 0) return;
    const cat = arr[i].categoryId;
    let j = i + dir;
    while (j >= 0 && j < arr.length && arr[j].categoryId !== cat) j += dir;
    if (j < 0 || j >= arr.length) return;
    commit((m) => {
      const t = m.products[i];
      m.products[i] = m.products[j];
      m.products[j] = t;
    });
    renderPList();
  }

  /* ---------- editor de producto ---------- */
  function openProduct(id) {
    const cats = S.menu.categories;
    if (!id && !cats.length) {
      toast('Primero crea una categoría.');
      return setTab('categorias');
    }
    const p = id ? S.menu.products.find((x) => x.id === id) : null;
    if (id && !p) return;
    DRAFT = {
      type: 'product',
      id: id || '',
      image: p ? p.image : '',
      soldOut: p ? p.soldOut : false,
      hidden: p ? p.hidden : false,
      promoOn: p ? p.promoPrice != null : false,
      busy: 0
    };
    const v = p || {
      categoryId: S.pcat !== 'all' && cats.some((c) => c.id === S.pcat) ? S.pcat : cats[0].id,
      name: '', desc: '', price: null, promoPrice: null, promoLabel: '', promoUntil: ''
    };
    const sw = (k, label, hint, warn) =>
      '<div class="swrow"><div><b>' + label + '</b><p class="hint">' + hint + '</p></div><button type="button" class="sw' + (warn ? ' warn' : '') + '" role="switch" aria-checked="' + DRAFT[k] + '" data-act="sw" data-k="' + k + '" aria-label="' + label + '"></button></div>';
    showDlg(
      '<form id="pform" novalidate><div class="dlg-head"><h2>' + (p ? 'Editar producto' : 'Nuevo producto') + '</h2>' +
      '<button type="button" class="rb" data-act="dlg-close" aria-label="Cerrar">' + icon('close', 20) + '</button></div><div class="dlg-body">' +
      '<div class="photo"><div class="photo-frame"><img id="pf-img" src="' + esc(DRAFT.image || PLACEHOLDER) + '" alt="Foto del producto"><div class="busy" id="pf-busy" hidden>Subiendo…</div></div>' +
      '<div class="photo-btns"><label class="btn line sm">' + icon('camera', 18) + '<span id="pf-filelbl">' + (DRAFT.image ? 'Cambiar foto' : 'Agregar foto') + '</span><input class="sr" id="pf-file" type="file" accept="image/*"></label>' +
      '<button type="button" class="btn ghost sm" id="pf-rm" data-act="photo-remove"' + (DRAFT.image ? '' : ' hidden') + '>Quitar foto</button>' +
      '<p class="hint">La foto se recorta al centro en formato 4:3.</p></div></div>' +
      '<div class="f"><label for="pf-name">Nombre</label><input class="fld" id="pf-name" maxlength="60" autocomplete="off" value="' + esc(v.name) + '"></div>' +
      '<div class="f"><label for="pf-desc">Descripción (opcional)</label><textarea class="fld" id="pf-desc" rows="2" maxlength="220">' + esc(v.desc) + '</textarea></div>' +
      '<div class="row2"><div class="f"><label for="pf-cat">Categoría</label><select class="fld" id="pf-cat">' +
      cats.map((c) => '<option value="' + esc(c.id) + '"' + (v.categoryId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></div>' +
      '<div class="f"><label for="pf-price">Precio</label><div class="money"><span>₡</span><input class="fld" id="pf-price" inputmode="numeric" autocomplete="off" placeholder="Sin precio" value="' + (v.price == null ? '' : v.price) + '"></div></div></div>' +
      '<div class="box">' + sw('promoOn', 'En promoción', 'Muestra un precio rebajado y una etiqueta en el menú.', false) +
      '<div class="stack" id="pf-promo" style="margin-top:10px"' + (DRAFT.promoOn ? '' : ' hidden') + '><div class="row3">' +
      '<div class="f"><label for="pf-pp">Precio promo</label><div class="money"><span>₡</span><input class="fld" id="pf-pp" inputmode="numeric" autocomplete="off" value="' + (v.promoPrice == null ? '' : v.promoPrice) + '"></div></div>' +
      '<div class="f"><label for="pf-pl">Etiqueta</label><input class="fld" id="pf-pl" maxlength="14" placeholder="Promo" autocomplete="off" value="' + esc(v.promoLabel) + '"></div>' +
      '<div class="f"><label for="pf-pu">Hasta (opcional)</label><input class="fld" id="pf-pu" type="date" value="' + esc(v.promoUntil) + '"></div></div></div></div>' +
      '<div class="box">' + sw('soldOut', 'Agotado', 'Se muestra “Agotado” y no se puede pedir.', true) + sw('hidden', 'Ocultar del menú', 'No aparece en el sitio, pero no se borra.', false) + '</div>' +
      '<p class="err" id="pf-err" hidden></p></div>' +
      '<div class="dlg-foot">' + (p ? '<button type="button" class="btn danger" data-act="p-delete">Eliminar</button>' : '') +
      '<span class="grow"></span><button type="button" class="btn line" data-act="dlg-close">Cancelar</button><button type="submit" class="btn" id="pf-save">Guardar</button></div></form>'
    );
    if (!p) $('#pf-name').focus();
  }

  function setBusy(on) {
    DRAFT.busy += on ? 1 : -1;
    const busy = DRAFT.busy > 0;
    $('#pf-busy').hidden = !busy;
    $('#pf-save').disabled = busy;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('read'));
      };
      img.src = url;
    });
  }

  function toBlob(canvas, type, q) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, q));
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('read'));
      r.readAsDataURL(blob);
    });
  }

  // Recorta al centro en 4:3, reduce a 800x600 y comprime (WebP o JPEG) para que la foto pese poco.
  async function processImage(file) {
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) throw new Error('type');
    const img = await loadImage(file);
    const W = 800, H = 600;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.fillStyle = '#FFFEFB';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    let q = 0.86;
    let blob = null;
    for (let i = 0; i < 4; i++) {
      blob = await toBlob(canvas, 'image/webp', q);
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', q);
      if (blob && blob.size < 420000) break;
      q -= 0.16;
    }
    if (!blob) throw new Error('encode');
    return blobToDataURL(blob);
  }

  async function onPhoto(file) {
    if (!file || !DRAFT) return;
    const err = $('#pf-err');
    showErr(err, '');
    setBusy(true);
    try {
      const dataUrl = await processImage(file);
      const url = S.storage === 'none' ? dataUrl : (await api('POST', '/api/upload', { dataUrl: dataUrl })).url;
      if (!DRAFT) return;
      DRAFT.image = url;
      $('#pf-img').src = url;
      $('#pf-rm').hidden = false;
      $('#pf-filelbl').textContent = 'Cambiar foto';
    } catch (e) {
      if (DRAFT) {
        showErr(
          err,
          e && e.status === 401 ? 'Tu sesión venció. Cierra esta ventana y entra de nuevo.' : e && e.code === 'network' ? 'Sin conexión: no se pudo subir la foto.' : e && e.status ? 'No se pudo subir la foto. Inténtalo con otra.' : 'No se pudo leer esa imagen. Prueba con otra foto (JPG o PNG).'
        );
      }
    } finally {
      if (DRAFT) {
        setBusy(false);
        const f = $('#pf-file');
        if (f) f.value = '';
      }
    }
  }

  function saveProduct() {
    if (!DRAFT || DRAFT.type !== 'product' || DRAFT.busy) return;
    const err = $('#pf-err');
    const name = str($('#pf-name').value, 60);
    if (!name) {
      showErr(err, 'Escribe el nombre del producto.');
      return $('#pf-name').focus();
    }
    const price = parseMoney($('#pf-price').value);
    let promoPrice = null;
    if (DRAFT.promoOn) {
      promoPrice = parseMoney($('#pf-pp').value);
      if (promoPrice === null) {
        showErr(err, 'Escribe el precio de la promo.');
        return $('#pf-pp').focus();
      }
      if (price !== null && promoPrice >= price) {
        showErr(err, 'El precio de la promo debe ser menor que el precio normal.');
        return $('#pf-pp').focus();
      }
    }
    const fields = {
      categoryId: $('#pf-cat').value,
      name: name,
      desc: str($('#pf-desc').value, 220),
      price: price,
      promoPrice: promoPrice,
      promoLabel: promoPrice === null ? '' : str($('#pf-pl').value, 14),
      promoUntil: promoPrice === null ? '' : $('#pf-pu').value || '',
      image: DRAFT.image,
      soldOut: DRAFT.soldOut,
      hidden: DRAFT.hidden
    };
    const id = DRAFT.id;
    commit((m) => {
      if (id) Object.assign(m.products.find((x) => x.id === id), fields);
      else m.products.push(Object.assign({ id: A.uid('p') }, fields));
    });
    closeDlg();
    if (S.tab === 'productos') {
      renderSummary();
      renderPList();
    } else if (S.tab === 'promos') setTab('promos', true);
    toast(id ? 'Producto guardado' : 'Producto agregado');
  }

  async function deleteProduct() {
    if (!DRAFT || !DRAFT.id) return;
    const id = DRAFT.id;
    const p = S.menu.products.find((x) => x.id === id);
    const ok = await confirmDlg({ title: '¿Eliminar “' + (p ? p.name : '') + '”?', text: 'Se quita del menú y no se puede deshacer.', ok: 'Eliminar', danger: true });
    if (!ok) return;
    commit((m) => {
      m.products = m.products.filter((x) => x.id !== id);
      m.promos.forEach((b) => {
        if (b.productId === id) b.productId = '';
      });
    });
    closeDlg();
    if (S.tab === 'productos') {
      renderSummary();
      renderPList();
    } else setTab(S.tab, true);
    toast('Producto eliminado');
  }

  /* ---------- categorías ---------- */
  function viewCategorias() {
    const cats = S.menu.categories;
    const rows = cats
      .map((c, i) => {
        const n = S.menu.products.filter((p) => p.categoryId === c.id).length;
        return (
          '<div class="crow"><div class="crow-top"><button class="cic" type="button" data-act="cat-icon" data-id="' + esc(c.id) + '" aria-label="Cambiar el ícono de ' + esc(c.name) + '" title="Cambiar el ícono">' + icon(A.catIcon(c), 24) + '</button><input class="fld" data-f="cname" data-id="' + esc(c.id) + '" value="' + esc(c.name) + '" maxlength="40" aria-label="Nombre de la categoría" autocomplete="off"></div>' +
          '<div class="crow-act"><span class="hint">' + n + (n === 1 ? ' producto' : ' productos') + '</span>' +
          '<button class="rb sm" type="button" data-act="cat-up" data-id="' + esc(c.id) + '" aria-label="Subir ' + esc(c.name) + '"' + (i === 0 ? ' disabled' : '') + '>' + icon('up', 18) + '</button>' +
          '<button class="rb sm" type="button" data-act="cat-down" data-id="' + esc(c.id) + '" aria-label="Bajar ' + esc(c.name) + '"' + (i === cats.length - 1 ? ' disabled' : '') + '>' + icon('down', 18) + '</button>' +
          '<span class="vis">Visible<button class="sw" type="button" role="switch" aria-checked="' + !c.hidden + '" data-act="cat-vis" data-id="' + esc(c.id) + '" aria-label="Mostrar ' + esc(c.name) + ' en el menú"></button></span>' +
          '<button class="rb sm bad" type="button" data-act="cat-del" data-id="' + esc(c.id) + '" aria-label="Eliminar ' + esc(c.name) + '">' + icon('trash', 18) + '</button></div></div>'
        );
      })
      .join('');
    return (
      '<div class="vh"><h1>Categorías</h1></div><p class="hint" style="margin-bottom:12px">Agrupan el menú (por ejemplo Café, Waffles, Donas). Su orden aquí es el orden en el sitio. Para cambiar el nombre, edítalo directamente; para cambiar el ícono, toca el círculo de la izquierda.</p>' +
      (rows || '<div class="empty"><h3>Aún no hay categorías</h3><p>Crea la primera con el campo de abajo.</p></div>') +
      '<form class="addrow" id="catForm" novalidate><button class="cic" id="newCatIc" type="button" data-act="cat-icon-new" aria-label="Elegir el ícono de la nueva categoría" title="Elegir el ícono">' + icon(S.newIcon || A.categoryIcon(''), 24) + '</button><input class="fld" id="newCat" maxlength="40" placeholder="Nueva categoría" aria-label="Nombre de la nueva categoría" autocomplete="off">' +
      '<button class="btn accent" type="submit">' + icon('plus', 18) + 'Agregar</button></form>'
    );
  }

  function addCategory() {
    const inp = $('#newCat');
    const name = str(inp.value, 40);
    if (!name) {
      toast('Escribe el nombre de la categoría.');
      return inp.focus();
    }
    if (S.menu.categories.some((c) => A.norm(c.name) === A.norm(name))) {
      toast('Ya existe una categoría con ese nombre.');
      return inp.focus();
    }
    if (S.menu.categories.length >= 30) return toast('Llegaste al máximo de 30 categorías.');
    const ids = new Set(S.menu.categories.map((c) => c.id));
    let id = A.slug(name) || A.uid('c');
    let n = 2;
    while (ids.has(id)) id = (A.slug(name) || 'c') + '-' + n++;
    const cat = { id: id, name: name, hidden: false };
    if (S.newIcon) cat.icon = S.newIcon;
    S.newIcon = '';
    commit((m) => m.categories.push(cat));
    setTab('categorias', true);
    toast('Categoría agregada');
  }

  async function deleteCategory(id) {
    const c = S.menu.categories.find((x) => x.id === id);
    if (!c) return;
    const n = S.menu.products.filter((p) => p.categoryId === id).length;
    if (n) {
      return alertDlg('No se puede eliminar', '“' + c.name + '” tiene ' + n + (n === 1 ? ' producto' : ' productos') + '. Muévelos a otra categoría o elimínalos primero.');
    }
    const ok = await confirmDlg({ title: '¿Eliminar la categoría “' + c.name + '”?', ok: 'Eliminar', danger: true });
    if (!ok) return;
    commit((m) => {
      m.categories = m.categories.filter((x) => x.id !== id);
    });
    if (S.pcat === id) S.pcat = 'all';
    setTab('categorias', true);
  }

  function moveCategory(id, dir) {
    const i = S.menu.categories.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= S.menu.categories.length) return;
    commit((m) => {
      const t = m.categories[i];
      m.categories[i] = m.categories[j];
      m.categories[j] = t;
    });
    setTab('categorias', true);
  }

  // Selector de ícono. target = id de la categoría, o '' para la categoría que se está creando.
  function openIconPicker(target) {
    const c = target ? S.menu.categories.find((x) => x.id === target) : null;
    if (target && !c) return;
    const typed = $('#newCat');
    const cur = c ? A.catIcon(c) : S.newIcon || A.categoryIcon(typed ? typed.value : '');
    showDlg(
      '<div class="dlg-head"><h2>Elige un ícono</h2><button type="button" class="rb" data-act="dlg-close" aria-label="Cerrar">' + icon('close', 20) + '</button></div>' +
      '<div class="dlg-body icon-body"><p class="hint">' + (c ? 'Se ve junto a “' + esc(c.name) + '” en el menú.' : 'Se verá junto a la nueva categoría en el menú.') + '</p>' +
      '<div class="icons" role="group" aria-label="Íconos disponibles">' +
      A.CAT_ICONS.map(
        (x) =>
          '<button type="button" class="ico' + (x[0] === cur ? ' on' : '') + '" data-act="pick-icon" data-icon="' + x[0] + '" data-target="' + esc(target || '') + '" aria-pressed="' + (x[0] === cur) + '" aria-label="' + esc(x[1]) + '">' +
          icon(x[0], 28) + '<span>' + esc(x[1]) + '</span></button>'
      ).join('') +
      '</div></div>'
    );
    const on = dlg.querySelector('.ico.on');
    if (on) {
      on.focus();
      on.scrollIntoView({ block: 'nearest' });
    }
  }

  function pickIcon(ic, target) {
    if (!A.CAT_ICONS.some((x) => x[0] === ic)) return;
    closeDlg();
    if (!target) {
      S.newIcon = ic;
      const b = $('#newCatIc');
      if (b) b.innerHTML = icon(ic, 24);
      const inp = $('#newCat');
      if (inp) inp.focus();
      return;
    }
    const c = S.menu.categories.find((x) => x.id === target);
    if (!c) return;
    if (c.icon !== ic) {
      commit((m) => {
        m.categories.find((x) => x.id === target).icon = ic;
      });
    }
    setTab('categorias', true);
    toast('Ícono actualizado');
  }

  /* ---------- promos ---------- */
  function promoStatus(b) {
    if (!b.active) return ['off', 'Pausada'];
    if (b.until && S.today > b.until) return ['off', 'Vencida'];
    return ['on', 'Activa'];
  }

  function viewPromos() {
    S.today = A.crNow().ymd;
    const rows = S.menu.promos
      .map((b) => {
        const st = promoStatus(b);
        const pr = b.productId ? S.menu.products.find((p) => p.id === b.productId) : null;
        return (
          '<div class="mrow"><span class="mbadge">' + (b.badge ? esc(b.badge) : icon('tag', 24)) + '</span>' +
          '<button class="mmain" type="button" data-act="edit-promo" data-id="' + esc(b.id) + '" aria-label="Editar promo ' + esc(b.title) + '"><b>' + esc(b.title) + '</b>' +
          '<span><span class="tag ' + st[0] + '">' + st[1] + '</span>' + (b.until ? ' hasta ' + esc(A.fmtDate(b.until)) : '') + (pr ? ' · ' + esc(pr.name) : '') + '</span></button>' +
          '<button class="sw" type="button" role="switch" aria-checked="' + b.active + '" data-act="promo-active" data-id="' + esc(b.id) + '" aria-label="Promo activa: ' + esc(b.title) + '"></button></div>'
        );
      })
      .join('');
    const priced = S.menu.products.filter((p) => p.promoPrice != null);
    const prow = priced
      .map((p) => {
        const on = A.promoOn(p, S.today);
        return (
          '<div class="mrow"><div class="mmain" style="cursor:default"><b>' + esc(p.name) + '</b><span>' + (p.price != null ? '<s>' + esc(money(p.price)) + '</s> → ' : '') + esc(money(p.promoPrice)) +
          ' <span class="tag ' + (on ? 'promo' : 'off') + '">' + (on ? esc(p.promoLabel || 'Promo') : 'Vencida') + '</span>' + (p.promoUntil ? ' hasta ' + esc(A.fmtDate(p.promoUntil)) : '') + '</span></div>' +
          '<button class="btn line sm" type="button" data-act="edit-product" data-id="' + esc(p.id) + '">Editar</button></div>'
        );
      })
      .join('');
    return (
      '<div class="vh"><h1>Promos</h1><button class="btn accent" type="button" data-act="new-promo">' + icon('plus', 18) + 'Nueva promo</button></div>' +
      '<div class="card"><h2>Anuncios en el sitio</h2><p class="hint">Aparecen como tarjetas arriba del menú. Puedes enlazar un producto para que el cliente lo pida con un toque (por ejemplo un combo).</p>' +
      (rows || '<div class="empty" style="margin-top:6px"><h3>Sin anuncios</h3><p>Crea uno para destacar una promo, un combo o un aviso.</p></div>') + '</div>' +
      '<div class="card"><h2>Productos con precio de promo</h2><p class="hint">El precio rebajado se activa dentro de cada producto (Productos → editar → “En promoción”).</p>' +
      (prow || '<p class="hint">Todavía no hay productos en promoción.</p>') + '</div>'
    );
  }

  function openPromo(id) {
    const b = id ? S.menu.promos.find((x) => x.id === id) : null;
    if (id && !b) return;
    if (!id && S.menu.promos.length >= 20) return toast('Llegaste al máximo de 20 promos.');
    DRAFT = { type: 'promo', id: id || '', active: b ? b.active : true };
    const v = b || { title: '', text: '', badge: '', until: '', productId: '' };
    const opts =
      '<option value="">Sin producto (solo anuncio)</option>' +
      S.menu.products.map((p) => '<option value="' + esc(p.id) + '"' + (v.productId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
    showDlg(
      '<form id="mform" novalidate><div class="dlg-head"><h2>' + (b ? 'Editar promo' : 'Nueva promo') + '</h2><button type="button" class="rb" data-act="dlg-close" aria-label="Cerrar">' + icon('close', 20) + '</button></div>' +
      '<div class="dlg-body"><div class="f"><label for="mf-title">Título</label><input class="fld" id="mf-title" maxlength="60" autocomplete="off" placeholder="Combo café + dona" value="' + esc(v.title) + '"></div>' +
      '<div class="f"><label for="mf-text">Texto (opcional)</label><textarea class="fld" id="mf-text" rows="2" maxlength="200" placeholder="Disponible todos los días">' + esc(v.text) + '</textarea></div>' +
      '<div class="row2"><div class="f"><label for="mf-badge">Etiqueta (opcional)</label><input class="fld" id="mf-badge" maxlength="14" autocomplete="off" placeholder="2x1, -20%…" value="' + esc(v.badge) + '"></div>' +
      '<div class="f"><label for="mf-until">Válida hasta (opcional)</label><input class="fld" id="mf-until" type="date" value="' + esc(v.until) + '"></div></div>' +
      '<div class="f"><label for="mf-prod">Producto para pedir (opcional)</label><select class="fld" id="mf-prod">' + opts + '</select><p class="hint">Si eliges uno, la tarjeta muestra un botón “Pedir”.</p></div>' +
      '<div class="box"><div class="swrow"><div><b>Mostrar en el sitio</b><p class="hint">Apágala para pausarla sin borrarla.</p></div><button type="button" class="sw" role="switch" aria-checked="' + DRAFT.active + '" data-act="sw" data-k="active" aria-label="Mostrar en el sitio"></button></div></div>' +
      '<p class="err" id="mf-err" hidden></p></div>' +
      '<div class="dlg-foot">' + (b ? '<button type="button" class="btn danger" data-act="m-delete">Eliminar</button>' : '') +
      '<span class="grow"></span><button type="button" class="btn line" data-act="dlg-close">Cancelar</button><button type="submit" class="btn">Guardar</button></div></form>'
    );
    if (!b) $('#mf-title').focus();
  }

  function savePromo() {
    if (!DRAFT || DRAFT.type !== 'promo') return;
    const title = str($('#mf-title').value, 60);
    if (!title) {
      showErr($('#mf-err'), 'Escribe el título de la promo.');
      return $('#mf-title').focus();
    }
    const fields = {
      title: title,
      text: str($('#mf-text').value, 200),
      badge: str($('#mf-badge').value, 14),
      until: $('#mf-until').value || '',
      productId: $('#mf-prod').value,
      active: DRAFT.active
    };
    const id = DRAFT.id;
    commit((m) => {
      if (id) Object.assign(m.promos.find((x) => x.id === id), fields);
      else m.promos.push(Object.assign({ id: A.uid('m') }, fields));
    });
    closeDlg();
    setTab('promos', true);
    toast(id ? 'Promo guardada' : 'Promo creada');
  }

  async function deletePromo() {
    if (!DRAFT || !DRAFT.id) return;
    const id = DRAFT.id;
    const b = S.menu.promos.find((x) => x.id === id);
    const ok = await confirmDlg({ title: '¿Eliminar la promo “' + (b ? b.title : '') + '”?', ok: 'Eliminar', danger: true });
    if (!ok) return;
    commit((m) => {
      m.promos = m.promos.filter((x) => x.id !== id);
    });
    closeDlg();
    setTab('promos', true);
    toast('Promo eliminada');
  }

  /* ---------- horario ---------- */
  function viewHorario() {
    const st = S.menu.settings;
    const opt = (v, title, hint) =>
      '<label class="opt"><input type="radio" name="mode" value="' + v + '" data-f="mode"' + (st.mode === v ? ' checked' : '') + '><span><b>' + title + '</b><span class="hint">' + hint + '</span></span></label>';
    const days = A.KEYS.map((k) => {
      const x = st.schedule[k];
      return (
        '<div class="day' + (x.open ? '' : ' off') + '" data-day="' + k + '"><button class="sw" type="button" role="switch" aria-checked="' + x.open + '" data-act="day-open" data-day="' + k + '" aria-label="' + A.DAY_NAMES[k] + ' abierto"></button>' +
        '<span class="day-name">' + A.DAY_NAMES[k] + '</span><div class="day-times"><input class="fld" type="time" value="' + x.from + '" data-f="time" data-day="' + k + '" data-which="from" aria-label="' + A.DAY_NAMES[k] + ', abre">' +
        '<span>a</span><input class="fld" type="time" value="' + x.to + '" data-f="time" data-day="' + k + '" data-which="to" aria-label="' + A.DAY_NAMES[k] + ', cierra"></div></div>'
      );
    }).join('');
    return (
      '<div class="vh"><h1>Horario</h1></div>' +
      '<div class="card"><h2>Así lo ven tus clientes</h2><div id="hprev"></div></div>' +
      '<div class="card"><h2>¿Cómo se controla?</h2>' +
      opt('auto', 'Automático', 'Abre y cierra solo, según el horario de abajo (hora de Costa Rica).') +
      opt('open', 'Abierto siempre', 'Ignora el horario. El sitio no muestra aviso de abierto o cerrado.') +
      opt('closed', 'Cerrado ahora', 'Para feriados o vacaciones. Vuelve a “Automático” cuando abras.') +
      '<div class="f" id="closedBox" style="margin-top:12px"' + (st.mode === 'closed' ? '' : ' hidden') + '><label for="closedMsg">Mensaje para tus clientes (opcional)</label>' +
      '<input class="fld" id="closedMsg" data-f="closedMessage" maxlength="160" autocomplete="off" placeholder="Cerrado por feriado, abrimos el lunes" value="' + esc(st.closedMessage) + '"></div>' +
      '<div class="swrow" style="margin-top:10px"><div><b>Recibir pedidos aunque esté cerrado</b><p class="hint">Los clientes podrán enviar el pedido y lo atiendes cuando abras.</p></div>' +
      '<button class="sw" type="button" role="switch" aria-checked="' + st.acceptWhenClosed + '" data-act="acc-closed" aria-label="Recibir pedidos aunque esté cerrado"></button></div></div>' +
      '<div class="card' + (st.mode === 'auto' ? '' : ' dim') + '" id="schedCard"><h2>Horario de la semana</h2><p class="hint">Hora de Costa Rica. Si un día cierra de madrugada (por ejemplo de 6:00 p. m. a 2:00 a. m.), funciona igual.</p>' + days +
      '<button class="btn line sm" type="button" data-act="copy-mon" style="margin-top:10px">Copiar el lunes a todos los días</button></div>'
    );
  }

  function renderHoursPreview() {
    const el = $('#hprev');
    if (!el) return;
    const st = S.menu.settings;
    const s = A.getStatus(st);
    let html;
    if (st.mode === 'open') {
      html = '<div class="status-prev ok"><span class="dot"></span><span>Abierto. El sitio no muestra horario ni aviso.</span></div>';
    } else {
      html = '<div class="status-prev ' + (s.open ? 'ok' : 'bad') + '"><span class="dot"></span><span>' + esc(s.label) + (s.detail ? ' · ' + esc(s.detail) : '') + '</span></div>';
    }
    if (st.mode === 'auto' && !A.KEYS.some((k) => st.schedule[k].open)) {
      html += '<p class="err" style="margin-top:8px">Ningún día está marcado como abierto: tus clientes verán el negocio siempre cerrado.</p>';
    }
    if (!s.open && !st.acceptWhenClosed) html += '<p class="hint" style="margin-top:8px">Mientras esté cerrado, los clientes ven el menú pero no pueden enviar pedidos.</p>';
    el.innerHTML = html;
  }

  /* ---------- ajustes ---------- */
  function viewAjustes() {
    const st = S.menu.settings;
    return (
      '<div class="vh"><h1>Ajustes</h1></div>' +
      '<div class="card"><h2>Datos del negocio</h2><div class="stack" style="margin-top:8px">' +
      '<div class="f"><label for="s-name">Nombre del negocio</label><input class="fld" id="s-name" data-f="name" maxlength="60" autocomplete="off" value="' + esc(st.name) + '"></div>' +
      '<div class="f"><label for="s-wa">WhatsApp para pedidos</label><input class="fld" id="s-wa" data-f="whatsapp" type="tel" inputmode="tel" autocomplete="off" value="' + esc(A.phoneDisplay(st.whatsapp)) + '">' +
      '<p class="hint" id="s-wa-hint">Aquí llegan los pedidos. Se guarda como +' + esc(st.whatsapp) + '. <a href="' + esc(A.waLink(st.whatsapp)) + '" target="_blank" rel="noopener" style="text-decoration:underline" data-act="test-wa">Probar el enlace</a></p><p class="err" id="s-wa-err" hidden></p></div>' +
      '<div class="f"><label for="s-addr">Dirección (opcional)</label><input class="fld" id="s-addr" data-f="address" maxlength="160" autocomplete="off" placeholder="Se muestra al final del sitio" value="' + esc(st.address) + '"></div>' +
      '<div class="f"><label for="s-hero">Titular de la portada (opcional)</label><input class="fld" id="s-hero" data-f="heroTitle" maxlength="60" autocomplete="off" placeholder="' + esc(A.joinNames(S.menu.categories.filter((c) => !c.hidden).map((c) => c.name))) + '" value="' + esc(st.heroTitle) + '"><p class="hint">Si lo dejas vacío, se arma solo con tus categorías.</p></div>' +
      '<div class="f"><label for="s-intro">Primera línea del mensaje de pedido</label><input class="fld" id="s-intro" data-f="orderIntro" maxlength="120" autocomplete="off" value="' + esc(st.orderIntro) + '"></div></div></div>' +
      '<div class="card"><h2>Respaldo</h2><p class="hint">Descarga una copia de todo el menú (con fotos) o restaura una copia anterior.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn line" type="button" data-act="export">' + icon('download', 18) + 'Descargar respaldo</button>' +
      '<label class="btn line">' + icon('upload', 18) + 'Restaurar respaldo<input class="sr" id="importFile" type="file" accept="application/json,.json"></label></div></div>' +
      '<div class="card"><h2>Cuenta</h2><p class="hint">Base de datos: <b>' + (S.storage === 'none' ? 'sin conectar (solo este navegador)' : 'conectada') + '</b>.<br>La contraseña se cambia en Vercel: Settings → Environment Variables → <code>ADMIN_PASSWORD</code>, y luego Redeploy.</p>' +
      '<button class="btn line" type="button" data-act="logout">' + icon('logout', 18) + 'Cerrar sesión</button></div>'
    );
  }

  async function exportBackup() {
    toast('Preparando respaldo…');
    const menu = JSON.parse(JSON.stringify(S.menu));
    for (const p of menu.products) {
      if (/^\/api\/img\?id=/.test(p.image)) {
        try {
          const r = await fetch(p.image);
          if (r.ok) p.image = await blobToDataURL(await r.blob());
        } catch (e) {
          /* se deja el enlace */
        }
      }
    }
    const blob = new Blob([JSON.stringify({ app: 'antojos', version: 1, exportedAt: new Date().toISOString(), menu: menu })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'respaldo-antojos-' + A.crNow().ymd + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    toast('Respaldo descargado');
  }

  async function importBackup(file) {
    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch (e) {
      return toast('Ese archivo no es un respaldo válido.');
    }
    const m = normalizeMenu(obj && obj.menu ? obj.menu : obj);
    if (!m || (!m.products.length && !m.categories.length)) return toast('Ese archivo no tiene un menú.');
    const ok = await confirmDlg({
      title: '¿Restaurar este respaldo?',
      text: 'Reemplaza el menú actual (' + S.menu.products.length + ' productos) por el del archivo (' + m.products.length + ' productos).',
      ok: 'Restaurar'
    });
    if (!ok) return;
    if (S.storage !== 'none') {
      toast('Restaurando… puede tardar un poco.');
      for (const p of m.products) {
        if (/^data:image\//.test(p.image)) {
          try {
            p.image = (await api('POST', '/api/upload', { dataUrl: p.image })).url;
          } catch (e) {
            p.image = '';
          }
        }
      }
    }
    S.menu = m;
    S.version++;
    queueSave();
    setTab('ajustes', true);
    toast('Respaldo restaurado');
  }

  /* ---------- eventos ---------- */
  function fieldChange(t) {
    clearTimeout(t._t);
    const f = t.getAttribute('data-f');
    const st = S.menu.settings;
    switch (f) {
      case 'mode':
        if (!t.checked) return;
        commit((m) => {
          m.settings.mode = t.value;
        });
        $('#closedBox').hidden = t.value !== 'closed';
        $('#schedCard').classList.toggle('dim', t.value !== 'auto');
        renderHoursPreview();
        break;
      case 'closedMessage':
        commit((m) => {
          m.settings.closedMessage = str(t.value, 160);
        });
        renderHoursPreview();
        break;
      case 'time': {
        const day = t.getAttribute('data-day');
        const which = t.getAttribute('data-which');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.value)) {
          t.value = st.schedule[day][which];
          return;
        }
        commit((m) => {
          m.settings.schedule[day][which] = t.value;
        });
        renderHoursPreview();
        break;
      }
      case 'name':
      case 'orderIntro': {
        const val = str(t.value, f === 'name' ? 60 : 120);
        if (!val) {
          t.value = st[f];
          return toast('Este campo no puede quedar vacío.');
        }
        commit((m) => {
          m.settings[f] = val;
        });
        break;
      }
      case 'address':
      case 'heroTitle':
        commit((m) => {
          m.settings[f] = str(t.value, f === 'address' ? 160 : 60);
        });
        break;
      case 'whatsapp': {
        const d = A.digits(t.value);
        const err = $('#s-wa-err');
        if (!A.validPhone(d)) {
          showErr(err, 'Escribe un número válido, por ejemplo 7066 8903 o +506 7066 8903.');
          return;
        }
        showErr(err, '');
        commit((m) => {
          m.settings.whatsapp = d;
        });
        $('#s-wa-hint').innerHTML = 'Aquí llegan los pedidos. Se guarda como +' + esc(d) + '. <a href="' + esc(A.waLink(d)) + '" target="_blank" rel="noopener" style="text-decoration:underline">Probar el enlace</a>';
        break;
      }
      case 'cname': {
        const id = t.getAttribute('data-id');
        const c = S.menu.categories.find((x) => x.id === id);
        const val = str(t.value, 40);
        if (!c) return;
        if (!val) {
          t.value = c.name;
          return toast('El nombre no puede quedar vacío.');
        }
        if (S.menu.categories.some((x) => x.id !== id && A.norm(x.name) === A.norm(val))) {
          t.value = c.name;
          return toast('Ya existe una categoría con ese nombre.');
        }
        if (val !== c.name) {
          commit((m) => {
            m.categories.find((x) => x.id === id).name = val;
          });
        }
        break;
      }
      default:
    }
  }

  function onChange(e) {
    const t = e.target;
    if (t.id === 'pcat') {
      S.pcat = t.value;
      return renderPList();
    }
    if (t.id === 'pf-file') return onPhoto(t.files && t.files[0]);
    if (t.id === 'importFile') {
      const f = t.files && t.files[0];
      t.value = '';
      return f && importBackup(f);
    }
    if (t.getAttribute && t.getAttribute('data-f')) fieldChange(t);
  }

  function onInput(e) {
    const t = e.target;
    if (t.id === 'pq') {
      S.pq = t.value;
      return renderPList();
    }
    if (t.id === 'pf-price' || t.id === 'pf-pp') {
      const d = t.value.replace(/\D/g, '');
      if (d !== t.value) t.value = d;
      return;
    }
    if (t.id === 'newCat') {
      const b = $('#newCatIc');
      if (b && !S.newIcon) b.innerHTML = icon(A.categoryIcon(t.value), 24);
      return;
    }
    const f = t.getAttribute && t.getAttribute('data-f');
    if (f && (f === 'name' || f === 'address' || f === 'heroTitle' || f === 'orderIntro' || f === 'closedMessage' || f === 'cname')) {
      clearTimeout(t._t);
      t._t = setTimeout(() => fieldChange(t), 800);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    switch (e.target.id) {
      case 'loginForm':
        return doLogin();
      case 'pform':
        return saveProduct();
      case 'mform':
        return savePromo();
      case 'catForm':
        return addCategory();
      default:
    }
  }

  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.getAttribute('data-act');
    const id = t.getAttribute('data-id');
    switch (act) {
      case 'reload':
        return location.reload();
      case 'logout':
        S.token = '';
        localStorage.removeItem(TOKEN_KEY);
        return boot();
      case 'retry-save':
        return queueSave();
      case 'toggle-pw': {
        const inp = $('#pw');
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        t.innerHTML = icon(show ? 'eyeoff' : 'eye', 22);
        t.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
        return;
      }
      case 'tab':
        return setTab(t.getAttribute('data-tab'));
      case 'new-product':
        return openProduct(null);
      case 'edit-product':
        return openProduct(id);
      case 'toggle-sold': {
        const p = S.menu.products.find((x) => x.id === id);
        if (!p) return;
        commit((m) => {
          const q = m.products.find((x) => x.id === id);
          q.soldOut = !q.soldOut;
        });
        renderSummary();
        renderPList();
        return;
      }
      case 'sort-toggle':
        S.sort = !S.sort;
        t.setAttribute('aria-pressed', S.sort);
        t.lastChild.textContent = S.sort ? 'Listo' : 'Ordenar';
        return renderPList();
      case 'move-up':
        return moveProduct(id, -1);
      case 'move-down':
        return moveProduct(id, 1);
      case 'cat-icon':
        return openIconPicker(id);
      case 'cat-icon-new':
        return openIconPicker('');
      case 'pick-icon':
        return pickIcon(t.getAttribute('data-icon'), t.getAttribute('data-target'));
      case 'cat-up':
        return moveCategory(id, -1);
      case 'cat-down':
        return moveCategory(id, 1);
      case 'cat-vis': {
        commit((m) => {
          const c = m.categories.find((x) => x.id === id);
          c.hidden = !c.hidden;
        });
        t.setAttribute('aria-checked', !S.menu.categories.find((x) => x.id === id).hidden);
        return;
      }
      case 'cat-del':
        return deleteCategory(id);
      case 'new-promo':
        return openPromo(null);
      case 'edit-promo':
        return openPromo(id);
      case 'promo-active':
        commit((m) => {
          const b = m.promos.find((x) => x.id === id);
          b.active = !b.active;
        });
        return setTab('promos', true);
      case 'day-open': {
        const day = t.getAttribute('data-day');
        commit((m) => {
          m.settings.schedule[day].open = !m.settings.schedule[day].open;
        });
        const on = S.menu.settings.schedule[day].open;
        t.setAttribute('aria-checked', on);
        t.closest('.day').classList.toggle('off', !on);
        return renderHoursPreview();
      }
      case 'acc-closed':
        commit((m) => {
          m.settings.acceptWhenClosed = !m.settings.acceptWhenClosed;
        });
        t.setAttribute('aria-checked', S.menu.settings.acceptWhenClosed);
        return renderHoursPreview();
      case 'copy-mon':
        commit((m) => {
          const mon = m.settings.schedule.mon;
          A.KEYS.forEach((k) => {
            m.settings.schedule[k] = { open: mon.open, from: mon.from, to: mon.to };
          });
        });
        setTab('horario', true);
        return toast('Horario copiado a todos los días');
      case 'export':
        return exportBackup();
      case 'dlg-close':
        return closeDlg();
      case 'photo-remove':
        if (!DRAFT) return;
        DRAFT.image = '';
        $('#pf-img').src = PLACEHOLDER;
        t.hidden = true;
        $('#pf-filelbl').textContent = 'Agregar foto';
        return;
      case 'sw': {
        if (!DRAFT) return;
        const k = t.getAttribute('data-k');
        DRAFT[k] = !DRAFT[k];
        t.setAttribute('aria-checked', DRAFT[k]);
        if (k === 'promoOn') {
          $('#pf-promo').hidden = !DRAFT.promoOn;
          if (DRAFT.promoOn) $('#pf-pp').focus();
        }
        return;
      }
      case 'p-delete':
        return deleteProduct();
      case 'm-delete':
        return deletePromo();
      default:
    }
  }

  [$('#root'), dlg].forEach((el) => {
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    el.addEventListener('submit', onSubmit);
  });

  boot();
})();
