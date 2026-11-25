// Safaricom Daraja: STK push (payment prompt) and STK query (check the real result).
// Settings come from Cloudflare → nainezz-shop → Settings → Variables and secrets.
import { text } from './util.js';

export const mpesaReady = env => !!(env.MPESA_CONSUMER_KEY && env.MPESA_CONSUMER_SECRET && env.MPESA_PASSKEY
  && env.MPESA_CALLBACK_KEY && env.FIREBASE_SERVICE_ACCOUNT);

const base = env => (env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');
const shortcode = env => String(env.MPESA_SHORTCODE || '174379');
const timestamp = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().replace(/\D/g, '').slice(0, 14); // Kenya time
const password = (env, ts) => btoa(shortcode(env) + env.MPESA_PASSKEY + ts);

async function token(env) {
  const r = await fetch(`${base(env)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { authorization: 'Basic ' + btoa(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`) }
  });
  if (!r.ok) throw new Error(`M-Pesa sign-in failed (${r.status})`);
  return (await r.json()).access_token;
}
async function call(env, path, payload) {
  const t = await token(env);
  const r = await fetch(base(env) + path, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.errorMessage || `M-Pesa error ${r.status}`);
  return j;
}

export async function stkPush(env, { phone, amount, reference, callbackUrl }) {
  const ts = timestamp();
  const till = env.MPESA_TYPE === 'till';
  const j = await call(env, '/mpesa/stkpush/v1/processrequest', {
    BusinessShortCode: shortcode(env),
    Password: password(env, ts),
    Timestamp: ts,
    TransactionType: till ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: phone,
    PartyB: (till && env.MPESA_PARTYB) || shortcode(env),
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    AccountReference: text(reference, 12),
    TransactionDesc: 'Nainezz order'
  });
  if (String(j.ResponseCode) !== '0') throw new Error(j.ResponseDescription || 'M-Pesa did not accept the request');
  return j;
}

export function stkQuery(env, checkoutRequestId) {
  const ts = timestamp();
  return call(env, '/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: shortcode(env), Password: password(env, ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId
  });
}
