// Encrypted storage in this browser. Your password never leaves the page and is never stored.
// The key is derived with PBKDF2 (SHA-256, 600,000 rounds) and the data is sealed with AES-256-GCM.

const DB = 'finance-dashboard', STORE = 'vault', RECORD = 'main', ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function idbDel(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}
async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, enc.encode(JSON.stringify(obj)));
  return {iv: b64(iv), ct: b64(new Uint8Array(ct))};
}
async function open(key, box) {
  const pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(box.iv)}, key, unb64(box.ct));
  return JSON.parse(dec.decode(pt));
}

export async function exists() { return !!(await idbGet(RECORD)); }

export async function create(password, data) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, ITER);
  const record = {app: 'finance-dashboard', v: 1, salt: b64(salt), iter: ITER, box: await seal(key, data), savedAt: new Date().toISOString()};
  await idbSet(RECORD, record);
  return {key, salt: record.salt, iter: ITER};
}

// Throws 'wrong-password' if the password doesn't open the data.
export async function unlock(password, record) {
  record = record || await idbGet(RECORD);
  if (!record) throw new Error('no-vault');
  const key = await deriveKey(password, unb64(record.salt), record.iter);
  try { return {key, salt: record.salt, iter: record.iter, data: await open(key, record.box)}; }
  catch { throw new Error('wrong-password'); }
}

export async function save(session, data) {
  const record = {app: 'finance-dashboard', v: 1, salt: session.salt, iter: session.iter, box: await seal(session.key, data), savedAt: new Date().toISOString()};
  await idbSet(RECORD, record);
  return record;
}

export async function changePassword(oldPw, newPw) {
  const {data} = await unlock(oldPw);
  return {...(await create(newPw, data)), data};
}

// The backup file holds the same encrypted record: it needs your password to open.
export async function backupText() { return JSON.stringify(await idbGet(RECORD)); }

export async function restore(text, password) {
  let record;
  try { record = JSON.parse(text); } catch { throw new Error('bad-file'); }
  if (!record || record.app !== 'finance-dashboard' || !record.box) throw new Error('bad-file');
  const s = await unlock(password, record);
  await idbSet(RECORD, record);
  return s;
}

export async function wipe() { await idbDel(RECORD); }

export async function localRecord() { return idbGet(RECORD); }
// Opens a record (from this device or online) and keeps it as this device's copy.
export async function adopt(record, password) {
  const s = await unlock(password, record);
  await idbSet(RECORD, record);
  return s;
}
