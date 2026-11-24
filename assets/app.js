/* Nainezz shop — shared behaviour for every page. No libraries. */
(() => {
  'use strict';
  const body = document.body;
  const R = body.dataset.root || '';
  const WA = body.dataset.wa || '';
  const SHOP = body.dataset.shop || 'Nainezz';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ksh = n => 'KSh ' + Math.round(Number(n) || 0).toLocaleString('en-KE');
  const waUrl = msg => 'https://wa.me/' + WA + '?text=' + encodeURIComponent(msg);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const openWa = msg => { const w = window.open(waUrl(msg), '_blank', 'noopener'); if (!w) location.href = waUrl(msg); };

  /* ---------- toast ---------- */
  const toastEl = $('#toast');
  let toastT;
  function toast(text, withLink) {
    if (!toastEl) return;
    toastEl.textContent = text;
    if (withLink) {
      const a = document.createElement('a');
      a.href = R + 'cart.html'; a.textContent = ' View cart →';
      toastEl.appendChild(a);
    }
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('on'), 2600);
  }

  /* ---------- cart (kept in this browser only) ---------- */
  const KEY = 'nz-cart-v2';
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (!Array.isArray(raw)) return [];
      return raw.filter(x => x && typeof x.slug === 'string' && /^[a-z0-9-]{1,80}$/.test(x.slug))
        .map(x => ({ slug: x.slug, name: String(x.name || '').slice(0, 120), variant: String(x.variant || '').slice(0, 60),
          price: Math.max(0, Math.min(10000000, Number(x.price) || 0)), qty: Math.max(1, Math.min(20, parseInt(x.qty, 10) || 1)) }));
    } catch (e) { return []; }
  }
  let cart = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) { /* storage off: cart lasts this page only */ } };
  function updateCount() {
    const n = cart.reduce((s, x) => s + x.qty, 0);
    $$('[data-cart-count]').forEach(el => { el.textContent = n; });
  }
  function addToCart(d) {
    const price = Number(d.price) || 0;
    const hit = cart.find(x => x.slug === d.add && x.variant === d.variant);
    if (hit) hit.qty = Math.min(20, hit.qty + 1);
    else cart.push({ slug: d.add, name: d.name, variant: d.variant || '', price, qty: 1 });
    save(); updateCount(); renderCart();
    toast('Added: ' + d.name + (d.variant ? ' (' + d.variant + ')' : ''), true);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if (b) addToCart(b.dataset);
  });
  window.addEventListener('storage', ev => { if (ev.key === KEY) { cart = load(); updateCount(); renderCart(); } });

  /* ---------- cart page ---------- */
  const linesEl = $('#cartLines');
  function renderCart() {
    if (!linesEl) return;
    linesEl.textContent = '';
    if (!cart.length) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.innerHTML = 'Your cart is empty. <a href="' + R + 'shop.html">Browse products</a>';
      linesEl.appendChild(p);
    }
    cart.forEach((x, i) => {
      const row = document.createElement('div'); row.className = 'line';
      const img = document.createElement('a'); img.className = 'lp'; img.href = R + 'product/' + x.slug + '.html';
      img.textContent = (x.name[0] || '•').toUpperCase(); img.setAttribute('aria-hidden', 'true'); img.tabIndex = -1;
      const info = document.createElement('div');
      const name = document.createElement('a'); name.className = 'ln'; name.href = img.href; name.textContent = x.name;
      const sub = document.createElement('small'); sub.textContent = (x.variant ? x.variant + ' · ' : '') + ksh(x.price) + ' each';
      info.append(name, sub);
      const tot = document.createElement('div'); tot.className = 'lt'; tot.textContent = ksh(x.price * x.qty);
      const q = document.createElement('div'); q.className = 'qty';
      const minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', 'One less');
      const n = document.createElement('b'); n.textContent = x.qty;
      const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'One more');
      minus.onclick = () => { x.qty--; if (x.qty < 1) cart.splice(i, 1); save(); updateCount(); renderCart(); };
      plus.onclick = () => { x.qty = Math.min(20, x.qty + 1); save(); updateCount(); renderCart(); };
      q.append(minus, n, plus);
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rm'; rm.textContent = 'Remove';
      rm.onclick = () => { cart.splice(i, 1); save(); updateCount(); renderCart(); toast('Removed from cart'); };
      row.append(img, info, tot, q, rm);
      linesEl.appendChild(row);
    });
    const total = cart.reduce((s, x) => s + x.price * x.qty, 0);
    const t = $('#cartTotal'); if (t) t.textContent = ksh(total);
    const btn = $('#checkoutBtn'); if (btn) btn.disabled = !cart.length;
  }
  const co = $('#checkoutForm');
  if (co) {
    try { const saved = JSON.parse(localStorage.getItem('nz-details') || '{}'); ['name', 'phone', 'area'].forEach(k => { if (saved[k] && co.elements[k]) co.elements[k].value = String(saved[k]).slice(0, 100); }); } catch (e) { /* ignore */ }
    co.addEventListener('submit', e => {
      e.preventDefault();
      if (!cart.length) return;
      const f = co.elements;
      const d = { name: f.name.value.trim(), phone: f.phone.value.trim(), area: f.area.value.trim(), notes: f.notes.value.trim(),
        pay: (co.querySelector('input[name=pay]:checked') || {}).value || 'whatsapp', items: cart.map(x => Object.assign({}, x)) };
      try { localStorage.setItem('nz-details', JSON.stringify({ name: d.name, phone: d.phone, area: d.area })); } catch (err) { /* ignore */ }
      let msg = 'Hi ' + SHOP + ', I would like to order:\n';
      cart.forEach(x => { msg += '• ' + x.qty + ' × ' + x.name + (x.variant ? ' (' + x.variant + ')' : '') + ' – ' + ksh(x.price * x.qty) + '\n'; });
      msg += 'Total: ' + ksh(cart.reduce((s, x) => s + x.price * x.qty, 0)) + '\n';
      if (d.name) msg += 'Name: ' + d.name + '\n';
      if (d.phone) msg += 'Phone: ' + d.phone + '\n';
      msg += 'Delivery: ' + (d.area || '(please advise)') + '\n';
      if (d.notes) msg += 'Notes: ' + d.notes;
      d.msg = msg;
      // With Firebase set up, live.js takes over: saves the order and can start an M-Pesa payment.
      if (typeof window.NZ_CHECKOUT === 'function') window.NZ_CHECKOUT(d);
      else openWa(msg);
    });
  }

  /* ---------- WhatsApp forms (trade-in, contact) ---------- */
  $$('form[data-wa-form]').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const err = $('.err', form);
      const missing = $$('[required]', form).some(el => !el.value.trim());
      if (err) err.hidden = !missing;
      if (missing) { $$('[required]', form).find(el => !el.value.trim()).focus(); return; }
      let msg = 'Hi ' + SHOP + ' — ' + form.dataset.waForm + '\n';
      $$('input,select,textarea', form).forEach(el => { if (el.name && el.value.trim()) msg += el.name + ': ' + el.value.trim() + '\n'; });
      openWa(msg);
    });
  });

  /* ---------- hero slider ---------- */
  const slides = $('#slides');
  if (slides) {
    const n = slides.children.length;
    const dots = $$('.dots button');
    let cur = 0, timer = null;
    const go = i => { cur = (i + n) % n; slides.scrollTo({ left: cur * slides.clientWidth, behavior: reduce ? 'auto' : 'smooth' }); };
    slides.addEventListener('scroll', () => {
      const i = Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth));
      cur = i; dots.forEach((d, j) => d.setAttribute('aria-current', String(j === i)));
    }, { passive: true });
    const stop = () => { clearInterval(timer); timer = null; };
    $('.hprev').onclick = () => { stop(); go(cur - 1); };
    $('.hnext').onclick = () => { stop(); go(cur + 1); };
    dots.forEach(d => { d.onclick = () => { stop(); go(Number(d.dataset.go)); }; });
    if (!reduce && n > 1) timer = setInterval(() => go(cur + 1), 6000);
    ['pointerdown', 'focusin'].forEach(ev => slides.addEventListener(ev, stop));
  }

  /* ---------- product rows ---------- */
  $$('[data-scroll]').forEach(b => {
    b.addEventListener('click', () => {
      const row = document.getElementById(b.dataset.scroll);
      if (row) row.scrollBy({ left: Number(b.dataset.dir) * row.clientWidth * 0.85, behavior: reduce ? 'auto' : 'smooth' });
    });
  });

  /* ---------- tabs ---------- */
  $$('[role=tablist]').forEach(list => {
    const tabs = $$('[role=tab]', list);
    const pick = t => tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', String(on)); document.getElementById(x.getAttribute('aria-controls')).hidden = !on; });
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => pick(t));
      t.addEventListener('keydown', e => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { const nt = tabs[(i + d + tabs.length) % tabs.length]; pick(nt); nt.focus(); }
      });
    });
  });

  /* ---------- listing filter / search / sort ---------- */
  const grid = $('#pgrid');
  if (grid) {
    const cards = $$('.card', grid);
    const q = $('#fq'), sort = $('#sort'), count = $('#fcount'), none = $('#noRes'), ask = $('#askWa');
    const params = new URLSearchParams(location.search);
    let brand = (params.get('brand') || '').slice(0, 40), cat = '';
    const initialQ = (params.get('q') || '').slice(0, 80);
    if (q && initialQ) q.value = initialQ;
    const hs = $('.search input'); if (hs && initialQ) hs.value = initialQ;
    const sync = (attr, val) => $$('[' + attr + ']').forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === val)));
    if (brand && !$$('[data-fb]').some(b => b.dataset.fb === brand)) brand = '';
    function apply() {
      const words = (q ? q.value : '').toLowerCase().split(/\s+/).filter(Boolean);
      const mode = sort ? sort.value : '';
      const order = cards.slice();
      if (mode === 'lo') order.sort((a, b) => a.dataset.p - b.dataset.p);
      if (mode === 'hi') order.sort((a, b) => b.dataset.p - a.dataset.p);
      if (mode === 'off') order.sort((a, b) => b.dataset.d - a.dataset.d);
      order.forEach(c => grid.appendChild(c));
      let shown = 0;
      cards.forEach(c => {
        const ok = c.dataset.off !== '1' && (!brand || c.dataset.b === brand) && (!cat || c.dataset.c === cat) && words.every(w => c.dataset.n.includes(w));
        c.hidden = !ok; if (ok) shown++;
      });
      if (count) count.textContent = shown + (shown === 1 ? ' product' : ' products') + (brand ? ' · ' + brand : '');
      if (none) none.hidden = shown > 0;
      if (ask) ask.href = waUrl('Hi ' + SHOP + ', do you have: ' + (q && q.value.trim() ? q.value.trim() : 'a product I could not find') + '?');
      sync('data-fb', brand); sync('data-fc', cat);
    }
    $$('[data-fb]').forEach(b => b.addEventListener('click', () => { brand = b.dataset.fb; apply(); }));
    $$('[data-fc]').forEach(b => b.addEventListener('click', () => { cat = b.dataset.fc; apply(); }));
    if (q) q.addEventListener('input', apply);
    if (sort) sort.addEventListener('change', apply);
    document.addEventListener('nz:live', apply);
    apply();
  }

  /* ---------- product page options ---------- */
  const vars = $$('.var');
  if (vars.length) {
    const price = $('#pPrice'), was = $('#pWas'), off = $('#pOff'), wa = $('#pWa'), add = $('#pAdd');
    vars.forEach(v => v.addEventListener('click', () => {
      vars.forEach(x => x.setAttribute('aria-pressed', String(x === v)));
      const p = Number(v.dataset.price), w = Number(v.dataset.was);
      price.textContent = ksh(p);
      if (w) { was.textContent = ksh(w); off.textContent = '−' + Math.round((1 - p / w) * 100) + '%'; }
      was.hidden = off.hidden = !w;
      wa.href = waUrl(wa.dataset.msg + ' (' + v.dataset.label + ') – ' + ksh(p) + '. Is it available?');
      add.dataset.variant = v.dataset.label; add.dataset.price = String(p);
    }));
  }

  /* shared with live.js */
  window.NZ = {
    ksh, waUrl,
    clearCart() { cart = []; save(); updateCount(); renderCart(); }
  };

  updateCount();
  renderCart();
})();
