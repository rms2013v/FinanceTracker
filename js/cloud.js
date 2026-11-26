// Sync: the encrypted data record is kept on the "data" branch of the GitHub repo, so any device can sign in.
// Reading needs no login (the file is public but encrypted). Saving needs a GitHub token, kept inside your encrypted data.
// The "data" branch isn't the one GitHub Pages publishes, so saving doesn't rebuild the website.
const REPO = 'rms2013v/financetracker', BRANCH = 'data', PATH = 'vault.json';
const API = `https://api.github.com/repos/${REPO}/contents/${PATH}`;

function withTimeout(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }

// The online record, or null if there isn't one yet.
export async function fetchRecord(token) {
  const r = await fetch(`${API}?ref=${BRANCH}&t=${Date.now()}`, {cache: 'no-store', signal: withTimeout(8000),
    headers: {Accept: 'application/vnd.github.raw+json', ...(token ? {Authorization: 'Bearer ' + token} : {})}});
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub answered ' + r.status);
  const rec = await r.json();
  return rec && rec.app === 'finance-dashboard' && rec.box ? rec : null;
}

async function currentSha(token) {
  const r = await fetch(`${API}?ref=${BRANCH}&t=${Date.now()}`, {cache: 'no-store', headers: {Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token}});
  if (r.status === 404) return null;
  if (r.status === 401) throw new Error('GitHub didn’t accept the token.');
  if (!r.ok) throw new Error('GitHub answered ' + r.status);
  return (await r.json()).sha;
}

// Uploads the encrypted record text. Retries once if another device saved in between.
export async function upload(token, text) {
  const body = (sha) => JSON.stringify({message: 'Update encrypted data', branch: BRANCH, content: btoa(text), ...(sha ? {sha} : {})});
  for (let attempt = 0; attempt < 2; attempt++) {
    const sha = await currentSha(token);
    const r = await fetch(API, {method: 'PUT', headers: {Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: body(sha)});
    if (r.ok) return;
    if (r.status === 401) throw new Error('GitHub didn’t accept the token.');
    if (r.status === 403 || r.status === 404) throw new Error('The token can’t write to the FinanceTracker repo. It needs Contents: Read and write.');
    if (r.status !== 409 && r.status !== 422) throw new Error('GitHub answered ' + r.status);
  }
  throw new Error('Another device was saving at the same time. Try Sync now.');
}

export async function remove(token) {
  const sha = await currentSha(token);
  if (!sha) return;
  const r = await fetch(API, {method: 'DELETE', headers: {Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
    body: JSON.stringify({message: 'Remove encrypted data', branch: BRANCH, sha})});
  if (!r.ok) throw new Error('GitHub answered ' + r.status);
}

export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
