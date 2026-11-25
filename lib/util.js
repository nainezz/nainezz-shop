// Small helpers shared by the Cloudflare server code in /functions/api.

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
});

export const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export function kenyanPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '254' + d.slice(1);
  else if (d.length === 9) d = '254' + d;
  return /^254[17]\d{8}$/.test(d) ? d : null;
}

export async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function randomCode(n) { // order codes customers can read out: no 0/O, 1/I
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map(x => abc[x % abc.length]).join('');
}

export async function readJson(request, max = 20000) {
  const t = await request.text();
  if (!t || t.length > max) return null;
  try { const j = JSON.parse(t); return j && typeof j === 'object' ? j : null; } catch (e) { return null; }
}

// Browsers send Origin on POST; only accept calls from the shop's own pages.
export function sameOrigin(request) {
  const o = request.headers.get('origin');
  return !!o && o === new URL(request.url).origin;
}
