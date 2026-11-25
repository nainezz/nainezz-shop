// POST /api/order — saves an M-Pesa order and sends the payment prompt to the customer's phone.
// Prices and stock are read from Firestore here; the prices the browser sends are ignored.
import { json, text, kenyanPhone, sha256, randomHex, randomCode, readJson, sameOrigin } from '../../lib/util.js';
import { firestore } from '../../lib/firestore.js';
import { mpesaReady, stkPush } from '../../lib/mpesa.js';

const fail = (msg, status = 400) => json({ error: msg }, status);

export async function onRequestPost({ request, env }) {
  try {
    if (!sameOrigin(request)) return fail('Forbidden', 403);
    if (!mpesaReady(env)) return fail('M-Pesa payments are not switched on yet. Please choose pay on delivery.', 503);
    const d = await readJson(request);
    if (!d) return fail('Bad request');

    const phone = kenyanPhone(d.phone);
    if (!phone) return fail('Enter a valid M-Pesa number, e.g. 0712 345 678.');
    const items = Array.isArray(d.items) ? d.items : [];
    if (!items.length || items.length > 20) return fail('Your cart is empty.');

    const store = firestore(env);

    // At most 5 orders per phone number in 10 minutes.
    const since = Date.now() - 10 * 60 * 1000;
    const recent = await store.where('orders', 'phone', phone, 50);
    if (recent.filter(o => Date.parse(o.data.createdAt || 0) > since).length >= 5) {
      return fail('Too many orders from this number just now. Please call or WhatsApp us.', 429);
    }

    const wanted = new Map();
    for (const it of items) {
      const slug = String(it && it.slug || '');
      if (!/^[a-z0-9-]{1,80}$/.test(slug)) return fail('Your cart has an item we don’t recognise. Please refresh and try again.');
      const variant = text(it.variant, 60);
      const key = slug + '|' + variant;
      const qty = Math.max(1, Math.min(10, parseInt(it.qty, 10) || 1));
      wanted.set(key, { slug, variant, qty: Math.min(10, ((wanted.get(key) || {}).qty || 0) + qty), label: text(it.name, 80) || slug });
    }
    const found = Object.fromEntries((await store.getMany('products', [...new Set([...wanted.values()].map(w => w.slug))])).map(p => [p.id, p.data]));
    const perSlug = {};
    const lines = [];
    let total = 0;
    for (const w of wanted.values()) {
      const p = found[w.slug];
      if (!p || p.active === false) return fail(`${w.label} is no longer available. Please remove it from your cart.`, 409);
      const variants = Array.isArray(p.variants) ? p.variants : [];
      const v = variants.find(x => String(x.label) === w.variant) || (variants.length === 1 ? variants[0] : null);
      if (!v || !(Number(v.price) > 0)) return fail(`The option you chose for ${p.name} has changed. Please add it again.`, 409);
      perSlug[w.slug] = (perSlug[w.slug] || 0) + w.qty;
      if (typeof p.stock === 'number' && p.stock < perSlug[w.slug]) {
        return fail(p.stock > 0 ? `Only ${p.stock} ${p.name} left in stock.` : `${p.name} is out of stock.`, 409);
      }
      const price = Math.round(Number(v.price));
      lines.push({ slug: w.slug, name: text(p.name, 120), variant: text(v.label, 60), price, qty: w.qty, lineTotal: price * w.qty });
      total += price * w.qty;
    }

    const id = randomHex(10);
    const ref = randomCode(6);
    const token = randomHex(24);
    await store.commit([store.write('orders', id, {
      ref, tokenHash: await sha256(token), items: lines, total, pay: 'mpesa', status: 'awaiting_payment', stockDeducted: false,
      name: text(d.name, 60), phone, area: text(d.area, 100), notes: text(d.notes, 300)
    }, { create: true, stamp: ['createdAt', 'updatedAt'] })]);

    try {
      const origin = new URL(request.url).origin;
      const r = await stkPush(env, {
        phone, amount: total, reference: 'NZ' + ref,
        callbackUrl: `${origin}/api/mpesa-callback?k=${encodeURIComponent(env.MPESA_CALLBACK_KEY)}`
      });
      await store.commit([store.write('orders', id, { checkoutRequestId: String(r.CheckoutRequestID), merchantRequestId: String(r.MerchantRequestID || '') })]);
    } catch (e) {
      console.error('STK push failed', id, e.message);
      await store.commit([store.write('orders', id, { status: 'payment_failed', paymentError: text(e.message, 200) }, { stamp: ['updatedAt'] })]);
      return fail('We couldn’t start the M-Pesa payment right now.', 502);
    }
    return json({ id, ref, token, total });
  } catch (e) {
    console.error('order error', e && e.stack || e);
    return fail('Something went wrong on our side.', 500);
  }
}
