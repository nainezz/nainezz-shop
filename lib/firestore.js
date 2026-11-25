// Firestore over its REST API, signed in with a Firebase service account (works on the free Spark plan).
// The service account JSON lives in the Cloudflare secret FIREBASE_SERVICE_ACCOUNT — never in the code.

export function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: encFields(v) } };
}
export const encFields = o => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)]));
export function dec(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  return null;
}
export const decFields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, dec(v)]));

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = s => b64url(new TextEncoder().encode(s));
function pemToDer(pem) {
  const body = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), c => c.charCodeAt(0)).buffer;
}

let cached = { token: '', exp: 0, who: '' };
async function accessToken(sa) {
  if (cached.token && cached.who === sa.client_email && cached.exp > Date.now() + 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64urlText(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + b64url(sig) })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Firebase sign-in failed: ' + (j.error_description || j.error || r.status));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000, who: sa.client_email };
  return cached.token;
}

export function firestore(env) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const root = `projects/${sa.project_id}/databases/(default)/documents`;
  const base = `https://firestore.googleapis.com/v1/${root}`;
  async function call(path, body) {
    const token = await accessToken(sa);
    const r = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((j.error && j.error.message) || 'Firestore error ' + r.status); e.status = r.status; throw e; }
    return j;
  }
  const docOut = d => ({ id: d.name.split('/').pop(), data: decFields(d.fields || {}), updateTime: d.updateTime });
  return {
    async get(col, id) {
      try { return docOut(await call(`/${col}/${encodeURIComponent(id)}`)); } catch (e) { if (e.status === 404) return null; throw e; }
    },
    async getMany(col, ids) {
      if (!ids.length) return [];
      const res = await call(':batchGet', { documents: ids.map(i => `${root}/${col}/${i}`) });
      return res.filter(x => x.found).map(x => docOut(x.found));
    },
    async where(col, field, value, limit = 50) {
      const res = await call(':runQuery', { structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: enc(value) } }, limit } });
      return res.filter(x => x.document).map(x => docOut(x.document));
    },
    // One write for commit(): create (fails if it exists) or update the listed fields (fails if missing / changed since updateTime).
    write(col, id, fields, { create = false, updateTime, stamp = [] } = {}) {
      const w = { update: { name: `${root}/${col}/${id}`, fields: encFields(fields) } };
      if (create) w.currentDocument = { exists: false };
      else { w.updateMask = { fieldPaths: Object.keys(fields) }; w.currentDocument = updateTime ? { updateTime } : { exists: true }; }
      if (stamp.length) w.updateTransforms = stamp.map(f => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' }));
      return w;
    },
    commit(writes) { return call(':commit', { writes }); } // all-or-nothing
  };
}
