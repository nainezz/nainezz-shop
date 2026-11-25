// POST /api/order-status — the cart page follows its own order. Needs the order's secret token.
import { json, sha256, safeEqual, readJson, sameOrigin } from '../../lib/util.js';
import { firestore } from '../../lib/firestore.js';
import { mpesaReady } from '../../lib/mpesa.js';
import { settle } from '../../lib/settle.js';

export async function onRequestPost({ request, env }) {
  try {
    if (!sameOrigin(request)) return json({ error: 'Forbidden' }, 403);
    if (!mpesaReady(env)) return json({ error: 'Not available' }, 503);
    const d = await readJson(request, 500);
    const id = String(d && d.id || ''), token = String(d && d.token || '');
    if (!/^[a-f0-9]{20}$/.test(id) || !/^[a-f0-9]{48}$/.test(token)) return json({ error: 'Unknown order' }, 404);
    const store = firestore(env);
    const o = await store.get('orders', id);
    if (!o || !safeEqual(o.data.tokenHash, await sha256(token))) return json({ error: 'Unknown order' }, 404);
    let data = o.data;
    // If Safaricom's callback is slow or lost, ask Safaricom directly (after 20 s, at most every 10 s).
    const age = Date.now() - Date.parse(data.createdAt || Date.now());
    const last = data.lastCheckedAt ? Date.parse(data.lastCheckedAt) : 0;
    if (data.status === 'awaiting_payment' && age > 20000 && Date.now() - last > 10000) {
      data = (await settle(env, store, id)) || data;
    }
    return json({
      status: data.status, ref: data.ref, total: data.total, receipt: data.mpesaReceipt || '',
      reason: data.status === 'payment_failed' ? (data.paymentError || '') : ''
    });
  } catch (e) {
    console.error('status error', e && e.stack || e);
    return json({ status: 'awaiting_payment' });
  }
}
