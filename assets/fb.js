// Loads Firebase only when assets/firebase-config.js is filled in.
import cfg from './firebase-config.js';

const VERSION = '10.14.1';
const CDN = `https://www.gstatic.com/firebasejs/${VERSION}/`;
const { functionsRegion = 'europe-west1', ...config } = cfg || {};

export const ready = typeof config.apiKey === 'string' && config.apiKey.length > 20 && !/PASTE/.test(config.apiKey)
  && /^[a-z0-9-]+$/.test(config.projectId || '') && config.projectId !== 'your-project-id';

let appP;
function app() {
  if (!appP) appP = import(CDN + 'firebase-app.js').then(m => m.initializeApp(config));
  return appP;
}
export async function firestore() {
  const m = await import(CDN + 'firebase-firestore.js');
  return { m, db: m.getFirestore(await app()) };
}
export async function functions() {
  const m = await import(CDN + 'firebase-functions.js');
  return { m, fns: m.getFunctions(await app(), functionsRegion) };
}
export async function auth() {
  const m = await import(CDN + 'firebase-auth.js');
  return { m, auth: m.getAuth(await app()) };
}
export async function storage() {
  const m = await import(CDN + 'firebase-storage.js');
  return { m, st: m.getStorage(await app()) };
}
