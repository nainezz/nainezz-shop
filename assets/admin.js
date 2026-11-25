// Shop admin: orders, products & stock, shop details. Everything is written to the page as text, never as HTML.
import { ready, firestore, auth as getAuth, storage as getStorage } from './fb.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const ksh = n => 'KSh ' + Math.round(Number(n) || 0).toLocaleString('en-KE');
const show = (id, on = true) => { $(id).hidden = !on; };
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(c => n.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return n;
}
let toastT;
function toast(t) { const n = $('#toast'); n.textContent = t; n.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => n.classList.remove('on'), 2600); }
const STATUS = { new: 'New', awaiting_payment: 'Awaiting payment', paid: 'Paid', delivered: 'Delivered', cancelled: 'Cancelled', payment_failed: 'Payment failed' };
const CATS = [['smartphones', 'Smartphones'], ['tablets', 'Tablets & iPads'], ['laptops', 'Laptops'], ['audio', 'Audio'], ['smartwatches', 'Smartwatches'], ['accessories', 'Accessories']];
const PHOTO = /^(https:\/\/|images\/)[^\s"'<>]+$/;
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

let F, db, A, auth, unsub = [];

if (!ready) show('#notReady');
else init().catch(e => { console.error(e); show('#notReady'); });

async function init() {
  ({ m: F, db } = await firestore());
  ({ m: A, auth } = await getAuth());
  $('#login').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.elements, err = $('#loginErr');
    err.hidden = true;
    try { await A.signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value); }
    catch (ex) { err.textContent = /invalid|wrong|not-found|credential/.test(ex.code || '') ? 'Wrong email or password.' : 'Could not sign in: ' + (ex.code || ex.message); err.hidden = false; }
  });
  $('#logout').onclick = () => A.signOut(auth);
  $('#forgot').onclick = async () => {
    const email = $('#login').elements.email.value.trim(), msg = $('#forgotMsg');
    msg.hidden = false;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Type your email in the Email box first, then tap “Forgot password?” again.'; return; }
    try { await A.sendPasswordResetEmail(auth, email); } catch (e) { /* same answer either way, so nobody can test which emails exist */ }
    msg.textContent = `If ${email} is an admin account, a reset link is on its way. Check your inbox and spam folder.`;
  };
  $('#copyUid').onclick = () => navigator.clipboard && navigator.clipboard.writeText($('#uid').textContent).then(() => toast('Copied'), () => {});
  A.onAuthStateChanged(auth, async u => {
    unsub.forEach(f => f()); unsub = [];
    ['#login', '#notAdmin', '#app'].forEach(id => show(id, false));
    $('#logout').hidden = !u; $('#who').textContent = u ? u.email : '';
    if (!u) { show('#login'); return; }
    let isAdmin = false, why = '';
    try {
      isAdmin = (await F.getDoc(F.doc(db, 'admins', u.uid))).exists();
      if (!isAdmin) why = 'Checked: no document with this ID in the “admins” collection yet.';
    } catch (e) {
      why = e.code === 'permission-denied'
        ? 'Checked: the database refused the check (permission-denied). The security rules are probably not published yet — paste firestore.rules in Firestore → Rules and click Publish.'
        : `Checked: could not reach the database (${e.code || e.message}). Make sure Firestore Database is created in this project.`;
    }
    if (!isAdmin) { $('#uid').textContent = u.uid; $('#why').textContent = why; show('#notAdmin'); return; }
    show('#app');
    startApp();
  });
}

/* ---------------- tabs ---------------- */
function tabs() {
  const all = $$('[role=tab]');
  all.forEach(t => t.onclick = () => all.forEach(x => {
    const on = x === t; x.setAttribute('aria-selected', String(on)); $('#' + x.getAttribute('aria-controls')).hidden = !on;
  }));
}

function startApp() {
  tabs();
  watchOrders();
  watchProducts();
  loadSettings();
}

/* ---------------- orders ---------------- */
let orders = [];
function watchOrders() {
  const q = F.query(F.collection(db, 'orders'), F.orderBy('createdAt', 'desc'), F.limit(300));
  unsub.push(F.onSnapshot(q, s => { orders = s.docs.map(d => { const x = d.data(); return { ...x, id: d.id, code: x.ref, ref: d.ref }; }); renderOrders(); },
    e => toast('Could not load orders: ' + e.code)));
  $('#oq').oninput = renderOrders; $('#ofilter').onchange = renderOrders;
}
function renderOrders() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const isToday = o => o.createdAt && o.createdAt.toMillis() >= t0;
  const sold = o => o.status === 'paid' || o.status === 'delivered';
  const month = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const k = [
    [orders.filter(isToday).length, 'orders today'],
    [ksh(orders.filter(o => isToday(o) && sold(o)).reduce((s, o) => s + o.total, 0)), 'paid today'],
    [ksh(orders.filter(o => o.createdAt && o.createdAt.toMillis() >= month && sold(o)).reduce((s, o) => s + o.total, 0)), 'paid this month'],
    [orders.filter(o => o.status === 'new' || o.status === 'paid').length, 'to deliver']
  ];
  $('#kpis').replaceChildren(...k.map(([v, l]) => el('div', {}, el('b', { text: v }), el('span', { text: l }))));

  const words = $('#oq').value.toLowerCase().split(/\s+/).filter(Boolean);
  const st = $('#ofilter').value;
  const list = orders.filter(o => (!st || o.status === st) && words.every(w => `#${o.number ?? o.code} ${o.name} ${o.phone} ${o.area}`.toLowerCase().includes(w)));
  const tb = $('#orders tbody');
  tb.replaceChildren(...list.map(o => {
    const no = o.number ?? o.code;
    const sel = el('select', { 'aria-label': `Status of order ${no}`, onchange: async e => {
      try { await setStatus(o, e.target.value); toast(`Order #${no}: ${STATUS[e.target.value]}`); }
      catch (ex) { toast('Not saved: ' + (ex.code || ex.message)); e.target.value = o.status; }
    } }, Object.entries(STATUS).map(([v, l]) => el('option', { value: v, selected: v === o.status }, l)));
    const when = o.createdAt ? o.createdAt.toDate().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    const intl = String(o.phone || '').replace(/\D/g, '').replace(/^0/, '254');
    const waLink = intl ? el('a', { href: `https://wa.me/${intl}?text=${encodeURIComponent(`Hi ${o.name || ''}, this is Nainezz about your order #${no}.`)}`, target: '_blank', rel: 'noopener' }, 'WhatsApp') : '';
    return el('tr', { class: o.status === 'cancelled' || o.status === 'payment_failed' ? 'dim' : '' },
      el('td', {}, el('b', { text: '#' + no }), el('small', { text: when })),
      el('td', {}, o.name || '—', el('small', {}, intl ? '0' + intl.slice(3) + ' · ' : '', waLink), el('small', { text: o.area || '' }), o.notes ? el('small', { text: '“' + o.notes + '”' }) : ''),
      el('td', {}, (o.items || []).map(i => el('div', { text: `${i.qty} × ${i.name}${i.variant ? ' (' + i.variant + ')' : ''}` }))),
      el('td', { class: 'r' }, el('b', { text: ksh(o.total) })),
      el('td', {}, o.pay === 'mpesa' ? 'M-Pesa' : 'On delivery', el('small', { text: o.mpesaReceipt || o.paymentError || '' })),
      el('td', {}, el('span', { class: 'st ' + o.status, text: STATUS[o.status] || o.status }), el('div', {}, sel))
    );
  }));
  $('#noOrders').hidden = list.length > 0;
}

/**
 * Changes an order's status and keeps stock right: items come off stock when an order becomes
 * Paid or Delivered, and go back if it's Cancelled. The stockDeducted flag stops it happening twice.
 */
const SOLD = ['paid', 'delivered'];
async function setStatus(o, status) {
  await F.runTransaction(db, async t => {
    const cur = (await t.get(o.ref)).data();
    const sell = SOLD.includes(status) && !cur.stockDeducted;
    const restore = status === 'cancelled' && cur.stockDeducted;
    const upd = { status, updatedAt: F.serverTimestamp() };
    if (sell || restore) {
      const qty = {};
      for (const it of cur.items || []) if (/^[a-z0-9-]{1,80}$/.test(it.slug || '')) qty[it.slug] = (qty[it.slug] || 0) + (Number(it.qty) || 0);
      const refs = Object.keys(qty).map(s => F.doc(db, 'products', s));
      const snaps = [];
      for (const r of refs) snaps.push(await t.get(r));
      snaps.forEach((s, i) => {
        const stock = s.exists() ? s.data().stock : null;
        if (typeof stock !== 'number') return; // not tracked
        t.update(refs[i], { stock: Math.max(0, stock + qty[refs[i].id] * (sell ? -1 : 1)), updatedAt: F.serverTimestamp() });
      });
      upd.stockDeducted = sell;
    }
    t.update(o.ref, upd);
  });
}

/* ---------------- products ---------------- */
let products = [];
function watchProducts() {
  unsub.push(F.onSnapshot(F.collection(db, 'products'), s => {
    products = s.docs.map(d => ({ slug: d.id, ...d.data() }))
      .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || String(a.name).localeCompare(b.name));
    renderProducts();
    $('#importBtn').hidden = products.length > 0;
    $('#brandList').replaceChildren(...[...new Set(products.map(p => p.brand).filter(Boolean))].map(b => el('option', { value: b })));
  }, e => toast('Could not load products: ' + e.code)));
  $('#pq').oninput = renderProducts;
  $('#addProduct').onclick = () => openEditor(null);
  setupImport();
  setupEditor();
}
function renderProducts() {
  const words = $('#pq').value.toLowerCase().split(/\s+/).filter(Boolean);
  const list = products.filter(p => words.every(w => `${p.name} ${p.brand} ${p.cat}`.toLowerCase().includes(w)));
  $('#products tbody').replaceChildren(...list.map(p => {
    const v = (p.variants || [])[0] || {};
    const stock = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', value: typeof p.stock === 'number' ? p.stock : '', placeholder: '—', 'aria-label': `Stock of ${p.name}`,
      onchange: async e => {
        const raw = e.target.value.trim();
        const val = raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0);
        try { await F.updateDoc(F.doc(db, 'products', p.slug), { stock: val, updatedAt: F.serverTimestamp() }); toast(`${p.name}: stock ${val ?? 'not tracked'}`); }
        catch (ex) { toast('Not saved: ' + ex.code); }
      } });
    const active = el('input', { type: 'checkbox', checked: p.active !== false, 'aria-label': `${p.name} on sale`,
      onchange: async e => {
        try { await F.updateDoc(F.doc(db, 'products', p.slug), { active: e.target.checked, updatedAt: F.serverTimestamp() }); toast(`${p.name} ${e.target.checked ? 'is on sale' : 'hidden from the website'}`); }
        catch (ex) { toast('Not saved: ' + ex.code); e.target.checked = !e.target.checked; }
      } });
    const out = typeof p.stock === 'number' && p.stock <= 0;
    return el('tr', { class: p.active === false ? 'dim' : '' },
      el('td', {}, el('b', { text: p.name }), el('small', { text: p.brand || '' })),
      el('td', { text: (CATS.find(c => c[0] === p.cat) || [, p.cat])[1] }),
      el('td', { class: 'r' }, ksh(v.price), (p.variants || []).length > 1 ? el('small', { text: `${p.variants.length} options` }) : ''),
      el('td', {}, stock, out ? el('small', { class: 'st cancelled', text: 'Sold out' }) : ''),
      el('td', {}, active),
      el('td', {}, el('button', { type: 'button', class: 'btn sm ghostd', onclick: () => openEditor(p) }, 'Edit'))
    );
  }));
  $('#noProducts').hidden = products.length > 0;
}

/* ---------------- import from products.json ---------------- */
function setupImport() {
  const btn = $('#importBtn');
  let armed = false, t;
  btn.onclick = async () => {
    if (products.length) { toast('Products are already in Firebase — edit them here instead of importing again.'); return; }
    if (!armed) {
      armed = true; btn.textContent = products.length ? 'Tap again: overwrite matching products' : 'Tap again to import';
      t = setTimeout(() => { armed = false; btn.textContent = 'Import from products.json'; }, 5000);
      return;
    }
    clearTimeout(t); armed = false; btn.disabled = true; btn.textContent = 'Importing…';
    try {
      const data = await (await fetch('data/products.json', { cache: 'no-store' })).json();
      const batch = F.writeBatch(db);
      data.products.forEach((p, i) => {
        batch.set(F.doc(db, 'products', p.slug), {
          name: p.name, brand: p.brand, cat: p.cat, art: p.art || 'phone', color: p.color || '#9fb7d6', badge: p.badge || null,
          picks: p.picks || [], desc: p.desc || '', specs: p.specs || {}, image: p.image || null,
          variants: p.variants.map(v => ({ label: String(v[0]), price: Number(v[1]), was: v[2] ? Number(v[2]) : null })),
          stock: null, active: true, order: i, updatedAt: F.serverTimestamp()
        });
      });
      const cur = await F.getDoc(F.doc(db, 'settings', 'site'));
      if (!cur.exists()) batch.set(F.doc(db, 'settings', 'site'), data.site); // never overwrite saved shop details
      await batch.commit();
      toast(`Imported ${data.products.length} products`);
    } catch (e) { toast('Import failed: ' + (e.code || e.message)); }
    btn.disabled = false; btn.textContent = 'Import from products.json';
  };
}

/* ---------------- product editor ---------------- */
let editing = null;
function variantRow(v = {}) {
  return el('div', { class: 'rw' },
    el('input', { 'aria-label': 'Option', placeholder: 'e.g. 256GB', maxlength: '60', value: v.label || '', 'data-k': 'label' }),
    el('input', { 'aria-label': 'Price (KSh)', placeholder: 'Price', type: 'number', min: '1', inputmode: 'numeric', value: v.price ?? '', 'data-k': 'price' }),
    el('input', { 'aria-label': 'Old price (KSh)', placeholder: 'Old price', type: 'number', min: '0', inputmode: 'numeric', value: v.was ?? '', 'data-k': 'was' }),
    el('button', { type: 'button', class: 'rmrow', 'aria-label': 'Remove option', onclick: e => e.currentTarget.parentElement.remove() }, '×'));
}
function specRow(k = '', v = '') {
  return el('div', { class: 'rw spec' },
    el('input', { 'aria-label': 'Specification', placeholder: 'e.g. Battery', maxlength: '40', value: k, 'data-k': 'k' }),
    el('input', { 'aria-label': 'Value', placeholder: 'e.g. 5000mAh', maxlength: '120', value: v, 'data-k': 'v' }),
    el('button', { type: 'button', class: 'rmrow', 'aria-label': 'Remove specification', onclick: e => e.currentTarget.parentElement.remove() }, '×'));
}
function setThumb(url) {
  const th = $('#thumb'); th.replaceChildren();
  if (url) th.append(el('img', { src: url, alt: '' }));
  else th.append(el('span', { class: 'fine', text: 'No photo' }));
}
function openEditor(p) {
  editing = p;
  const f = $('#edForm'), E = f.elements;
  $('#edTitle').textContent = p ? 'Edit product' : 'Add product';
  E.name.value = p?.name || ''; E.slug.value = p?.slug || ''; E.slug.readOnly = !!p;
  E.brand.value = p?.brand || ''; E.cat.value = p?.cat || 'smartphones'; E.badge.value = p?.badge || '';
  E.stock.value = typeof p?.stock === 'number' ? p.stock : ''; E.active.checked = p ? p.active !== false : true;
  E.desc.value = p?.desc || ''; E.art.value = p?.art || 'phone'; E.color.value = /^#[0-9a-f]{6}$/i.test(p?.color || '') ? p.color : '#9fb7d6';
  E.image.value = p?.image || ''; setThumb(p?.image || '');
  $$('input[name=picks]', f).forEach(c => { c.checked = (p?.picks || []).includes(c.value); });
  $('#variants').replaceChildren(...((p?.variants?.length ? p.variants : [{}]).map(variantRow)));
  $('#specs').replaceChildren(...Object.entries(p?.specs || {}).map(([k, v]) => specRow(k, v)));
  $('#edErr').hidden = true; $('#edDelete').hidden = !p; $('#edDelete').textContent = 'Delete';
  $('#editor').showModal();
}
function setupEditor() {
  const f = $('#edForm'), E = f.elements, dlg = $('#editor');
  $('#catSel').replaceChildren(...CATS.map(([v, l]) => el('option', { value: v }, l)));
  E.name.addEventListener('input', () => { if (!editing && !E.slug.dataset.touched) E.slug.value = slugify(E.name.value); });
  E.slug.addEventListener('input', () => { E.slug.dataset.touched = '1'; });
  $('#addVariant').onclick = () => $('#variants').append(variantRow());
  $('#addSpec').onclick = () => $('#specs').append(specRow());
  $('#edClose').onclick = $('#edCancel').onclick = () => dlg.close();
  $('#rmPhoto').onclick = () => { E.image.value = ''; setThumb(''); };
  E.image.addEventListener('change', () => setThumb(PHOTO.test(E.image.value.trim()) ? E.image.value.trim() : ''));
  $('#photo').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 3 * 1024 * 1024) { toast('Use a JPG, PNG or WebP under 3 MB'); return; }
    const slug = slugify(E.slug.value || E.name.value) || 'product';
    try {
      toast('Uploading photo…');
      const { m: S, st } = await getStorage();
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
      const r = S.ref(st, `products/${slug}/${Date.now()}.${ext}`);
      await S.uploadBytes(r, file, { contentType: file.type, cacheControl: 'public,max-age=31536000' });
      E.image.value = await S.getDownloadURL(r); setThumb(E.image.value); toast('Photo uploaded — save the product to keep it');
    } catch (ex) { toast('Upload needs Firebase Storage. Put the photo in the images folder on GitHub and type its name instead.'); }
  };
  let delArmed = false;
  $('#edDelete').onclick = async () => {
    if (!editing) return;
    if (!delArmed) { delArmed = true; $('#edDelete').textContent = 'Tap again to delete'; setTimeout(() => { delArmed = false; $('#edDelete').textContent = 'Delete'; }, 4000); return; }
    try { await F.deleteDoc(F.doc(db, 'products', editing.slug)); toast(`${editing.name} deleted`); dlg.close(); }
    catch (ex) { toast('Not deleted: ' + ex.code); }
  };
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#edErr'); err.hidden = true;
    const fail = m => { err.textContent = m; err.hidden = false; };
    const slug = E.slug.value.trim();
    if (!E.name.value.trim()) return fail('Add a product name.');
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) return fail('Page address can only use small letters, numbers and dashes.');
    if (!editing && products.some(p => p.slug === slug)) return fail('A product with that page address already exists.');
    const variants = $$('#variants .rw').map(r => {
      const g = k => $(`[data-k=${k}]`, r).value.trim();
      return { label: g('label') || 'Standard', price: parseInt(g('price'), 10) || 0, was: parseInt(g('was'), 10) || null };
    }).filter(v => v.price > 0).map(v => ({ ...v, was: v.was && v.was > v.price ? v.was : null }));
    if (!variants.length) return fail('Add at least one option with a price.');
    const specs = {};
    $$('#specs .rw').forEach(r => { const k = $('[data-k=k]', r).value.trim(), v = $('[data-k=v]', r).value.trim(); if (k && v) specs[k] = v; });
    const stockRaw = E.stock.value.trim();
    const data = {
      name: E.name.value.trim(), brand: E.brand.value.trim() || 'Other', cat: E.cat.value, badge: E.badge.value || null,
      stock: stockRaw === '' ? null : Math.max(0, parseInt(stockRaw, 10) || 0), active: E.active.checked,
      desc: E.desc.value.trim(), art: E.art.value, color: E.color.value,
      image: PHOTO.test(E.image.value.trim()) ? E.image.value.trim() : null,
      picks: $$('input[name=picks]:checked', f).map(c => c.value), variants, specs,
      order: editing?.order ?? products.length, updatedAt: F.serverTimestamp()
    };
    $('#edSave').disabled = true;
    try { await F.setDoc(F.doc(db, 'products', slug), data); toast(`${data.name} saved`); dlg.close(); delete E.slug.dataset.touched; }
    catch (ex) { fail('Not saved: ' + (ex.code || ex.message)); }
    $('#edSave').disabled = false;
  });
}

/* ---------------- shop details ---------------- */
async function loadSettings() {
  const f = $('#p-settings');
  try {
    const s = await F.getDoc(F.doc(db, 'settings', 'site'));
    const d = s.exists() ? s.data() : {};
    $$('input', f).forEach(i => { if (typeof d[i.name] === 'string') i.value = d[i.name]; });
  } catch (e) { /* empty is fine */ }
  f.onsubmit = async e => {
    e.preventDefault();
    const err = $('#setErr'); err.hidden = true;
    const data = {};
    $$('input', f).forEach(i => { data[i.name] = i.value.trim(); });
    if (data.wa && !/^254[17]\d{8}$/.test(data.wa)) { err.textContent = 'WhatsApp number must look like 254712345678.'; err.hidden = false; return; }
    if (data.domain && !/^https:\/\/[a-z0-9.-]+$/i.test(data.domain)) { err.textContent = 'Website address must start with https:// and have no trailing slash.'; err.hidden = false; return; }
    try { await F.setDoc(F.doc(db, 'settings', 'site'), data, { merge: true }); toast('Shop details saved'); }
    catch (ex) { err.textContent = 'Not saved: ' + ex.code; err.hidden = false; }
  };
}
