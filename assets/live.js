// Live prices + stock from Firestore, and checkout through Cloud Functions (orders + M-Pesa).
// Does nothing until assets/firebase-config.js is filled in.
import { ready, paymentsOn, firestore, functions } from './fb.js';

const body = document.body;
const SHOP = body.dataset.shop || 'Nainezz';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const NZ = () => window.NZ || { ksh: n => 'KSh ' + n, waUrl: m => '#', clearCart() {} };
const ksh = n => NZ().ksh(n);
const num = v => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);

function setPrice(el, price, was, from) {
  el.textContent = '';
  if (from) { const f = document.createElement('span'); f.className = 'from'; f.textContent = 'From'; el.append(f, ' '); }
  el.append(ksh(price));
  if (was > price) {
    const s = document.createElement('s'); s.className = 'was'; s.textContent = ksh(was);
    const o = document.createElement('span'); o.className = 'off'; o.textContent = '−' + Math.round((1 - price / was) * 100) + '%';
    el.append(s, o);
  }
}

function overlay(P) {
  $$('.card[data-slug]').forEach(c => {
    const p = P[c.dataset.slug];
    if (!p) return;
    if (p.active === false) { c.dataset.off = '1'; c.hidden = true; return; }
    const v = Array.isArray(p.variants) ? p.variants[0] : null;
    if (!v || !num(v.price)) return;
    const price = num(v.price), was = num(v.was);
    setPrice($('.price', c), price, was, p.variants.length > 1);
    c.dataset.p = price;
    c.dataset.d = was > price ? Math.round((1 - price / was) * 100) : 0;
    const add = $('[data-add]', c), wa = $('a.wa', c), stk = $('.stk', c);
    const out = typeof p.stock === 'number' && p.stock <= 0;
    if (add) {
      add.dataset.price = price; add.dataset.variant = String(v.label || '');
      add.disabled = out; add.textContent = out ? 'Sold out' : 'Add to cart';
    }
    if (wa) wa.href = NZ().waUrl(`Hi ${SHOP}, I would like to order: ${add ? add.dataset.name : ''} (${v.label}) – ${ksh(price)}. Is it available?`);
    if (stk) { stk.textContent = out ? 'Out of stock' : 'In stock'; stk.classList.toggle('out', out); }
  });

  const slug = body.dataset.product;
  const p = slug && P[slug];
  if (p) {
    const add = $('#pAdd'), stock = $('#pStock');
    const out = p.active === false || (typeof p.stock === 'number' && p.stock <= 0);
    const buttons = $$('.var');
    (p.variants || []).forEach(v => {
      const b = buttons.find(x => x.dataset.label === String(v.label));
      if (!b) return;
      b.dataset.price = num(v.price); b.dataset.was = num(v.was) > num(v.price) ? num(v.was) : '';
      const sm = $('small', b); if (sm) sm.textContent = ksh(num(v.price));
    });
    const pressed = buttons.find(b => b.getAttribute('aria-pressed') === 'true');
    if (pressed) pressed.click(); // app.js refreshes price, WhatsApp link and cart button
    else if (p.variants && p.variants[0]) {
      const v = p.variants[0], price = num(v.price), was = num(v.was);
      $('#pPrice').textContent = ksh(price);
      const w = $('#pWas'), o = $('#pOff');
      if (was > price) { w.textContent = ksh(was); o.textContent = '−' + Math.round((1 - price / was) * 100) + '%'; }
      w.hidden = o.hidden = !(was > price);
      const wa = $('#pWa'); if (wa) wa.href = NZ().waUrl(wa.dataset.msg + ` (${v.label}) – ${ksh(price)}. Is it available?`);
      if (add) add.dataset.price = price;
    }
    if (stock) stock.textContent = p.active === false ? 'No longer sold — ask us for alternatives'
      : out ? 'Out of stock — ask us on WhatsApp when it’s back'
      : typeof p.stock === 'number' && p.stock <= 3 ? `Only ${p.stock} left in stock` : 'In stock in Nairobi';
    if (add) { add.disabled = out; add.textContent = out ? 'Sold out' : 'Add to cart'; }
  }
  document.dispatchEvent(new Event('nz:live'));
}

/* ---------- checkout ---------- */
function statusBox(text, kind) {
  const box = $('#orderStatus');
  box.hidden = false; box.className = 'ostatus ' + (kind || '');
  box.textContent = '';
  const p = document.createElement('p'); p.textContent = text; box.appendChild(p);
  return box;
}
function waButton(box, label, msg) {
  const a = document.createElement('a');
  a.className = 'btn wa big'; a.target = '_blank'; a.rel = 'noopener';
  a.href = NZ().waUrl(msg); a.textContent = label;
  box.appendChild(a);
}

// Free plan: the order is written straight to Firestore (rules check its shape), then sent on WhatsApp.
function orderRef() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(r, x => abc[x % abc.length]).join('');
}
function setupDirectCheckout(form) {
  const btn = $('#checkoutBtn'), err = $('#checkoutErr'), choice = $('#payChoice'), label = $('#checkoutLabel');
  const api = (body.dataset.root || '') + 'api/';

  // M-Pesa runs on Cloudflare (/api). Show the choice only when the server says it's switched on.
  fetch(api + 'health', { cache: 'no-store' }).then(r => (r.ok ? r.json() : {})).then(h => {
    if (!h || h.mpesa !== true) return;
    choice.hidden = false;
    const sync = () => {
      const mp = (form.querySelector('input[name=pay]:checked') || {}).value === 'mpesa';
      label.textContent = mp ? 'Pay with M-Pesa' : 'Send order on WhatsApp';
      btn.classList.toggle('mp', mp);
    };
    $$('input[name=pay]', form).forEach(r => r.addEventListener('change', sync));
    sync();
  }).catch(() => {});

  window.NZ_CHECKOUT = async d => {
    err.hidden = true;
    const phone = d.phone.replace(/[\s-]/g, '');
    if (!/^(?:\+?254|0)?[17]\d{8}$/.test(phone)) {
      err.textContent = d.pay === 'mpesa' && !choice.hidden
        ? 'Enter the M-Pesa phone number to pay with, e.g. 0712 345 678.'
        : 'Add your phone number so we can confirm the order, e.g. 0712 345 678.';
      err.hidden = false; form.elements.phone.focus(); return;
    }
    btn.disabled = true;
    if (d.pay === 'mpesa' && !choice.hidden) return mpesaCheckout(d, api, btn);

    statusBox('Placing your order…');
    const ref = orderRef();
    const items = d.items.slice(0, 20).map(x => ({ slug: String(x.slug).slice(0, 80), name: String(x.name).slice(0, 120),
      variant: String(x.variant || '').slice(0, 60), price: Math.round(num(x.price)), qty: Math.min(20, Math.max(1, Math.round(num(x.qty)))) }));
    const total = items.reduce((s, x) => s + x.price * x.qty, 0);
    try {
      const { m, db } = await firestore();
      await m.addDoc(m.collection(db, 'orders'), {
        ref, items, total, pay: 'whatsapp', status: 'new', stockDeducted: false,
        name: d.name.slice(0, 60), phone: phone.slice(0, 16), area: d.area.slice(0, 100), notes: d.notes.slice(0, 300),
        createdAt: m.serverTimestamp()
      });
    } catch (e) {
      console.warn('Order not saved online', e);
      const box = statusBox('We couldn’t save the order online, but you can send it to us on WhatsApp.', 'bad');
      waButton(box, 'Send order on WhatsApp', d.msg);
      btn.disabled = false;
      return;
    }
    NZ().clearCart();
    const box = statusBox(`Order #${ref} received — total ${ksh(total)}. Send it to us on WhatsApp and we’ll confirm the price and delivery.`, 'good');
    waButton(box, 'Send order on WhatsApp', `Order #${ref}\n` + d.msg);
  };
}

async function postJson(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}

async function mpesaCheckout(d, api, btn) {
  statusBox('Sending the M-Pesa request to your phone…', 'wait');
  let r;
  try {
    r = await postJson(api + 'order', {
      items: d.items.map(x => ({ slug: x.slug, variant: x.variant, qty: x.qty, name: x.name })),
      name: d.name, phone: d.phone, area: d.area, notes: d.notes
    });
  } catch (e) {
    const box = statusBox(e.message + ' You can still order on WhatsApp and pay on delivery.', 'bad');
    waButton(box, 'Order on WhatsApp instead', d.msg);
    btn.disabled = false;
    return;
  }
  const msg = `Order #${r.ref}\n` + d.msg;
  statusBox(`Order #${r.ref}: check your phone and enter your M-Pesa PIN to pay ${ksh(r.total)}.`, 'wait');
  const started = Date.now();
  const tick = async () => {
    let s;
    try { s = await postJson(api + 'order-status', { id: r.id, token: r.token }); } catch (e) { s = { status: 'awaiting_payment' }; }
    if (s.status === 'paid' || s.status === 'delivered') {
      NZ().clearCart();
      const box = statusBox(`Paid — thank you!${s.receipt ? ' M-Pesa receipt ' + s.receipt + '.' : ''} Order #${r.ref} is confirmed; we’ll call you about delivery.`, 'good');
      waButton(box, 'Message us about delivery', msg + `\nPaid by M-Pesa ${s.receipt || ''}`);
      return;
    }
    if (s.status === 'payment_failed' || s.status === 'cancelled') {
      const box = statusBox(`The payment didn’t go through${s.reason ? ' (' + s.reason + ')' : ''}. You can try again, or order on WhatsApp and pay on delivery.`, 'bad');
      waButton(box, 'Order on WhatsApp instead', msg);
      btn.disabled = false;
      return;
    }
    if (Date.now() - started > 150000) {
      const box = statusBox(`Still waiting for the M-Pesa payment for order #${r.ref}. If you paid, we’ll confirm on WhatsApp.`, 'wait');
      waButton(box, 'Message us on WhatsApp', msg);
      btn.disabled = false;
      return;
    }
    setTimeout(tick, 4000);
  };
  setTimeout(tick, 6000);
}

function setupCheckout() {
  const form = $('#checkoutForm');
  if (!form) return;
  if (!paymentsOn) { setupDirectCheckout(form); return; }
  const choice = $('#payChoice'), label = $('#checkoutLabel'), btn = $('#checkoutBtn'), err = $('#checkoutErr');
  choice.hidden = false;
  const sync = () => {
    const mpesa = (form.querySelector('input[name=pay]:checked') || {}).value === 'mpesa';
    label.textContent = mpesa ? 'Pay with M-Pesa' : 'Place order';
    btn.classList.toggle('mp', mpesa);
  };
  $$('input[name=pay]', form).forEach(r => r.addEventListener('change', sync));
  sync();

  window.NZ_CHECKOUT = async d => {
    err.hidden = true;
    if (d.pay === 'mpesa' && !/^(?:\+?254|0)?[17]\d{8}$/.test(d.phone.replace(/[\s-]/g, ''))) {
      err.textContent = 'Enter the M-Pesa phone number to pay with, e.g. 0712 345 678.'; err.hidden = false;
      form.elements.phone.focus(); return;
    }
    btn.disabled = true;
    statusBox('Placing your order…');
    let r;
    try {
      const { m, fns } = await functions();
      const res = await m.httpsCallable(fns, 'createOrder')({
        items: d.items.map(x => ({ slug: x.slug, variant: x.variant, qty: x.qty, name: x.name })),
        name: d.name, phone: d.phone, area: d.area, notes: d.notes, pay: d.pay
      });
      r = res.data;
    } catch (e) {
      const box = statusBox((e && e.message ? e.message : 'We could not place the order online.') + ' You can still send it to us on WhatsApp.', 'bad');
      waButton(box, 'Send order on WhatsApp', d.msg);
      btn.disabled = false;
      return;
    }
    const msg = `Order #${r.number}\n` + d.msg;
    if (d.pay !== 'mpesa') {
      NZ().clearCart();
      const box = statusBox(`Order #${r.number} received — total ${ksh(r.total)}. Send it to us on WhatsApp and we’ll confirm delivery.`, 'good');
      waButton(box, 'Send order on WhatsApp', msg);
      return;
    }
    statusBox(`Order #${r.number}: check your phone and enter your M-Pesa PIN to pay ${ksh(r.total)}.`, 'wait');
    poll(r, msg, btn);
  };
}

async function poll(r, msg, btn) {
  const { m, fns } = await functions();
  const check = m.httpsCallable(fns, 'orderStatus');
  const started = Date.now();
  const tick = async () => {
    let s;
    try { s = (await check({ id: r.id, token: r.token })).data; } catch (e) { s = { status: 'awaiting_payment' }; }
    if (s.status === 'paid' || s.status === 'delivered') {
      NZ().clearCart();
      const box = statusBox(`Paid — thank you! M-Pesa receipt ${s.receipt || ''}. Order #${r.number} is confirmed; we’ll call you about delivery.`.replace('  ', ' '), 'good');
      waButton(box, 'Message us about delivery', msg + `\nPaid by M-Pesa ${s.receipt || ''}`);
      return;
    }
    if (s.status === 'payment_failed' || s.status === 'cancelled') {
      const box = statusBox(`The payment didn’t go through${s.reason ? ' (' + s.reason + ')' : ''}. You can try again, or order on WhatsApp and pay on delivery.`, 'bad');
      waButton(box, 'Order on WhatsApp instead', msg);
      btn.disabled = false;
      return;
    }
    if (Date.now() - started > 150000) {
      const box = statusBox(`Still waiting for the M-Pesa payment for order #${r.number}. If you paid, we’ll confirm on WhatsApp.`, 'wait');
      waButton(box, 'Message us on WhatsApp', msg);
      btn.disabled = false;
      return;
    }
    setTimeout(tick, 4000);
  };
  setTimeout(tick, 5000);
}

async function start() {
  setupCheckout();
  try {
    const { m, db } = await firestore();
    const snap = await m.getDocs(m.collection(db, 'products'));
    const P = {};
    snap.forEach(d => { P[d.id] = d.data(); });
    if (Object.keys(P).length) overlay(P);
  } catch (e) {
    console.warn('Live prices unavailable, showing built-in prices.', e);
  }
}

if (ready) start();
