// POST /api/mpesa-callback?k=SECRET — Safaricom calls this when a payment finishes.
// The secret key in the address keeps strangers out, and settle() confirms every payment with Safaricom.
import { json, safeEqual } from '../../lib/util.js';
import { firestore } from '../../lib/firestore.js';
import { mpesaReady } from '../../lib/mpesa.js';
import { settle } from '../../lib/settle.js';

const ACK = { ResultCode: 0, ResultDesc: 'Accepted' };

export async function onRequestPost({ request, env }) {
  const k = new URL(request.url).searchParams.get('k') || '';
  if (!mpesaReady(env) || !safeEqual(k, env.MPESA_CALLBACK_KEY)) return new Response('Forbidden', { status: 403 });
  try {
    const body = await request.json();
    const cb = body && body.Body && body.Body.stkCallback;
    const checkoutId = cb && typeof cb.CheckoutRequestID === 'string' ? cb.CheckoutRequestID.slice(0, 80) : '';
    if (!checkoutId) return json(ACK);
    const store = firestore(env);
    const [order] = await store.where('orders', 'checkoutRequestId', checkoutId, 1);
    if (!order) return json(ACK);
    const meta = {};
    const items = cb.CallbackMetadata && Array.isArray(cb.CallbackMetadata.Item) ? cb.CallbackMetadata.Item : [];
    for (const it of items) {
      if (it.Name === 'Amount') meta.amount = it.Value;
      if (it.Name === 'MpesaReceiptNumber') meta.receipt = it.Value;
      if (it.Name === 'PhoneNumber') meta.phone = it.Value;
    }
    await settle(env, store, order.id, meta);
  } catch (e) {
    console.error('callback error', e && e.stack || e);
  }
  return json(ACK);
}
