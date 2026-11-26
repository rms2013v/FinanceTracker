// Sign in with a passkey (Touch ID / iCloud Keychain on a Mac).
// The site has no server, so the passkey can't just "log you in": it has to unlock your encrypted data.
// It does that with the passkey's PRF extension, a secret that only the passkey can produce after Touch ID.
// That secret encrypts your password here in the browser. Signing in with the passkey decrypts the password
// and opens your data with it. Without the passkey (and your fingerprint) the stored copy is unreadable.
const STORE = 'finance-dashboard-passkey';
const te = new TextEncoder(), td = new TextDecoder();
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const supported = () => !!(window.PublicKeyCredential && navigator.credentials?.create);
export function saved() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } }
export function forget() { try { localStorage.removeItem(STORE); } catch { /* storage blocked */ } }

async function wrapKey(prf) {
  const base = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode('finance-dashboard passkey v1')},
    base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}
async function prfFrom(credId, salt) {
  const a = await navigator.credentials.get({publicKey: {challenge: rand(32), rpId: location.hostname, timeout: 60000,
    allowCredentials: credId ? [{type: 'public-key', id: credId}] : [], userVerification: 'required',
    extensions: {prf: {eval: {first: salt}}}}});
  const out = a.getClientExtensionResults().prf?.results?.first;
  if (!out) throw new Error('no-prf');
  return {prf: new Uint8Array(out), id: new Uint8Array(a.rawId)};
}

// Creates a passkey for this site and stores the password, encrypted with the passkey's secret.
export async function setup(password, username) {
  const salt = rand(32);
  const c = await navigator.credentials.create({publicKey: {challenge: rand(32), timeout: 60000,
    rp: {name: 'Finance dashboard', id: location.hostname},
    user: {id: rand(16), name: username, displayName: username},
    pubKeyCredParams: [{type: 'public-key', alg: -7}, {type: 'public-key', alg: -257}],
    authenticatorSelection: {residentKey: 'required', userVerification: 'required'},
    extensions: {prf: {eval: {first: salt}}}}});
  const ext = c.getClientExtensionResults().prf;
  if (!ext || ext.enabled === false) throw new Error('no-prf');
  // Some browsers give the secret when the passkey is made; others need a second Touch ID to read it.
  const prf = ext.results?.first ? new Uint8Array(ext.results.first) : (await prfFrom(new Uint8Array(c.rawId), salt)).prf;
  const key = await wrapKey(prf), iv = rand(12);
  const ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, te.encode(password));
  localStorage.setItem(STORE, JSON.stringify({id: b64(c.rawId), salt: b64(salt), iv: b64(iv), ct: b64(ct), at: new Date().toISOString()}));
}

// Asks for Touch ID and returns the password the passkey protects.
export async function password() {
  const s = saved(); if (!s) throw new Error('no-passkey');
  const {prf} = await prfFrom(unb64(s.id), unb64(s.salt));
  const pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(s.iv)}, await wrapKey(prf), unb64(s.ct));
  return td.decode(pt);
}

export function explain(e) {
  if (e?.message === 'no-prf') return 'This browser’s passkeys can’t unlock encrypted data. Use Safari 18 or newer, or Chrome, with iCloud Keychain passkeys.';
  if (e?.name === 'NotAllowedError') return 'The passkey request was cancelled or timed out.';
  if (e?.name === 'InvalidStateError') return 'A passkey for this site already exists on this device. Try signing in with it, or remove it in System Settings → Passwords.';
  if (e?.name === 'OperationError') return 'The passkey couldn’t unlock your data. Sign in with your password and set the passkey up again.';
  return 'Passkey didn’t work: ' + (e?.message || e);
}
