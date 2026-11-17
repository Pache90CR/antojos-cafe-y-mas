/* Sitio público: lee el menú desde /api/menu y arma el pedido para WhatsApp. */
(function () {
  'use strict';

  const A = window.AC;
  const esc = A.esc, money = A.money, icon = A.icon;
  const $ = (s) => document.querySelector(s);

  const PLACEHOLDER = '/assets/art/placeholder.svg';
  const CART_KEY = 'antojos_cart';
  const LAST_KEY = 'antojos_last_order'; // el último pedido enviado, por si el cliente no llegó a mandarlo en WhatsApp
  const LOCAL_KEY = 'antojos_menu_local';
  const PING_KEY = 'antojos_menu_ping'; // el panel lo escribe al guardar: avisa a las demás pestañas de este navegador
  const MAX_QTY = 99;
  const LAST_TTL = 3 * 3600 * 1000; // el pedido enviado se puede recuperar durante 3 horas
  const POLL_MS = 20000; // cada cuánto se revisa el menú mientras la página se está viendo
  const POLL_MAX = 120000; // si el servidor falla, se espera más entre intentos (hasta 2 minutos)
  const WAKE_GAP = 4000; // mínimo entre dos revisiones inmediatas

  const S = {
    menu: null, sig: '', cat: 'todo', q: '', cart: {}, last: null, cartNote: '', status: null, today: '', toastT: 0,
    busy: false, again: false, pollT: 0, fails: 0, checkedAt: 0
  };

  /* ---------- datos ---------- */
  function safeImg(u) {
    u = typeof u === 'string' ? u : '';
    if (
      /^\/api\/img\?id=[a-z0-9]{8,40}$/.test(u) ||
      /^\/assets\/art\/[a-z0-9-]{1,40}\.svg$/.test(u) ||
      /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(u)
    )
      return u;
    return PLACEHOLDER;
  }

  function fix(m) {
    m = m && typeof m === 'object' ? m : {};
    m.settings = m.settings && typeof m.settings === 'object' ? m.settings : {};
    m.settings.schedule = m.settings.schedule && typeof m.settings.schedule === 'object' ? m.settings.schedule : {};
    m.categories = Array.isArray(m.categories) ? m.categories : [];
    m.products = Array.isArray(m.products) ? m.products : [];
    m.promos = Array.isArray(m.promos) ? m.promos : [];
    return m;
  }

  function readLocal() {
    try {
      const o = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      if (o && o.menu && Array.isArray(o.menu.products)) return o.menu;
    } catch (e) {
      /* sin copia local */
    }
    return null;
  }

  // Descarga el menú del servidor. Devuelve { menu, sig } o null si el servidor no respondió bien:
  // así un fallo pasajero nunca reemplaza el menú que el cliente está viendo por uno de ejemplo.
  // Normal: la dirección cambia cada 10 s (?b=), así todos los clientes de esos 10 s comparten una sola lectura.
  // Inmediata (urgent): lectura directa, sin caché; se usa al volver a la página o cuando el panel acaba de guardar.
  async function fetchMenu(urgent) {
    const url = urgent ? '/api/menu?nocache=1&t=' + Date.now() : '/api/menu?b=' + Math.floor(Date.now() / 10000);
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || !j.menu || typeof j.menu !== 'object') return null;
      if (j.storage === 'error') return null; // la base de datos falló un momento y el servidor mandó el menú de ejemplo
      let menu = j.menu;
      // Sin base de datos conectada, el panel guarda en este navegador: así se puede probar el panel.
      if (j.storage === 'none') {
        const local = readLocal();
        if (local) menu = local;
      }
      return { menu: menu, sig: JSON.stringify(menu) };
    } catch (e) {
      return null;
    }
  }

  // Carga inicial: si el servidor no responde se usa el menú de respaldo que viene con el sitio.
  async function loadMenu() {
    const got = await fetchMenu(false);
    if (got) return got;
    try {
      const r = await fetch('/data/menu.default.json');
      if (r.ok) {
        const m = await r.json();
        return { menu: m, sig: JSON.stringify(m) };
      }
    } catch (e) {
      /* sin respaldo */
    }
    return null;
  }

  function loadCart() {
    try {
      const o = JSON.parse(localStorage.getItem(CART_KEY) || '{}');
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (e) {
      return {};
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(S.cart));
    } catch (e) {
      /* modo privado: el pedido sigue funcionando sin guardarse */
    }
  }

  function loadLast() {
    try {
      const o = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
      if (o && typeof o.t === 'number' && o.cart && typeof o.cart === 'object' && !Array.isArray(o.cart)) return o;
    } catch (e) {
      /* sin pedido anterior */
    }
    return null;
  }

  function saveLast() {
    try {
      if (S.last) localStorage.setItem(LAST_KEY, JSON.stringify(S.last));
      else localStorage.removeItem(LAST_KEY);
    } catch (e) {
      /* modo privado */
    }
  }

  // El último pedido enviado, mientras todavía se pueda recuperar.
  function lastOrder() {
    if (S.last && Date.now() - S.last.t >= LAST_TTL) {
      S.last = null;
      saveLast();
    }
    return S.last;
  }

  /* ---------- derivados ---------- */
  function visibleProducts() {
    const hiddenCats = new Set(S.menu.categories.filter((c) => c.hidden).map((c) => c.id));
    const order = new Map(S.menu.categories.map((c, i) => [c.id, i]));
    return S.menu.products
      .filter((p) => !p.hidden && !hiddenCats.has(p.categoryId))
      .sort((a, b) => (order.has(a.categoryId) ? order.get(a.categoryId) : 999) - (order.has(b.categoryId) ? order.get(b.categoryId) : 999));
  }

  function visibleMap() {
    const m = {};
    visibleProducts().forEach((p) => {
      m[p.id] = p;
    });
    return m;
  }

  function shownCats() {
    const ids = new Set(visibleProducts().map((p) => p.categoryId));
    return S.menu.categories.filter((c) => !c.hidden && ids.has(c.id));
  }

  function catName(id) {
    const c = S.menu.categories.find((x) => x.id === id);
    return c ? c.name : '';
  }

  function canOrder() {
    return S.status.open || !!S.menu.settings.acceptWhenClosed;
  }

  function closedText() {
    const d = String(S.status.detail || '').replace(/[.!\s]+$/, '');
    return 'Estamos cerrados por ahora' + (d ? '. ' + d : '') + '.';
  }

  function pruneCart() {
    const vm = visibleMap();
    Object.keys(S.cart).forEach((id) => {
      if (!vm[id] || vm[id].soldOut || !(S.cart[id] > 0)) delete S.cart[id];
    });
  }

  /* ---------- piezas de pantalla ---------- */
  function priceText(p) {
    const price = A.unitPrice(p, S.today);
    return price == null ? 'Consultar' : money(price);
  }

  function priceHTML(p) {
    if (A.promoOn(p, S.today)) {
      return '<span class="price-now">' + money(p.promoPrice) + '</span>' + (p.price != null ? '<s class="price-old">' + money(p.price) + '</s>' : '');
    }
    if (p.price == null) return '<span class="price-ask">Consultar</span>';
    return '<span class="price-now">' + money(p.price) + '</span>';
  }

  function addBtn(p) {
    if (p.soldOut) {
      return '<button class="add" type="button" disabled aria-label="' + esc(p.name) + ', agotado">' + icon('plus', 20) + '</button>';
    }
    const off = !canOrder();
    return (
      '<button class="add' + (off ? ' is-off' : '') + '" type="button" data-act="add" data-id="' + esc(p.id) + '"' +
      (off ? ' aria-disabled="true"' : '') + ' aria-label="Agregar ' + esc(p.name) + ' al pedido">' + icon('plus', 20) + '</button>'
    );
  }

  function cardHTML(p) {
    const promo = A.promoOn(p, S.today);
    return (
      '<article class="card' + (p.soldOut ? ' is-sold' : '') + '">' +
      '<div class="card-img"><img src="' + esc(safeImg(p.image)) + '" alt="" loading="lazy" decoding="async">' +
      (promo ? '<span class="pill pill-promo">' + esc(p.promoLabel || 'Promo') + '</span>' : '') +
      (p.soldOut ? '<span class="pill pill-sold">Agotado</span>' : '') +
      '</div><div class="card-body"><h3>' + esc(p.name) + '</h3><p class="desc">' + esc(p.desc) + '</p>' +
      '<div class="card-foot"><span class="price">' + priceHTML(p) + '</span>' + addBtn(p) + '</div></div></article>'
    );
  }

  function renderBrand() {
    const st = S.menu.settings;
    const name = st.name || 'Antojos, Café y Más';
    const i = name.indexOf(',');
    $('#brand1').textContent = i > 0 ? name.slice(0, i).trim() : name;
    const b2 = $('#brand2');
    b2.hidden = !(i > 0);
    if (i > 0) b2.textContent = name.slice(i + 1).trim().toUpperCase();
    document.title = name + ' · Menú y pedidos por WhatsApp';

    const wa = st.whatsapp || '';
    const phone = A.phoneDisplay(wa);
    $('#telBtn').href = 'tel:+' + wa;
    $('#telBtn').setAttribute('aria-label', 'Llamar al ' + phone);
    $('#waChat').href = A.waLink(wa, '¡Hola! Quisiera hacer un pedido.');
    $('#tabWa').href = A.waLink(wa, '¡Hola! Quisiera hacer un pedido.');
    $('#orderSub').textContent = 'Escríbenos al ' + phone + ' y arma tu pedido.';
    const sp = $('#stickerPhone');
    sp.textContent = phone;
    sp.hidden = phone.length > 9; // solo cabe un número local; el resto ya aparece en el texto de al lado

    const names = shownCats().map((c) => c.name);
    $('#heroTitle').textContent = st.heroTitle || A.joinNames(names);
    $('#q').placeholder = names.length ? 'Busca ' + A.joinNames(names).toLowerCase() + '…' : 'Busca en el menú…';
  }

  function renderStatus() {
    S.status = A.getStatus(S.menu.settings);
    const st = S.menu.settings;
    const el = $('#status');
    if (st.mode !== 'auto' && st.mode !== 'closed') {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.className = 'status ' + (S.status.open ? 'ok' : 'bad');
    let t = '<span class="dot"></span>' + esc(S.status.label) + (S.status.detail ? ' · ' + esc(S.status.detail) : '');
    if (!S.status.open && st.acceptWhenClosed) t += ' · Puedes dejar tu pedido y lo atendemos al abrir';
    el.innerHTML = t;
  }

  function renderPromos() {
    const list = S.menu.promos.filter((b) => A.bannerOn(b, S.today));
    $('#promos').hidden = !list.length;
    if (!list.length) return;
    const vm = visibleMap();
    $('#promoList').innerHTML = list
      .map((b) => {
        const p = b.productId ? vm[b.productId] : null;
        const badge = b.badge
          ? '<span class="promo-badge' + (b.badge.length > 6 ? ' long' : '') + '">' + esc(b.badge) + '</span>'
          : '<span class="promo-badge">' + icon('tag', 28) + '</span>';
        const btn = p
          ? '<button class="promo-btn" type="button" data-act="add" data-id="' + esc(p.id) + '"' + (p.soldOut ? ' disabled' : '') + '>' + icon('plus', 16) + (p.soldOut ? 'Agotado' : 'Pedir') + '</button>'
          : '';
        return (
          '<article class="promo">' + badge + '<div class="promo-txt"><h3>' + esc(b.title) + '</h3>' +
          (b.text ? '<p>' + esc(b.text) + '</p>' : '') +
          (b.until ? '<span class="promo-until">Hasta el ' + esc(A.fmtDate(b.until)) + '</span>' : '') +
          btn + '</div></article>'
        );
      })
      .join('');
  }

  function renderChips() {
    const items = [{ id: 'todo', name: 'Todo', ic: 'grid' }];
    if (visibleProducts().some((p) => A.promoOn(p, S.today))) items.push({ id: 'promos', name: 'Promos', ic: 'tag' });
    shownCats().forEach((c) => items.push({ id: c.id, name: c.name, ic: A.catIcon(c) }));
    if (!items.some((i) => i.id === S.cat)) S.cat = 'todo';
    $('#chips').innerHTML = items
      .map(
        (i) =>
          '<a class="chip' + (S.cat === i.id ? ' on' : '') + '" href="#menu" data-act="cat" data-cat="' + esc(i.id) + '">' +
          '<span class="chip-ic">' + icon(i.ic, 26) + '</span><span class="chip-lb">' + esc(i.name) + '</span></a>'
      )
      .join('');
  }

  function shown() {
    let list = visibleProducts();
    if (S.cat === 'promos') list = list.filter((p) => A.promoOn(p, S.today));
    else if (S.cat !== 'todo') list = list.filter((p) => p.categoryId === S.cat);
    return list;
  }

  function renderGrid() {
    const list = shown();
    $('#countLabel').textContent = list.length === 1 ? '1 producto' : list.length + ' productos';
    const grid = $('#grid');
    const empty = $('#empty');
    if (!list.length) {
      grid.hidden = true;
      empty.hidden = false;
      empty.innerHTML = visibleProducts().length
        ? '<h3>Nada por aquí</h3><p>Prueba con otra categoría.</p>'
        : '<h3>Estamos preparando el menú</h3><p>Pronto verás aquí nuestros productos. Mientras tanto, escríbenos por WhatsApp.</p>';
      return;
    }
    empty.hidden = true;
    grid.hidden = false;
    grid.innerHTML = list.map(cardHTML).join('');
  }

  function renderSearch() {
    const q = A.norm(S.q.trim());
    const box = $('#qRes');
    $('#qClear').hidden = !S.q;
    if (!q) {
      box.hidden = true;
      return;
    }
    const found = visibleProducts()
      .filter((p) => A.norm(p.name + ' ' + p.desc + ' ' + catName(p.categoryId)).indexOf(q) !== -1)
      .slice(0, 6);
    box.hidden = false;
    box.innerHTML = found.length
      ? found
          .map(
            (p) =>
              '<div class="sres-row"><div><p class="sres-name">' + esc(p.name) + '</p><p class="sres-meta">' +
              esc(catName(p.categoryId)) + ' · ' + esc(priceText(p)) + '</p></div>' + addBtn(p) + '</div>'
          )
          .join('')
      : '<p class="sres-none">No encontramos eso en el menú. Prueba con otra palabra.</p>';
  }

  function cartLines() {
    const vm = visibleMap();
    return Object.keys(S.cart)
      .filter((id) => S.cart[id] > 0 && vm[id])
      .map((id) => ({ p: vm[id], qty: S.cart[id] }));
  }

  function buildMessage(lines, priced, total) {
    const out = [S.menu.settings.orderIntro || '¡Hola! Quiero hacer un pedido:', ''];
    lines.forEach((l) => {
      const up = A.unitPrice(l.p, S.today);
      out.push('• ' + l.qty + ' × ' + l.p.name + (A.promoOn(l.p, S.today) ? ' (promo)' : '') + (priced ? ' — ' + money(up * l.qty) : ''));
    });
    if (priced) out.push('', 'Total: ' + money(total));
    const name = $('#custName').value.trim();
    const notes = $('#custNotes').value.trim();
    if (name) out.push('', 'Nombre: ' + name);
    if (notes) out.push('', 'Notas: ' + notes);
    return out.join('\n').replace(/ /g, ' ');
  }

  function renderCart() {
    const lines = cartLines();
    const count = lines.reduce((a, l) => a + l.qty, 0);
    ['#cartBadge', '#fabBadge'].forEach((sel) => {
      $(sel).hidden = !count;
      $(sel).textContent = count;
    });
    const label = count ? 'Ver mi pedido, ' + count + (count === 1 ? ' producto' : ' productos') : 'Ver mi pedido';
    ['#cartBtn', '#fabBtn'].forEach((sel) => $(sel).setAttribute('aria-label', label));

    const body = $('#cartBody');
    const foot = $('#cartFoot');
    // Aviso dentro del pedido (por ejemplo, un producto que dejó de estar disponible); se quita al tocar el pedido o cerrarlo.
    const note = S.cartNote ? '<p class="cart-note" role="status">' + esc(S.cartNote) + '</p>' : '';
    if (!lines.length) {
      const menuBtn = '<a class="cta cta-dk" href="#menu" data-act="close-cart">VER EL MENÚ<span class="cta-ar">' + icon('arrow', 16) + '</span></a>';
      if (lastOrder()) {
        // Recién se envió: el pedido ya salió del carrito. Si no llegó a mandarse en WhatsApp, se puede recuperar.
        body.innerHTML =
          note + '<div class="cart-empty"><span class="cart-empty-ic ok" aria-hidden="true">' + icon('check', 34) + '</span>' +
          '<h3>Tu pedido pasó a WhatsApp</h3><p>Si no llegaste a enviarlo, puedes recuperarlo.</p>' + menuBtn +
          '<button class="linkbtn" type="button" data-act="restore">Recuperar mi pedido</button></div>';
      } else {
        body.innerHTML =
          note + '<div class="cart-empty"><span class="cart-empty-ic" aria-hidden="true">' + icon('cup', 34) + '</span>' +
          '<h3>Tu pedido está vacío</h3><p>Agrega algo del menú y aquí verás tu pedido.</p>' + menuBtn + '</div>';
      }
      foot.hidden = true;
      return;
    }
    const priced = lines.every((l) => A.unitPrice(l.p, S.today) != null);
    const total = lines.reduce((a, l) => a + (priced ? A.unitPrice(l.p, S.today) * l.qty : 0), 0);
    body.innerHTML =
      note +
      lines
        .map((l) => {
          const up = A.unitPrice(l.p, S.today);
          return (
            '<div class="line"><div class="line-txt"><p class="line-name">' + esc(l.p.name) + '</p><p class="line-price">' +
            (up == null ? 'Precio por confirmar' : esc(money(up * l.qty))) + '</p></div>' +
            '<div class="qty"><button class="step" type="button" data-act="dec" data-id="' + esc(l.p.id) + '" aria-label="Quitar uno: ' + esc(l.p.name) + '">' + icon('minus', 18) + '</button>' +
            '<b>' + l.qty + '</b>' +
            '<button class="step" type="button" data-act="inc" data-id="' + esc(l.p.id) + '" aria-label="Agregar uno más: ' + esc(l.p.name) + '">' + icon('plus', 18) + '</button></div>' +
            '<button class="rm" type="button" data-act="remove" data-id="' + esc(l.p.id) + '" aria-label="Quitar ' + esc(l.p.name) + ' del pedido">' + icon('close', 16) + '</button></div>'
          );
        })
        .join('');
    foot.hidden = false;
    $('#totalRow').hidden = !priced;
    $('#total').textContent = money(total);
    updateSend(lines, priced, total);
  }

  function updateSend(lines, priced, total) {
    if (!lines) {
      lines = cartLines();
      priced = lines.every((l) => A.unitPrice(l.p, S.today) != null);
      total = lines.reduce((a, l) => a + (priced ? A.unitPrice(l.p, S.today) * l.qty : 0), 0);
    }
    const send = $('#send');
    const note = $('#closedNote');
    if (!lines.length) return;
    if (canOrder()) {
      send.href = A.waLink(S.menu.settings.whatsapp, buildMessage(lines, priced, total));
      send.removeAttribute('aria-disabled');
      send.classList.remove('is-off');
      note.hidden = !(!S.status.open && S.menu.settings.acceptWhenClosed);
      note.textContent = 'Estamos cerrados, pero puedes enviar tu pedido y lo atendemos al abrir.';
    } else {
      send.href = '#';
      send.setAttribute('aria-disabled', 'true');
      send.classList.add('is-off');
      note.hidden = false;
      note.textContent = closedText();
    }
  }

  function renderFooter() {
    const st = S.menu.settings;
    const wa = st.whatsapp || '';
    $('#ftrTel').href = 'tel:+' + wa;
    $('#ftrTel').textContent = A.phoneDisplay(wa);
    const addr = String(st.address || '').trim();
    $('#ftrAddr').hidden = !addr;
    $('#ftrAddrTxt').textContent = addr;
    const hoursOn = st.mode === 'auto' && A.KEYS.some((k) => st.schedule[k] && st.schedule[k].open);
    $('#ftrHours').hidden = !hoursOn;
    if (hoursOn) {
      const today = A.JS_DAY[A.crNow().dow];
      $('#ftrHoursList').innerHTML = A.scheduleLines(st.schedule)
        .map((l) => '<li' + (l.keys.indexOf(today) !== -1 ? ' class="now"' : '') + '><span class="d">' + esc(l.days) + '</span><span>' + esc(l.text) + '</span></li>')
        .join('');
    }
    $('#copy').textContent = '© ' + S.today.slice(0, 4) + ' ' + (st.name || '');
  }

  function renderAll() {
    renderStatus();
    renderBrand();
    renderPromos();
    renderChips();
    renderGrid();
    renderSearch();
    renderCart();
    renderFooter();
  }

  /* ---------- acciones ---------- */
  function toast(text, withBtn, ms) {
    $('#toastTxt').textContent = text;
    $('#toastBtn').hidden = !withBtn;
    const t = $('#toast');
    t.hidden = false;
    clearTimeout(S.toastT);
    S.toastT = setTimeout(() => {
      t.hidden = true;
    }, ms || 2800);
  }

  // Cuando el cliente toca su pedido empieza uno nuevo: ya no se ofrece recuperar el anterior ni se repite el aviso.
  function touchCart() {
    S.cartNote = '';
    if (S.last) {
      S.last = null;
      saveLast();
    }
  }

  function add(id) {
    const p = visibleMap()[id];
    if (!p || p.soldOut) return;
    if (!canOrder()) {
      toast(closedText());
      return;
    }
    touchCart();
    S.cart[id] = Math.min(MAX_QTY, (S.cart[id] || 0) + 1);
    saveCart();
    renderCart();
    toast(p.name + ' agregado', true);
  }

  function change(id, d) {
    touchCart();
    const n = (S.cart[id] || 0) + d;
    if (n > 0) S.cart[id] = Math.min(MAX_QTY, n);
    else delete S.cart[id];
    saveCart();
    renderCart();
  }

  // La ❌ de cada producto: lo quita del pedido de una vez, sin importar cuántas unidades tenga.
  function removeLine(id) {
    if (!(S.cart[id] > 0)) return;
    touchCart();
    delete S.cart[id];
    saveCart();
    renderCart();
    // El botón que se tocó desaparece al dibujar de nuevo: el foco pasa al siguiente para quien usa teclado.
    const next = $('#cartBody [data-act="remove"]') || $('#cart .cart-head [data-act="close-cart"]');
    if (next) next.focus({ preventScroll: true });
  }

  // El enlace de "Enviar por WhatsApp" ya abrió WhatsApp con el mensaje: el pedido sale del carrito.
  // Se guarda una copia unas horas por si el cliente no llegó a enviar el mensaje.
  function orderSent() {
    const lines = cartLines();
    if (!lines.length) return;
    const cart = {};
    lines.forEach((l) => {
      cart[l.p.id] = l.qty;
    });
    S.last = { t: Date.now(), cart: cart, name: $('#custName').value, notes: $('#custNotes').value };
    saveLast();
    S.cart = {};
    S.cartNote = '';
    saveCart();
    $('#custName').value = '';
    $('#custNotes').value = '';
    renderCart();
  }

  function restoreOrder() {
    const o = lastOrder();
    if (!o) return;
    const wanted = Object.keys(o.cart).length;
    S.cart = Object.assign({}, o.cart);
    pruneCart(); // el menú pudo cambiar desde entonces
    const kept = Object.keys(S.cart).length;
    S.last = null;
    S.cartNote = kept < wanted ? (kept ? 'Algunos productos ya no están disponibles y no se recuperaron.' : 'Esos productos ya no están disponibles.') : '';
    saveLast();
    saveCart();
    $('#custName').value = typeof o.name === 'string' ? o.name.slice(0, 60) : '';
    $('#custNotes').value = typeof o.notes === 'string' ? o.notes.slice(0, 300) : '';
    renderCart();
  }

  function openCart() {
    const d = $('#cart');
    if (d.open) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
    document.body.classList.add('lock');
    $('#toast').hidden = true;
  }

  function closeCart() {
    const d = $('#cart');
    if (!d.open) return;
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
    document.body.classList.remove('lock');
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) {
      if (!e.target.closest('.search-box')) $('#qRes').hidden = true;
      return;
    }
    switch (t.getAttribute('data-act')) {
      case 'add':
        e.preventDefault();
        add(t.getAttribute('data-id'));
        break;
      case 'cat':
        S.cat = t.getAttribute('data-cat');
        renderChips();
        renderGrid();
        break;
      case 'open-cart':
        openCart();
        break;
      case 'close-cart':
        closeCart();
        break;
      case 'inc':
        change(t.getAttribute('data-id'), 1);
        break;
      case 'dec':
        change(t.getAttribute('data-id'), -1);
        break;
      case 'remove':
        removeLine(t.getAttribute('data-id'));
        break;
      case 'clear':
        touchCart();
        S.cart = {};
        saveCart();
        renderCart();
        break;
      case 'restore':
        restoreOrder();
        break;
      case 'clear-q':
        S.q = '';
        $('#q').value = '';
        renderSearch();
        $('#q').focus();
        break;
      case 'retry':
        init().finally(schedulePoll);
        break;
      default:
    }
  });

  $('#cart').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCart();
  });
  $('#cart').addEventListener('close', () => {
    document.body.classList.remove('lock');
    if (S.cartNote) {
      S.cartNote = '';
      renderCart(); // el aviso ya se leyó: al volver a abrir el pedido no debe seguir ahí
    }
  });

  $('#send').addEventListener('click', (e) => {
    if (!canOrder()) {
      e.preventDefault();
      toast(closedText());
      return;
    }
    // El enlace abre WhatsApp al terminar este evento (su dirección ya está lista), y de una vez el pedido sale del carrito:
    // así no se puede enviar dos veces con un doble toque y no depende de que la página siga activa mientras se abre WhatsApp.
    orderSent();
  });

  $('#q').addEventListener('input', (e) => {
    S.q = e.target.value;
    renderSearch();
  });
  $('#q').addEventListener('focus', renderSearch);
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      S.q = '';
      e.target.value = '';
      renderSearch();
    }
  });
  $('#custName').addEventListener('input', () => updateSend());
  $('#custNotes').addEventListener('input', () => updateSend());

  // Si una foto no carga, se muestra la imagen de reemplazo.
  document.addEventListener(
    'error',
    (e) => {
      const el = e.target;
      if (el && el.tagName === 'IMG' && el.closest('.card-img') && el.getAttribute('src') !== PLACEHOLDER) el.src = PLACEHOLDER;
    },
    true
  );

  /* ---------- acceso discreto al panel ---------- */
  // Dos toques seguidos en el logo del encabezado abren /admin. Si ya hay sesión iniciada, entra directo.
  (function () {
    const logo = document.querySelector('.brand img');
    if (!logo) return;
    logo.style.touchAction = 'manipulation';
    logo.style.webkitUserSelect = 'none';
    logo.style.userSelect = 'none';
    logo.draggable = false;
    let last = -1e9;
    logo.addEventListener('click', (e) => {
      if (e.timeStamp - last <= 450) {
        last = -1e9;
        e.preventDefault();
        location.assign('/admin');
      } else {
        last = e.timeStamp;
      }
    });
  })();

  /* ---------- arranque y actualización ---------- */
  function showLoadError() {
    $('#grid').hidden = true;
    const empty = $('#empty');
    empty.hidden = false;
    empty.innerHTML =
      '<h3>No pudimos cargar el menú</h3><p>Revisa tu conexión e intenta de nuevo.</p>' +
      '<button class="cta cta-dk" type="button" data-act="retry">REINTENTAR<span class="cta-ar">' + icon('arrow', 16) + '</span></button>';
  }

  async function init() {
    const got = await loadMenu();
    if (!got) {
      showLoadError();
      return;
    }
    S.menu = fix(got.menu);
    S.sig = got.sig;
    S.checkedAt = Date.now();
    S.today = A.crNow().ymd;
    S.cart = loadCart();
    S.last = loadLast();
    renderStatus();
    pruneCart();
    saveCart();
    renderAll();
  }

  // Estado del pedido tal como se ve con el menú actual: producto -> nombre y precio por unidad.
  function cartState() {
    const vm = visibleMap();
    const o = {};
    Object.keys(S.cart).forEach((id) => {
      if (S.cart[id] > 0 && vm[id]) o[id] = { name: vm[id].name, price: A.unitPrice(vm[id], S.today) };
    });
    return o;
  }

  // Pone en pantalla un menú nuevo. Si cambió algo del pedido del cliente (un producto que se agotó o se quitó, o un precio),
  // se lo dice: dentro del pedido si lo tiene abierto, o con un aviso si no.
  function applyMenu(got) {
    const before = cartState();
    S.menu = fix(got.menu);
    S.sig = got.sig;
    S.today = A.crNow().ymd;
    renderStatus();
    pruneCart();
    saveCart();
    const after = cartState();
    const gone = Object.keys(before).filter((id) => !after[id]);
    const moved = Object.keys(after).some((id) => before[id] && before[id].price !== after[id].price);
    let note = '';
    if (gone.length === 1) note = '«' + before[gone[0]].name + '» ya no está disponible y salió de tu pedido.';
    else if (gone.length > 1) note = 'Algunos productos ya no están disponibles y salieron de tu pedido.';
    else if (moved) note = 'Actualizamos los precios de tu pedido.';
    if (note) S.cartNote = note;
    renderAll();
    if (note && !$('#cart').open) toast(note, true, 6000);
  }

  // Revisa si el menú cambió y, si es así, lo actualiza sin recargar la página.
  // urgent = lectura directa sin caché (al volver a la página o cuando el panel acaba de guardar).
  async function refresh(urgent) {
    if (S.busy) {
      if (urgent) S.again = true; // el cambio pudo llegar después de que empezó esta lectura: se repite al terminar
      return;
    }
    S.busy = true;
    S.checkedAt = Date.now();
    let ok = false;
    try {
      if (!S.menu) {
        await init(); // todavía no había menú (falló la primera carga): se vuelve a intentar
        ok = !!S.menu;
      } else {
        const got = await fetchMenu(urgent);
        if (got) {
          ok = true;
          if (got.sig !== S.sig) applyMenu(got);
        }
      }
    } catch (e) {
      ok = false;
    }
    S.fails = ok ? 0 : S.fails + 1;
    S.busy = false;
    if (S.again) {
      S.again = false;
      refresh(true);
    }
  }

  // Revisión periódica: cada 20 s mientras la página se está viendo. Con la pantalla apagada o en otra pestaña no se hace nada.
  function schedulePoll() {
    clearTimeout(S.pollT);
    if (document.hidden) return;
    const wait = Math.min(POLL_MAX, POLL_MS * Math.pow(2, Math.min(S.fails, 3)));
    S.pollT = setTimeout(async () => {
      await refresh(false);
      schedulePoll();
    }, wait);
  }

  // Al volver a la página, recuperar la conexión o cuando el panel guardó, se revisa enseguida sin esperar al ciclo.
  function wake(force) {
    if (document.hidden) return;
    if (force || Date.now() - S.checkedAt >= WAKE_GAP) {
      refresh(true).finally(schedulePoll);
    } else {
      schedulePoll();
    }
  }

  // Cada minuto se revisa si el negocio abrió o cerró.
  setInterval(() => {
    if (!S.menu) return;
    const before = canOrder();
    const day = S.today;
    S.today = A.crNow().ymd;
    renderStatus();
    if (before !== canOrder() || day !== S.today) renderAll();
    else renderFooter();
  }, 60000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(S.pollT);
    else wake(false);
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) wake(true); // la página volvió desde el historial sin recargarse
  });
  window.addEventListener('focus', () => wake(false));
  window.addEventListener('online', () => wake(true));
  // El panel (en otra pestaña de este navegador) acaba de guardar: se muestra el cambio de inmediato.
  window.addEventListener('storage', (e) => {
    if (e.key === PING_KEY || e.key === LOCAL_KEY) refresh(true).finally(schedulePoll); // también con la pestaña en segundo plano
  });

  A.hydrateIcons();
  init().finally(schedulePoll);
})();
