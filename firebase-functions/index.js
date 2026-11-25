/**
 * Nainezz shop backend — Firebase Cloud Functions (2nd gen, Node 20).
 *
 *  createOrder    (callable)  Checks the cart against Firestore prices and stock, saves the order,
 *                             and starts an M-Pesa STK push when the customer chose M-Pesa.
 *  orderStatus    (callable)  Lets the customer's browser follow its own order (needs the order's secret token).
 *  mpesaCallback  (HTTP)      Safaricom calls this when the payment finishes. Confirmed with Safaricom before marking paid.
 *  syncStock      (trigger)   Takes items out of stock when an order becomes paid/delivered; puts them back if cancelled.
 *
 * Secrets (set once):  firebase functions:secrets:set MPESA_CONSUMER_KEY   (and MPESA_CONSUMER_SECRET, MPESA_PASSKEY, MPESA_CALLBACK_KEY)
 * Settings:            functions/.env  (MPESA_ENV, MPESA_SHORTCODE, MPESA_TYPE, MPESA_PARTYB)
 */
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const REGION = 'europe-west1'; // keep in sync with functionsRegion in assets/firebase-config.js
setGlobalOptions({ region: REGION, maxInstances: 5 });

const MPESA_CONSUMER_KEY = defineSecret('MPESA_CONSUMER_KEY');
const MPESA_CONSUMER_SECRET = defineSecret('MPESA_CONSUMER_SECRET');
const MPESA_PASSKEY = defineSecret('MPESA_PASSKEY');
const MPESA_CALLBACK_KEY = defineSecret('MPESA_CALLBACK_KEY');
const MPESA_ENV = defineString('MPESA_ENV', { default: 'sandbox' });          // sandbox | production
const MPESA_SHORTCODE = defineString('MPESA_SHORTCODE', { default: '174379' }); // paybill number, or store number for a till
const MPESA_TYPE = defineString('MPESA_TYPE', { default: 'paybill' });          // paybill | till
const MPESA_PARTYB = defineString('MPESA_PARTYB', { default: '' });             // till number (leave empty for paybill)
const MPESA_SECRETS = [MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_PASSKEY, MPESA_CALLBACK_KEY];

const STATUSES = ['new', 'awaiting_payment', 'paid', 'delivered', 'cancelled', 'payment_failed'];
const SOLD = ['paid', 'delivered'];

/* ---------------- helpers ---------------- */
const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function kenyanPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '254' + d.slice(1);
  else if (d.length === 9) d = '254' + d;
  return /^254[17]\d{8}$/.test(d) ? d : null;
}

/* ---------------- M-Pesa (Daraja) ---------------- */
const darajaBase = () => (MPESA_ENV.value() === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');
function timestamp() { // YYYYMMDDHHmmss in Kenya time
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().replace(/\D/g, '').slice(0, 14);
}
const stkPassword = ts => Buffer.from(MPESA_SHORTCODE.value() + MPESA_PASSKEY.value() + ts).toString('base64');
async function darajaToken() {
  const basic = Buffer.from(`${MPESA_CONSUMER_KEY.value()}:${MPESA_CONSUMER_SECRET.value()}`).toString('base64');
  const r = await fetch(`${darajaBase()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`M-Pesa sign-in failed (${r.status})`);
  return (await r.json()).access_token;
}
async function daraja(path, payload) {
  const token = await darajaToken();
  const r = await fetch(darajaBase() + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.errorMessage || `M-Pesa error ${r.status}`); e.code = j.errorCode; throw e; }
  return j;
}
function callbackUrl() {
  const project = process.env.GCLOUD_PROJECT || JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId;
  return `https://${REGION}-${project}.cloudfunctions.net/mpesaCallback?k=${encodeURIComponent(MPESA_CALLBACK_KEY.value())}`;
}
async function stkPush({ phone, amount, reference }) {
  const ts = timestamp();
  const till = MPESA_TYPE.value() === 'till';
  const j = await daraja('/mpesa/stkpush/v1/processrequest', {
    BusinessShortCode: MPESA_SHORTCODE.value(),
    Password: stkPassword(ts),
    Timestamp: ts,
    TransactionType: till ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: phone,
    PartyB: (till && MPESA_PARTYB.value()) || MPESA_SHORTCODE.value(),
    PhoneNumber: phone,
    CallBackURL: callbackUrl(),
    AccountReference: reference.slice(0, 12),
    TransactionDesc: 'Nainezz order'
  });
  if (String(j.ResponseCode) !== '0') throw new Error(j.ResponseDescription || 'M-Pesa did not accept the request');
  return j;
}
async function stkQuery(checkoutRequestId) {
  const ts = timestamp();
  return daraja('/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: MPESA_SHORTCODE.value(), Password: stkPassword(ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId
  });
}

/**
 * Asks Safaricom for the real result of a payment and updates the order.
 * Never trusts the callback body alone: the status always comes from stkQuery.
 */
async function settlePayment(ref, meta = {}) {
  const snap = await ref.get();
  const o = snap.data();
  if (!o || o.status !== 'awaiting_payment' || !o.checkoutRequestId) return o;
  let q;
  try {
    q = await stkQuery(o.checkoutRequestId);
  } catch (e) {
    // "The transaction is being processed" — the customer hasn't finished yet.
    logger.info('STK query pending', { order: ref.id, msg: e.message });
    await ref.update({ lastCheckedAt: FieldValue.serverTimestamp() });
    return o;
  }
  const code = String(q.ResultCode);
  if (code === '0') {
    if (meta.amount != null && Number(meta.amount) !== Number(o.total)) {
      logger.error('Amount mismatch', { order: ref.id, paid: meta.amount, total: o.total });
      await ref.update({ status: 'payment_failed', paymentError: `Amount paid (${meta.amount}) does not match order total`, updatedAt: FieldValue.serverTimestamp() });
      return { ...o, status: 'payment_failed' };
    }
    const upd = { status: 'paid', paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
    if (meta.receipt) upd.mpesaReceipt = text(meta.receipt, 20);
    if (meta.phone) upd.mpesaPhone = text(meta.phone, 15);
    await ref.update(upd);
    return { ...o, ...upd, status: 'paid' };
  }
  if (code && code !== 'undefined') {
    const reason = text(q.ResultDesc, 120);
    await ref.update({ status: 'payment_failed', paymentError: reason, updatedAt: FieldValue.serverTimestamp() });
    return { ...o, status: 'payment_failed', paymentError: reason };
  }
  return o;
}

/* ---------------- createOrder ---------------- */
exports.createOrder = onCall({ secrets: MPESA_SECRETS }, async req => {
  const d = req.data || {};
  const pay = d.pay === 'mpesa' ? 'mpesa' : 'whatsapp';
  const items = Array.isArray(d.items) ? d.items : [];
  if (!items.length || items.length > 20) throw new HttpsError('invalid-argument', 'Your cart is empty.');
  const phone = kenyanPhone(d.phone);
  if (pay === 'mpesa' && !phone) throw new HttpsError('invalid-argument', 'Enter a valid M-Pesa number, e.g. 0712 345 678.');
  if (d.phone && !phone) throw new HttpsError('invalid-argument', 'That phone number doesn’t look right. Use a Kenyan number like 0712 345 678.');

  // Simple flood protection: at most 5 orders per phone number in 10 minutes.
  if (phone) {
    const since = Timestamp.fromMillis(Date.now() - 10 * 60 * 1000);
    const recent = await db.collection('orders').where('phone', '==', phone).where('createdAt', '>', since).count().get();
    if (recent.data().count >= 5) throw new HttpsError('resource-exhausted', 'Too many orders from this number just now. Please call or WhatsApp us.');
  }

  // Prices and stock always come from Firestore — never from the browser.
  const wanted = new Map();
  for (const it of items) {
    const slug = String(it && it.slug || '');
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw new HttpsError('invalid-argument', 'Your cart has an item we don’t recognise. Please refresh and try again.');
    const variant = text(it.variant, 60);
    const qty = Math.max(1, Math.min(10, parseInt(it.qty, 10) || 1));
    const key = slug + '|' + variant;
    wanted.set(key, { slug, variant, qty: Math.min(10, (wanted.get(key)?.qty || 0) + qty), label: text(it.name, 80) || slug });
  }
  const slugs = [...new Set([...wanted.values()].map(w => w.slug))];
  const snaps = await db.getAll(...slugs.map(s => db.collection('products').doc(s)));
  const products = Object.fromEntries(snaps.map(s => [s.id, s]));
  const perSlug = {};
  const lines = [];
  let total = 0;
  for (const w of wanted.values()) {
    const s = products[w.slug];
    if (!s || !s.exists || s.get('active') === false) throw new HttpsError('failed-precondition', `${w.label} is no longer available. Please remove it from your cart.`);
    const p = s.data();
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const v = variants.find(x => String(x.label) === w.variant) || (variants.length === 1 ? variants[0] : null);
    if (!v || !(Number(v.price) > 0)) throw new HttpsError('failed-precondition', `The option you chose for ${p.name} has changed. Please add it again.`);
    perSlug[w.slug] = (perSlug[w.slug] || 0) + w.qty;
    if (typeof p.stock === 'number' && p.stock < perSlug[w.slug]) {
      throw new HttpsError('failed-precondition', p.stock > 0 ? `Only ${p.stock} ${p.name} left in stock.` : `${p.name} is out of stock.`);
    }
    const price = Math.round(Number(v.price));
    lines.push({ slug: w.slug, name: text(p.name, 120), variant: text(v.label, 60), price, qty: w.qty, lineTotal: price * w.qty });
    total += price * w.qty;
  }

  const token = crypto.randomBytes(24).toString('hex');
  const ref = db.collection('orders').doc();
  const status = pay === 'mpesa' ? 'awaiting_payment' : 'new';
  const number = await db.runTransaction(async t => {
    const counter = db.doc('counters/orders');
    const c = await t.get(counter);
    const n = c.exists ? c.get('next') : 1001;
    t.set(counter, { next: n + 1 });
    t.set(ref, {
      number: n, tokenHash: sha(token), items: lines, total, pay, status,
      name: text(d.name, 60), phone: phone || '', area: text(d.area, 100), notes: text(d.notes, 300),
      stockDeducted: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    });
    return n;
  });

  if (pay === 'mpesa') {
    try {
      const r = await stkPush({ phone, amount: total, reference: `NZ${number}` });
      await ref.update({ checkoutRequestId: r.CheckoutRequestID, merchantRequestId: r.MerchantRequestID });
    } catch (e) {
      logger.error('STK push failed', { order: ref.id, msg: e.message });
      await ref.update({ status: 'payment_failed', paymentError: text(e.message, 200), updatedAt: FieldValue.serverTimestamp() });
      throw new HttpsError('unavailable', 'We couldn’t start the M-Pesa payment right now.');
    }
  }
  return { id: ref.id, number, token, total, status };
});

/* ---------------- orderStatus ---------------- */
exports.orderStatus = onCall({ secrets: MPESA_SECRETS }, async req => {
  const id = String(req.data && req.data.id || ''), token = String(req.data && req.data.token || '');
  if (!/^[A-Za-z0-9]{10,40}$/.test(id) || !/^[a-f0-9]{48}$/.test(token)) throw new HttpsError('invalid-argument', 'Unknown order.');
  const ref = db.collection('orders').doc(id);
  let o = (await ref.get()).data();
  if (!o || !safeEqual(o.tokenHash, sha(token))) throw new HttpsError('not-found', 'Unknown order.');
  // If Safaricom's callback is slow or lost, check directly (at most every 10 seconds, after the first 20).
  const age = Date.now() - (o.createdAt ? o.createdAt.toMillis() : Date.now());
  const last = o.lastCheckedAt ? o.lastCheckedAt.toMillis() : 0;
  if (o.status === 'awaiting_payment' && age > 20000 && Date.now() - last > 10000) o = await settlePayment(ref);
  return { status: o.status, number: o.number, total: o.total, receipt: o.mpesaReceipt || '', reason: o.status === 'payment_failed' ? (o.paymentError || '') : '' };
});

/* ---------------- mpesaCallback ---------------- */
exports.mpesaCallback = onRequest({ secrets: MPESA_SECRETS }, async (req, res) => {
  const ACK = { ResultCode: 0, ResultDesc: 'Accepted' };
  if (req.method !== 'POST' || typeof req.query.k !== 'string' || !safeEqual(req.query.k, MPESA_CALLBACK_KEY.value())) {
    res.status(403).send('Forbidden');
    return;
  }
  try {
    const cb = req.body && req.body.Body && req.body.Body.stkCallback;
    const id = cb && typeof cb.CheckoutRequestID === 'string' ? cb.CheckoutRequestID.slice(0, 80) : '';
    if (!id) { res.json(ACK); return; }
    const q = await db.collection('orders').where('checkoutRequestId', '==', id).limit(1).get();
    if (q.empty) { res.json(ACK); return; }
    const meta = {};
    const items = (cb.CallbackMetadata && Array.isArray(cb.CallbackMetadata.Item)) ? cb.CallbackMetadata.Item : [];
    for (const it of items) {
      if (it.Name === 'Amount') meta.amount = it.Value;
      if (it.Name === 'MpesaReceiptNumber') meta.receipt = it.Value;
      if (it.Name === 'PhoneNumber') meta.phone = it.Value;
    }
    const o = await settlePayment(q.docs[0].ref, meta);
    // Paid already (found by orderStatus before this callback came): just record the receipt.
    if (o && o.status === 'paid' && !o.mpesaReceipt && meta.receipt) {
      await q.docs[0].ref.update({ mpesaReceipt: text(meta.receipt, 20) });
    }
  } catch (e) {
    logger.error('Callback error', e);
  }
  res.json(ACK);
});

/* ---------------- syncStock ---------------- */
exports.syncStock = onDocumentUpdated('orders/{id}', async event => {
  const after = event.data.after.data();
  if (!after || !STATUSES.includes(after.status)) return;
  const sell = SOLD.includes(after.status) && !after.stockDeducted;
  const restore = after.status === 'cancelled' && after.stockDeducted;
  if (!sell && !restore) return;
  const ref = event.data.after.ref;
  await db.runTransaction(async t => {
    const o = (await t.get(ref)).data();
    if (sell && o.stockDeducted) return;
    if (restore && !o.stockDeducted) return;
    const qty = {};
    for (const it of o.items || []) qty[it.slug] = (qty[it.slug] || 0) + (Number(it.qty) || 0);
    const refs = Object.keys(qty).map(s => db.collection('products').doc(s));
    const snaps = await Promise.all(refs.map(r => t.get(r)));
    snaps.forEach((s, i) => {
      const stock = s.exists ? s.get('stock') : null;
      if (typeof stock !== 'number') return; // stock not tracked for this product
      const change = qty[refs[i].id] * (sell ? -1 : 1);
      t.update(refs[i], { stock: Math.max(0, stock + change) });
    });
    t.update(ref, { stockDeducted: sell });
  });
});
