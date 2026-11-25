// GET /api/health — tells the cart page whether M-Pesa is switched on.
import { json } from '../../lib/util.js';
import { mpesaReady } from '../../lib/mpesa.js';

// Customers only see M-Pesa once it's live (MPESA_ENV=production). To test the sandbox yourself,
// open the cart as  /cart.html#mpesa-test
export function onRequestGet({ env, request }) {
  const live = env.MPESA_ENV === 'production';
  const test = new URL(request.url).searchParams.get('test') === '1';
  return json({ mpesa: mpesaReady(env) && (live || test), env: live ? 'production' : 'sandbox' });
}
