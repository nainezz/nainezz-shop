// GET /api/health — tells the cart page whether M-Pesa is switched on.
import { json } from '../../lib/util.js';
import { mpesaReady } from '../../lib/mpesa.js';

export function onRequestGet({ env }) {
  return json({ mpesa: mpesaReady(env), env: env.MPESA_ENV === 'production' ? 'production' : 'sandbox' });
}
