// Confirms an M-Pesa payment with Safaricom and updates the order — and the stock — in one atomic write.
// The status always comes from Safaricom's STK query, never from the callback body alone.
import { stkQuery } from './mpesa.js';
import { text } from './util.js';

export async function settle(env, store, orderId, meta = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const o = await store.get('orders', orderId);
    if (!o) return null;
    const d = o.data;
    if (d.status !== 'awaiting_payment' || !d.checkoutRequestId) {
      // Already settled (e.g. by the status check) — just keep the receipt if the callback brings it.
      if (d.status === 'paid' && !d.mpesaReceipt && meta.receipt) {
        await store.commit([store.write('orders', orderId, { mpesaReceipt: text(meta.receipt, 20) })]);
        d.mpesaReceipt = text(meta.receipt, 20);
      }
      return d;
    }

    let q;
    try {
      q = await stkQuery(env, d.checkoutRequestId);
    } catch (e) {
      // "The transaction is being processed" — the customer hasn't finished yet.
      await store.commit([store.write('orders', orderId, {}, { stamp: ['lastCheckedAt'] })]);
      return d;
    }
    const code = q.ResultCode == null ? '' : String(q.ResultCode);
    if (code === '') return d;

    if (code !== '0') {
      const reason = text(q.ResultDesc, 120);
      await store.commit([store.write('orders', orderId, { status: 'payment_failed', paymentError: reason }, { updateTime: o.updateTime, stamp: ['updatedAt'] })]);
      return { ...d, status: 'payment_failed', paymentError: reason };
    }
    if (meta.amount != null && Number(meta.amount) !== Number(d.total)) {
      const reason = `Amount paid (${Number(meta.amount)}) does not match the order total`;
      await store.commit([store.write('orders', orderId, { status: 'payment_failed', paymentError: reason }, { updateTime: o.updateTime, stamp: ['updatedAt'] })]);
      return { ...d, status: 'payment_failed', paymentError: reason };
    }

    // Paid: mark the order and take the items off stock, all in one commit.
    const qty = {};
    for (const it of d.items || []) if (/^[a-z0-9-]{1,80}$/.test(it.slug || '')) qty[it.slug] = (qty[it.slug] || 0) + (Number(it.qty) || 0);
    const products = await store.getMany('products', Object.keys(qty));
    const writes = [];
    for (const p of products) {
      if (typeof p.data.stock !== 'number') continue; // stock not tracked
      writes.push(store.write('products', p.id, { stock: Math.max(0, p.data.stock - qty[p.id]) }, { updateTime: p.updateTime, stamp: ['updatedAt'] }));
    }
    const upd = { status: 'paid', stockDeducted: true };
    if (meta.receipt) upd.mpesaReceipt = text(meta.receipt, 20);
    if (meta.phone) upd.mpesaPhone = text(meta.phone, 15);
    writes.push(store.write('orders', orderId, upd, { updateTime: o.updateTime, stamp: ['paidAt', 'updatedAt'] }));
    try {
      await store.commit(writes);
      return { ...d, ...upd };
    } catch (e) {
      // Something changed at the same moment (stock edited, callback and status check together) — read again and retry.
      if (attempt === 2) throw e;
    }
  }
  return null;
}
