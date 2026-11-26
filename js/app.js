import * as vault from './vault.js?v=202611261408';
import {parseFile, merge, readTable, cardAccounts, aiCardBatch, ACCOUNTS} from './parse.js?v=202611261408';
import {readLayout, applyLayout, categorize, signature, merchantKey, extractFromText, DEFAULT_MODEL} from './ai.js?v=202611261408';
import * as A from './analysis.js?v=202611261408';
import {COLORS, fmt, P, monName, stackedMonths, weeklyChart, hbars, grouped, lineChart, miniCard, heroTrend, donut} from './charts.js?v=202611261408';
import {DEFAULT_FX, GROUPS} from './rules.js?v=202611261408';
import * as M from './mortgage.js?v=202611261408';
import {latestUsdCad} from './fx.js?v=202611261408';
import * as PK from './passkey.js?v=202611261408';

const XLSX = window.XLSX;
const CATS = Object.values(GROUPS).flat();
const IDLE_MINUTES = 15;
const USERNAME = 'oleh';
const app = document.getElementById('app');

let session = null, data = null;
let f = {account: '', group: '', big: false, category: '', month: '', budgetMonth: '', chqtype: '', prop: '', rbctype: ''};

// ---- small helpers --------------------------------------------------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; el.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return el;
}
const $ = (sel) => document.querySelector(sel);
const sign = (v) => (v < 0 ? '−' : '+') + fmt.usd(Math.abs(v));
const good = (el, ok) => { el.classList.toggle('bad', !ok); el.classList.toggle('ok', ok); return el; };
const dateCell = (d) => fmt.dayY(P(d));
let toastTimer;
function toast(msg, bad) {
  let t = $('#toast'); if (!t) { t = h('div', {id: 'toast', role: 'status'}); document.body.append(t); }
  t.textContent = msg; t.className = bad ? 'show bad' : 'show';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 2600);
}
const emptyData = () => ({cards: [], chq: [], rbc: [], income: [], uploads: [], mortgages: [], settings: {fx: DEFAULT_FX, aiKey: '', aiModel: DEFAULT_MODEL, formats: {}, merchants: {}}});
const normalize = (d) => ({...emptyData(), ...(d || {}), settings: {...emptyData().settings, ...((d || {}).settings || {})}});

async function persist(msg) {
  try { await vault.save(session, data); if (msg) toast(msg); }
  catch (e) { toast('Couldn’t save in this browser: ' + e.message, true); }
}

// ---- login ----------------------------------------------------------------
async function showLogin() {
  const has = await vault.exists();
  const err = h('p', {class: 'err', role: 'alert'});
  const user = h('input', {type: 'text', id: 'user', autocomplete: 'username', required: true, autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Username'});
  const pw = h('input', {type: 'password', id: 'pw', autocomplete: 'current-password', required: true, 'aria-label': 'Password'});
  const file = has ? null : h('input', {type: 'file', id: 'backup', accept: '.json,application/json', 'aria-label': 'Backup file'});
  const btn = h('button', {type: 'submit', class: 'btn primary wide'}, 'Sign in');
  const pk = has && PK.supported() && PK.saved();
  const pkBtn = pk && h('button', {type: 'button', class: 'btn primary wide', onClick: async () => {
    err.textContent = ''; pkBtn.disabled = true; pkBtn.textContent = 'Waiting for Touch ID…';
    try { start(await vault.unlock(await PK.password())); }
    catch (e) {
      err.textContent = e.message === 'wrong-password' ? 'Your password has changed since the passkey was set up. Sign in with your password, then set the passkey up again in Settings.' : PK.explain(e);
      pkBtn.disabled = false; pkBtn.textContent = 'Sign in with passkey';
    }
  }}, 'Sign in with passkey');
  if (pk) btn.className = 'btn wide';
  const fileBox = file && h('div', {hidden: true},
    h('p', {class: 'note'}, 'This device has no data yet. Choose your backup file (on your computer: Menu → Download backup), then press Sign in again. You only need it once per device.'),
    h('label', {class: 'field'}, h('span', {}, 'Backup file'), file));
  const form = h('form', {class: 'login-card', onSubmit: async (ev) => {
    ev.preventDefault(); err.textContent = '';
    if (user.value.trim().toLowerCase() !== USERNAME) { err.textContent = 'That username and password don’t match.'; pw.value = ''; return; }
    if (!has && !file.files[0]) { fileBox.hidden = false; err.textContent = ''; return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const s = has ? await vault.unlock(pw.value) : await vault.restore(await file.files[0].text(), pw.value);
      pw.value = '';
      start(s);
    } catch (e) {
      err.textContent = e.message === 'wrong-password' ? 'That username and password don’t match.' : e.message === 'bad-file' ? 'That file isn’t a backup from this dashboard.' : 'Something went wrong: ' + e.message;
      btn.disabled = false; btn.textContent = 'Sign in'; pw.select();
    }
  }},
    h('img', {src: 'logo.jpg', alt: '', class: 'login-logo', width: 112, height: 112}),
    h('h1', {class: 'login-title'}, 'ALF+VERA+OLEH bank'),
    h('p', {class: 'muted'}, 'Sign in to open your data.'),
    pkBtn, pk && h('p', {class: 'or'}, 'or use your password'),
    h('label', {class: 'field'}, h('span', {}, 'Username'), user),
    h('label', {class: 'field'}, h('span', {}, 'Password'), pw),
    fileBox,
    err, btn);
  app.replaceChildren(h('main', {class: 'login'}, form));
  (pkBtn || user).focus();
}

function restoreDialog(fromLogin) {
  const file = h('input', {type: 'file', accept: '.json,application/json'});
  const pw = h('input', {type: 'password', autocomplete: 'current-password', 'aria-label': 'Backup password'});
  const err = h('p', {class: 'err'});
  const d = h('dialog', {class: 'dlg'},
    h('h2', {}, 'Restore a backup'),
    h('p', {class: 'muted'}, 'This replaces the data in this browser with the backup. Use the password that was set when the backup was made.'),
    h('label', {class: 'field'}, h('span', {}, 'Backup file'), file),
    h('label', {class: 'field'}, h('span', {}, 'Password'), pw),
    err,
    h('div', {class: 'dlg-actions'},
      h('button', {class: 'btn', onClick: () => d.close()}, 'Cancel'),
      h('button', {class: 'btn primary', onClick: async () => {
        err.textContent = '';
        if (!file.files[0]) { err.textContent = 'Choose the backup file.'; return; }
        try { const s = await vault.restore(await file.files[0].text(), pw.value); d.close(); start(s); toast('Backup restored'); }
        catch (e) { err.textContent = e.message === 'wrong-password' ? 'That password doesn’t open this backup.' : e.message === 'bad-file' ? 'That isn’t a backup from this dashboard.' : e.message; }
      }}, 'Restore')));
  document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal();
}

// ---- session ----------------------------------------------------------------
let idleTimer;
function bumpIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => lock('Locked after ' + IDLE_MINUTES + ' minutes without activity'), IDLE_MINUTES * 60000); }
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { if (session) bumpIdle(); }, {passive: true}));
function start(s) { session = {key: s.key, salt: s.salt, iter: s.iter}; data = normalize(s.data); bumpIdle(); renderShell(); autoFx(); }
const todayISO = () => new Date().toLocaleDateString('en-CA');
// Fills the default USD to CAD rate with the Bank of Canada's latest daily rate, at most once a day.
// Saved entries keep the rate they were made with, so earlier numbers never shift.
async function autoFx(force) {
  const st = data?.settings; if (!st || (st.fxManual && !force)) return;
  if (!force && st.fxChecked === todayISO()) return;
  try {
    const {rate, date} = await latestUsdCad();
    if (!data) return;
    data.settings = {...data.settings, fx: rate, fxDate: date, fxChecked: todayISO(), fxManual: false};
    await persist(force ? 'Rate updated: ' + rate.toFixed(4) + ' (Bank of Canada, ' + fmt.day(P(date)) + ')' : null);
    renderAll();
  } catch (e) { if (force) toast('Couldn’t get the Bank of Canada rate: ' + e.message, true); }
}
function lock(msg) { session = null; data = null; clearTimeout(idleTimer); document.querySelectorAll('dialog').forEach((d) => d.remove()); showLogin(); if (msg) toast(msg); }

// ---- uploads --------------------------------------------------------------
function readFile(file) {
  return /\.(csv|txt)$/i.test(file.name) ? file.text() : file.arrayBuffer().then((b) => new Uint8Array(b));
}
const uniqBy = (a, f) => { const m = new Map(); for (const x of a) if (!m.has(f(x))) m.set(f(x), x); return [...m.values()]; };

// Files the dashboard doesn't know are read with Claude: it works out the columns, then every row is read here.
async function readWithAI(it, draw) {
  it.busy = true; it.aiError = ''; draw();
  try {
    const st = data.settings;
    const sig = signature(it.sheets), saved = st.formats[sig];
    const L = saved ? saved.layout : await readLayout(st, it.sheets, it.file.name);
    if (!L.isTransactions) throw new Error('Claude says this isn’t a list of transactions: ' + L.summary);
    if (L.kind === 'bank') throw new Error('This looks like a bank account statement (' + L.summary + '). AI reading works for credit card activity for now.');
    const raw = applyLayout(it.sheets, L);
    if (!raw.length) throw new Error('No transactions were found with the layout Claude described.');
    const need = uniqBy(raw.map((r) => ({key: merchantKey(r.desc), desc: r.desc, hint: r.hint})), (m) => m.key).filter((m) => !st.merchants[m.key]);
    const fresh = need.length && st.aiKey ? await categorize(st, need) : {};
    const names = cardAccounts(data.cards), guess = names.find((a) => a.toLowerCase().includes(String(L.accountName).toLowerCase()) || String(L.accountName).toLowerCase().includes(a.toLowerCase()));
    it.ai = {L, raw, fresh, sig, saved: !!saved, account: saved ? saved.account : (guess || L.accountName || 'Other card'), currency: L.currency === 'CAD' ? 'CAD' : L.currency === 'OTHER' ? 'USD' : L.currency, fx: st.fx};
    buildAI(it);
  } catch (e) { it.aiError = e.message; }
  it.busy = false; draw();
}
// Text pasted from a bank or card website: Claude lists the transactions, which are then added like a short extras list.
async function readPasteWithAI(it, draw) {
  it.busy = true; it.aiError = ''; draw();
  try {
    const st = data.settings, res = await extractFromText(st, it.raw);
    const items = (res.items || []).filter((t) => !t.isPayment && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isFinite(+t.amount) && +t.amount !== 0);
    if (!items.length) throw new Error('Claude didn’t find any card transactions in that text.');
    const raw = items.map((t) => ({date: t.date, desc: String(t.raw || t.merchant), charge: Math.round(+t.amount * 100) / 100}));
    const fresh = {};
    for (const t of items) fresh[merchantKey(String(t.raw || t.merchant))] = {name: String(t.merchant || t.raw).slice(0, 60), category: CATS.includes(t.category) ? t.category : 'Uncategorized'};
    const names = cardAccounts(data.cards), an = String(res.accountName || '').toLowerCase();
    const guess = an && names.find((a) => a.toLowerCase().includes(an) || an.includes(a.toLowerCase()));
    it.ai = {L: {summary: res.summary || 'Pasted transactions.'}, raw, fresh, paste: true, mode: 'append', account: it.ai?.account || guess || (an ? res.accountName : names[0] || 'Other card'),
      currency: res.currency === 'CAD' ? 'CAD' : res.currency === 'OTHER' ? 'USD' : res.currency, fx: st.fx};
    buildAI(it);
  } catch (e) { it.aiError = e.message; }
  it.busy = false; draw();
}
function buildAI(it) {
  const a = it.ai;
  it.batch = aiCardBatch(a.raw, {account: a.account.trim() || 'Other card', currency: a.currency, fx: a.fx, keyOf: merchantKey,
    merchants: {...data.settings.merchants, ...a.fresh}, mode: a.mode || 'replace', fileLabel: (a.account.trim() || 'Other card') + (a.paste ? ' (pasted)' : ' (read with AI)')});
}

function uploadDialog(initial) {
  let items = [];
  const list = h('div', {class: 'upl-list'});
  const confirm = h('button', {class: 'btn primary', disabled: true}, 'Add to dashboard');
  const input = h('input', {type: 'file', multiple: true, accept: '.csv,.xlsx,.xls,.txt', id: 'upl-input', class: 'sr-only'});
  const drop = h('label', {class: 'drop', for: 'upl-input'}, h('strong', {}, 'Choose files'), ' or drop them here', h('br'),
    h('span', {class: 'muted'}, 'Wealthsimple, Amex and RBC exports are read directly. For any other card file, choose it here, then click “Read with AI” on its row below.'));
  const ready = (it) => it.batch && !it.batch.error && it.batch.rows.length;
  const meta = (b, extra) => h('div', {class: 'upl-meta'}, b.label, ' · ', b.rows.length + ' transactions · ', b.from ? fmt.day(P(b.from)) + ' to ' + fmt.dayY(P(b.to)) : 'no dates',
    ' · ', b.mode === 'replace' ? 'replaces this card’s data for those dates' : 'adds only new transactions', extra || '');
  const accountsList = h('datalist', {id: 'acct-list'}, cardAccounts(data.cards).map((a) => h('option', {value: a})));
  const aiView = (it) => {
    const a = it.ai, b = it.batch, unc = b.rows.filter((r) => r.category === 'Uncategorized').length;
    return h('div', {class: 'upl-ai'},
      h('div', {class: 'upl-meta'}, (a.saved ? 'Read with a saved layout. ' : 'Read with AI. ') + a.L.summary),
      meta(b, unc ? ' · ' + unc + ' uncategorized' : ''),
      h('div', {class: 'upl-fields'},
        h('label', {class: 'field'}, h('span', {}, 'Card'), h('input', {list: 'acct-list', value: a.account, onChange: (ev) => { a.account = ev.target.value; buildAI(it); draw(); }})),
        a.currency !== 'CAD' && h('label', {class: 'field'}, h('span', {}, a.currency + ' to CAD rate'), h('input', {type: 'number', step: '0.0001', min: '0', value: a.fx, onChange: (ev) => { const v = Number(ev.target.value); if (v > 0) { a.fx = v; buildAI(it); draw(); } }}))),
      h('p', {class: 'note'}, a.paste ? 'Pick the card these belong to. Transactions already on the dashboard are skipped, so pasting the same list twice is safe.' : 'Using an existing card name replaces that card’s transactions for these dates. A new name adds a new card.'),
      table([{t: 'Date', f: (r) => dateCell(r.date)}, {t: 'Merchant', f: (r) => r.merchant}, {t: 'Category', f: (r) => r.category}, {t: 'Amount', num: true, f: (r) => fmt.usd2(r.spend)}],
        b.rows.slice(0, 6)));
  };
  const draw = () => {
    list.replaceChildren(accountsList, ...items.map((it, i) => {
      const b = it.batch;
      let body;
      if (it.busy) body = h('div', {class: 'upl-meta'}, 'Reading with Claude…');
      else if (it.ai && ready(it)) body = aiView(it);
      else if (it.aiError && !b.error) body = h('div', {}, h('div', {class: 'err'}, it.aiError), meta(b));
      else if (it.paste && b.error) body = h('div', {}, h('div', {class: 'err'}, it.aiError || 'Not a known export layout.'),
        h('button', {class: 'btn small primary', onClick: () => readPasteWithAI(it, draw)}, 'Try again with AI'));
      else if (b.error) body = h('div', {}, h('div', {class: 'err'}, it.aiError || b.error),
        it.sheets && h('button', {class: 'btn small primary', onClick: () => readWithAI(it, draw)}, it.aiError ? 'Try again with AI' : 'Read with AI'),
        it.sheets && !data.settings.aiKey && h('span', {class: 'note'}, ' Needs your Anthropic API key in Menu → Settings.'));
      else body = h('div', {}, meta(b),
        h('button', {class: 'linkbtn small-link', onClick: () => { try { it.sheets = it.sheets || readTable(XLSX, it.file.name, it.raw); readWithAI(it, draw); } catch (e) { toast(e.message, true); } }}, 'Read with AI instead'),
        it.amex && h('label', {class: 'upl-card'}, 'Card: ', h('select', {onChange: (ev) => { it.card = ev.target.value; it.batch = parseFile(XLSX, it.file.name, it.raw, {card: it.card, fx: data.settings.fx}); draw(); }},
          h('option', {value: 'aeroplan', selected: it.card === 'aeroplan'}, 'Amex Aeroplan Reserve (CAD)'),
          h('option', {value: 'delta', selected: it.card === 'delta'}, 'Delta SkyMiles (USD)'))));
      return h('div', {class: 'upl-item' + (b.error && !it.busy ? ' is-err' : '')},
        h('div', {class: 'upl-name'}, it.paste ? 'Pasted text · ' + it.raw.split('\n').filter((l) => l.trim()).length + ' lines' : it.file.name), h('button', {class: 'linkbtn', onClick: () => { items.splice(i, 1); draw(); }}, 'Remove'), body);
    }));
    confirm.disabled = !items.some(ready) || items.some((it) => it.busy);
  };
  const add = async (files) => {
    for (const file of files) {
      const it = {file};
      try {
        it.raw = await readFile(file);
        it.batch = parseFile(XLSX, file.name, it.raw, {fx: data.settings.fx});
        it.amex = !it.batch.error && it.batch.kind === 'cards' && it.batch.account !== ACCOUNTS.ws;
        it.card = it.amex ? (it.batch.account === ACCOUNTS.delta ? 'delta' : 'aeroplan') : null;
        if (it.batch.error) { try { it.sheets = readTable(XLSX, file.name, it.raw); } catch { it.sheets = null; } }
      } catch (e) { it.batch = {error: 'Couldn’t read this file: ' + e.message}; }
      items.push(it);
      if (it.sheets && data.settings.formats[signature(it.sheets)]) readWithAI(it, draw);
    }
    draw();
  };
  const pasteBox = h('textarea', {class: 'paste', rows: 6, placeholder: 'Or paste transactions here: select them on your bank or card website (or rows in a spreadsheet), copy, and paste.', 'aria-label': 'Pasted transactions'});
  const pasteBtn = h('button', {class: 'btn primary', onClick: () => {
    const text = pasteBox.value.trim(); if (!text) { pasteBox.focus(); return; }
    const it = {paste: true, raw: text, file: {name: 'pasted.csv'}};
    const tabular = text.split('\n').slice(0, 5).every((l) => l.includes('\t') || l.split(',').length >= 3);
    it.batch = tabular ? parseFile(XLSX, 'pasted.csv', text.replace(/\t/g, ','), {fx: data.settings.fx}) : {error: 'paste'};
    if (!it.batch.error) it.batch.mode = 'append';
    items.push(it); pasteBox.value = ''; draw();
    if (it.batch.error) {
      if (!data.settings.aiKey) { it.aiError = 'Reading pasted text needs your Anthropic API key in Menu → Settings.'; draw(); }
      else readPasteWithAI(it, draw);
    }
  }}, 'Read pasted text');
  input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
  drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (ev) => { ev.preventDefault(); drop.classList.remove('over'); add([...ev.dataTransfer.files]); });
  confirm.addEventListener('click', async () => {
    const count = () => data.cards.length + data.chq.length + data.rbc.length;
    const before = count();
    for (const it of items) {
      if (!ready(it)) continue;
      data = merge(data, it.batch);
      if (it.ai) {
        if (it.ai.sig) data.settings.formats[it.ai.sig] = {layout: it.ai.L, account: it.ai.account.trim() || 'Other card'};
        data.settings.merchants = {...data.settings.merchants, ...it.ai.fresh};
      }
      data.uploads.unshift({name: it.file.name, label: it.batch.label, rows: it.batch.rows.length, from: it.batch.from, to: it.batch.to, at: new Date().toISOString()});
    }
    data.uploads = data.uploads.slice(0, 50);
    const n = count() - before;
    await persist(n > 0 ? n + ' new transactions added' : 'No new transactions. Everything was already in.');
    d.close(); renderAll();
  });
  const d = h('dialog', {class: 'dlg wide'},
    h('h2', {}, 'Add transactions'),
    h('p', {class: 'muted'}, 'Files are read here in your browser. Only for “Read with AI” are the first rows of the file and the merchant names sent to Claude.'),
    input, drop, h('div', {class: 'paste-row'}, pasteBox, pasteBtn), list,
    h('div', {class: 'dlg-actions'}, h('button', {class: 'btn', onClick: () => d.close()}, 'Cancel'), confirm));
  document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal();
  if (initial) add(initial);
}

// ---- menu dialogs ------------------------------------------------------------
async function downloadBackup() {
  const blob = new Blob([await vault.backupText()], {type: 'application/json'});
  const a = h('a', {href: URL.createObjectURL(blob), download: 'finance-dashboard-backup-' + new Date().toLocaleDateString('en-CA') + '.json'});
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup downloaded. It opens only with your password.');
}
// Small pictures of your cards for the chart legend. Kept only in your encrypted data, never on GitHub.
function shrinkImage(file, w = 120, hgt = 76) {
  return new Promise((ok, bad) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = w * 2; c.height = hgt * 2;
      const r = Math.max(c.width / img.width, c.height / img.height), dw = img.width * r, dh = img.height * r;
      c.getContext('2d').drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('That file isn’t a picture this browser can open.')); };
    img.src = url;
  });
}
function cardArtBlock() {
  const box = h('div', {});
  const draw = () => {
    const art = data.settings.cardArt || {}, all = cardAccounts(data.cards);
    box.replaceChildren(
      h('p', {class: 'muted'}, 'Add a picture of each card for the chart legend, for example the card image from your bank’s website. Pictures stay in your encrypted data in this browser. Don’t use a photo that shows your card number.'),
      h('div', {class: 'art-list'}, all.map((name) => {
        const input = h('input', {type: 'file', accept: 'image/*', class: 'sr-only', id: 'art-' + name.replace(/\W/g, '')});
        input.addEventListener('change', async () => {
          const f = input.files[0]; if (!f) return;
          try { data.settings.cardArt = {...art, [name]: await shrinkImage(f)}; await persist('Picture added for ' + name); draw(); renderAll(); }
          catch (e) { toast(e.message, true); }
        });
        return h('div', {class: 'art-row'}, miniCard(COLORS[all.indexOf(name) % COLORS.length], art[name]), h('span', {class: 'art-name'}, name), input,
          h('label', {class: 'btn small', for: input.id}, art[name] ? 'Change' : 'Add picture'),
          art[name] && h('button', {class: 'linkbtn', onClick: async () => { const a = {...art}; delete a[name]; data.settings.cardArt = a; await persist('Picture removed'); draw(); renderAll(); }}, 'Remove'));
      })));
  };
  draw();
  return box;
}

function passkeyBlock() {
  const box = h('div', {});
  const draw = () => {
    const pk = PK.saved();
    if (!PK.supported()) { box.replaceChildren(h('p', {class: 'muted'}, 'This browser doesn’t support passkeys.')); return; }
    if (pk) {
      box.replaceChildren(h('p', {class: 'muted'}, 'Touch ID sign-in is on for this browser (set up ' + fmt.dayY(new Date(pk.at)) + ').'),
        h('button', {class: 'btn', onClick: () => { PK.forget(); toast('Passkey sign-in turned off for this browser'); draw(); }}, 'Turn off passkey sign-in'));
      return;
    }
    const pw = h('input', {type: 'password', autocomplete: 'current-password', 'aria-label': 'Your password'});
    const msg = h('p', {class: 'err'});
    box.replaceChildren(
      h('p', {class: 'muted'}, 'Sign in with Touch ID instead of typing your password. It’s saved in your iCloud Keychain and works in this browser. Enter your password once to set it up.'),
      h('div', {class: 'form'}, h('label', {class: 'field'}, h('span', {}, 'Your password'), pw),
        h('button', {class: 'btn primary', onClick: async () => {
          msg.textContent = '';
          try { await vault.unlock(pw.value); } catch { msg.textContent = 'That password is wrong.'; return; }
          try { await PK.setup(pw.value, USERNAME); pw.value = ''; toast('Passkey set up. Next time, sign in with Touch ID.'); draw(); }
          catch (e) { msg.textContent = PK.explain(e); }
        }}, 'Set up passkey')), msg);
  };
  draw();
  return box;
}

function settingsDialog() {
  const oldPw = h('input', {type: 'password', autocomplete: 'current-password'}), newPw = h('input', {type: 'password', autocomplete: 'new-password'}), newPw2 = h('input', {type: 'password', autocomplete: 'new-password'});
  const msg = h('p', {class: 'err'});
  const fx = h('input', {type: 'number', step: '0.0001', min: '0', value: data.settings.fx});
  const aiKey = h('input', {type: 'password', autocomplete: 'off', placeholder: 'sk-ant-…', value: data.settings.aiKey || ''});
  const aiModel = h('input', {type: 'text', value: data.settings.aiModel || DEFAULT_MODEL});
  const d = h('dialog', {class: 'dlg wide'},
    h('h2', {}, 'Settings'),
    h('h3', {}, 'Passkey'),
    passkeyBlock(),
    h('h3', {}, 'Card pictures'),
    cardArtBlock(),
    h('h3', {}, 'Change password'),
    h('div', {class: 'form'},
      h('label', {class: 'field'}, h('span', {}, 'Current password'), oldPw),
      h('label', {class: 'field'}, h('span', {}, 'New password'), newPw),
      h('label', {class: 'field'}, h('span', {}, 'Repeat new password'), newPw2),
      h('button', {class: 'btn', onClick: async () => {
        msg.textContent = '';
        if (newPw.value.length < 10) { msg.textContent = 'Use at least 10 characters.'; return; }
        if (newPw.value !== newPw2.value) { msg.textContent = 'The new passwords don’t match.'; return; }
        try { await persist(); const s = await vault.changePassword(oldPw.value, newPw.value); session = {key: s.key, salt: s.salt, iter: s.iter}; PK.forget(); toast('Password changed. Set up your passkey again, and download a new backup: old backups still use the old password.'); d.close(); }
        catch (e) { msg.textContent = e.message === 'wrong-password' ? 'The current password is wrong.' : e.message; }
      }}, 'Change password')),
    msg,
    h('h3', {}, 'Reading files with AI'),
    h('p', {class: 'muted'}, 'Uses your own Anthropic API key (console.anthropic.com → API keys). It is stored inside your encrypted data. When you choose “Read with AI”, the first 30 rows of that file and its merchant names are sent to Claude. Each file usually costs a few cents.'),
    h('div', {class: 'form'},
      h('label', {class: 'field'}, h('span', {}, 'API key'), aiKey),
      h('label', {class: 'field'}, h('span', {}, 'Model'), aiModel),
      h('button', {class: 'btn', onClick: async () => { data.settings.aiKey = aiKey.value.trim(); data.settings.aiModel = aiModel.value.trim() || DEFAULT_MODEL; await persist(data.settings.aiKey ? 'AI settings saved' : 'API key removed'); }}, 'Save')),
    h('p', {class: 'note'}, Object.keys(data.settings.formats).length + ' file layouts and ' + Object.keys(data.settings.merchants).length + ' merchants remembered. ',
      h('button', {class: 'linkbtn', onClick: async (ev) => { data.settings.formats = {}; data.settings.merchants = {}; await persist('Saved layouts and merchants cleared'); ev.target.parentElement.firstChild.textContent = '0 file layouts and 0 merchants remembered. '; }}, 'Forget them')),
    h('h3', {}, 'USD to CAD rate'),
    h('p', {class: 'muted'}, data.settings.fxManual ? 'You set this rate yourself, so it isn’t updated automatically.'
      : data.settings.fxDate ? 'Filled in automatically with the Bank of Canada’s official rate for ' + fmt.dayY(P(data.settings.fxDate)) + '. Checked once a day.' : 'Filled in automatically with the Bank of Canada’s official daily rate.',
      ' It’s used for new USD salary entries and pasted USD transactions. Saved entries keep the rate they were made with.'),
    h('div', {class: 'form'}, h('label', {class: 'field'}, h('span', {}, 'Rate'), fx),
      h('button', {class: 'btn', onClick: async () => { const v = Number(fx.value); if (v > 0) { data.settings.fx = v; data.settings.fxManual = true; await persist('Rate saved. It won’t update automatically now.'); renderAll(); } }}, 'Use this rate'),
      h('button', {class: 'btn', onClick: async () => { await autoFx(true); fx.value = data.settings.fx; d.close(); }}, 'Get today’s Bank of Canada rate')),
    h('h3', {}, 'Uploads'),
    data.uploads.length ? h('div', {class: 'tablewrap scroll short'}, h('table', {class: 'table'},
      h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'File'), h('th', {}, 'Type'), h('th', {class: 'num'}, 'Rows'), h('th', {}, 'Dates'))),
      h('tbody', {}, data.uploads.map((u) => h('tr', {}, h('td', {}, new Date(u.at).toLocaleString()), h('td', {}, u.name), h('td', {}, u.label), h('td', {class: 'num'}, u.rows), h('td', {}, u.from ? u.from + ' to ' + u.to : '')))))) : h('p', {class: 'muted'}, 'No uploads yet.'),
    h('h3', {}, 'Delete everything'),
    h('p', {class: 'muted'}, 'Removes all data from this browser. Download a backup first if you may want it back.'),
    h('button', {class: 'btn danger', onClick: async () => { if (!window.confirm('Delete all data in this browser?')) return; await vault.wipe(); PK.forget(); d.close(); lock('All data deleted'); }}, 'Delete all data'),
    h('div', {class: 'dlg-actions'}, h('button', {class: 'btn primary', onClick: () => d.close()}, 'Done')));
  document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal();
}

// ---- page shell -------------------------------------------------------------
function renderShell() {
  const menu = h('details', {class: 'menu'}, h('summary', {class: 'btn'}, 'Menu'),
    h('div', {class: 'menu-pop'},
      h('button', {onClick: (ev) => { ev.target.closest('details').open = false; downloadBackup(); }}, 'Download backup'),
      h('button', {onClick: (ev) => { ev.target.closest('details').open = false; restoreDialog(false); }}, 'Restore a backup'),
      h('button', {onClick: (ev) => { ev.target.closest('details').open = false; setFolded(SECTIONS, true); }}, 'Collapse all sections'),
      h('button', {onClick: (ev) => { ev.target.closest('details').open = false; setFolded(SECTIONS, false); }}, 'Expand all sections'),
      h('button', {onClick: (ev) => { ev.target.closest('details').open = false; settingsDialog(); }}, 'Settings')));
  app.replaceChildren(
    h('header', {class: 'top'},
      h('div', {class: 'brand'}, h('img', {src: 'logo-small.jpg', alt: '', class: 'brand-logo', width: 32, height: 32}), h('strong', {}, 'ALF+VERA+OLEH bank'), h('span', {class: 'muted', id: 'range'})),
      h('nav', {class: 'nav'}, ['overview:Overview', 'budget:Budget', 'cards:Cards', 'banks:Bank accounts', 'housing:Housing', 'mortgages:Mortgages'].map((s) => { const [id, t] = s.split(':'); return h('a', {href: '#' + id, onClick: () => { if (isFolded(id)) setFolded([id], false); }}, t); })),
      h('div', {class: 'actions'},
        h('button', {class: 'btn primary', onClick: () => uploadDialog()}, 'Add transactions'), menu,
        h('button', {class: 'btn', onClick: () => lock()}, 'Lock'))),
    h('main', {class: 'wrap', id: 'main'}));
  document.addEventListener('dragover', (ev) => { if (session && ev.dataTransfer?.types?.includes('Files')) ev.preventDefault(); });
  document.addEventListener('drop', (ev) => { if (!session || $('dialog[open]')) return; ev.preventDefault(); if (ev.dataTransfer.files.length) uploadDialog([...ev.dataTransfer.files]); });
  renderAll();
}

const SECTIONS = ['overview', 'budget', 'cards', 'banks', 'housing', 'mortgages'];
const isFolded = (id) => !!data.settings.collapsed?.[id];
async function setFolded(ids, folded) {
  const c = {...(data.settings.collapsed || {})};
  for (const id of ids) { if (folded) c[id] = true; else delete c[id]; }
  data.settings.collapsed = c; renderAll(); await persist();
}
// A section whose title folds it away. The parts stay on the page but hidden, so charts redraw when it opens.
function foldable(id, heading, ...kids) {
  const folded = isFolded(id);
  return h('section', {class: 'sec' + (folded ? ' folded' : ''), id},
    h('div', {class: 'sec-head'}, h('button', {class: 'fold', 'aria-expanded': String(!folded), 'aria-controls': id + '-body', title: folded ? 'Show this section' : 'Hide this section',
      onClick: () => setFolded([id], !folded)}, h('span', {class: 'chev', 'aria-hidden': 'true'}), heading)),
    h('div', {class: 'sec-body', id: id + '-body', hidden: folded}, ...kids));
}
function section(id, title, ...kids) { return foldable(id, h('h2', {class: 'sec-title'}, title), ...kids); }
const chart = (id, cls = '') => h('div', {class: 'chart ' + cls, id});
function table(cols, rows, opts = {}) {
  return h('div', {class: 'tablewrap' + (opts.scroll ? ' scroll' : '')}, h('table', {class: 'table'},
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', {class: c.num ? 'num' : ''}, c.t)))),
    h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, cols.map((c) => { const v = c.f(r); return h('td', {class: c.num ? 'num' : (c.cls || '')}, v); })))
      : h('tr', {}, h('td', {colspan: cols.length, class: 'muted'}, opts.empty || 'Nothing to show.')))));
}
const pickBtn = (text, on, onClick) => h('button', {class: 'linkbtn pick' + (on ? ' on' : ''), title: on ? 'Clear this choice' : 'Show only ' + text, onClick}, text);
const setF = (patch) => { f = {...f, ...patch}; renderAll(); };

// ---- the dashboard ------------------------------------------------------------
let charts = [];
function renderAll() {
  const main = $('#main'); if (!main || !data) return;
  const scrollY = window.scrollY;
  charts = [];
  if (!data.cards.length && !data.chq.length && !data.rbc.length) {
    $('#range').textContent = '';
    main.replaceChildren(h('section', {class: 'empty'},
      h('h1', {}, 'Add your files to get started'),
      h('p', {}, 'Upload your exports. They’re read and stored only in this browser, encrypted with your password.'),
      h('ul', {}, h('li', {}, 'Wealthsimple credit card: activity CSV'), h('li', {}, 'Wealthsimple chequing: activity CSV'),
        h('li', {}, 'Amex Aeroplan Reserve and Delta SkyMiles: “activity.xlsx” downloads'), h('li', {}, 'RBC chequing: download-transactions CSV')),
      h('button', {class: 'btn primary big', onClick: () => uploadDialog()}, 'Upload files')));
    return;
  }
  const wins = A.windows(data.cards), base = A.filterBase(data.cards, f), rows = A.filterAll(base, f);
  const k = A.kpi(rows, wins, f), per = A.period(rows, k), months = A.monthly(rows, wins);
  const bud = A.budget(data.income, data.cards);
  $('#range').textContent = k ? ' · cards ' + fmt.day(P(k.start)) + ' to ' + fmt.dayY(P(k.end)) : '';

  main.replaceChildren(
    overview(k, per, bud, rows, wins),
    budgetSection(bud),
    cardsSection(rows, base, wins, k, months),
    banksSection(),
    housingSection(),
    mortgagesSection(),
    h('details', {class: 'foot'}, h('summary', {}, 'How these numbers are worked out'),
      h('p', {}, 'Card payments are left out, so card figures count only charges and refunds, with refunds netted against their category. Run rates take each card’s net spend over its own date range and add them up. Delta SkyMiles is billed in USD and turned into CAD at each month’s rate, read from charges that statement also priced in CAD.'),
      h('p', {}, 'A one-off is any charge or refund of $500 or more. A month with no salary entered assumes the latest payment whose description includes “salary”. Housing amounts come from your RBC chequing using the rules in js/rules.js.')));
  for (const fn of charts) fn();
  window.scrollTo(0, scrollY);
}

function overview(k, per, bud, rows, wins) {
  const cardsSel = h('select', {'aria-label': 'Card', onChange: (ev) => setF({account: ev.target.value})},
    h('option', {value: ''}, 'All cards'), cardAccounts(data.cards).map((a) => h('option', {value: a, selected: f.account === a}, a)));
  const groups = [...new Set(data.cards.map((r) => r.group))].sort();
  const groupSel = h('select', {'aria-label': 'Category group', onChange: (ev) => setF({group: ev.target.value, category: ''})},
    h('option', {value: ''}, 'All category groups'), groups.map((g) => h('option', {value: g, selected: f.group === g}, g)));
  const big = h('label', {class: 'check'}, h('input', {type: 'checkbox', checked: f.big, onChange: (ev) => setF({big: ev.target.checked})}), ' Leave out one-offs of $500 or more');
  const pick = f.category ? h('span', {class: 'pickchip'}, 'Category: ' + f.category, h('button', {class: 'btn small', onClick: () => setF({category: ''})}, 'Clear')) : null;
  const filtered = !!(f.account || f.group || f.big || f.category);
  const controls = h('div', {class: 'controls'}, cardsSel, groupSel, big, pick, filtered && h('button', {class: 'btn small', onClick: () => setF({account: '', group: '', big: false, category: ''})}, 'Reset filters'));
  const head = h('h1', {class: 'page-title'}, 'Spending, 2026 to date');
  if (!k) return foldable('overview', head, controls, h('p', {class: 'muted'}, 'No card data matches these filters.'));

  const year = k.end.slice(0, 4), monthLabel = monName(per.month).split(' ')[0];
  const cooling = k.chg28 < 0;
  const mrow = !filtered && bud.find((r) => r.month === per.month && r.hasIncome);
  const daysLeft = Math.max(0, Math.round((Date.UTC(+year, 11, 31) - P(k.end).getTime()) / 864e5));
  const yearEnd = k.net + k.perDay * daysLeft;
  const monthCats = A.categories(rows.filter((r) => r.date.slice(0, 7) === per.month)).filter((c) => c.spend > 0);
  const DCOL = ['var(--d1)', 'var(--d2)', 'var(--d3)', 'var(--d4)', 'var(--d5)'];
  const top = monthCats.slice(0, 4).map((c, i) => ({name: c.category, value: c.spend, color: DCOL[i]}));
  const rest = monthCats.slice(4).reduce((a, c) => a + c.spend, 0);
  if (rest > 0) top.push({name: 'Everything else', value: rest, color: DCOL[4]});
  const monthTotal = top.reduce((a, c) => a + c.value, 0);
  const gap = k.perMonth - per.monthProj;
  const seeMonth = () => { setF({month: per.month}); requestAnimationFrame(() => $('#month-detail')?.scrollIntoView({behavior: 'smooth', block: 'start'})); };

  charts.push(() => heroTrend($('#hero-trend'), A.weekly(rows, wins)));
  charts.push(() => donut($('#where-donut'), top, {center: fmt.k(monthTotal), sub: 'charged', onClick: (d) => d.name !== 'Everything else' && setF({category: f.category === d.name ? '' : d.name})}));

  const arrow = (down) => h('span', {class: 'trend-ico', 'aria-hidden': 'true'}, down ? '↘' : '↗');
  const pace = (cls, label, val, note) => h('div', {class: 'sp-card ' + cls}, h('div', {class: 'sp-label'}, label), h('div', {class: 'sp-num'}, val), h('div', {class: 'sp-note'}, note));
  const spentPct = mrow ? Math.min(1, mrow.cards / Math.max(1, mrow.incoming)) : Math.min(1, per.monthSpend / Math.max(1, k.perMonth));

  return foldable('overview', head, controls,
    h('div', {class: 'sp-grid'},
      h('div', {class: 'sp-hero'},
        h('div', {class: 'sp-hero-text'},
          h('div', {class: 'sp-eyebrow'}, (filtered ? 'Spent in ' + year + ', filtered' : 'Total spent in ' + year)),
          h('div', {class: 'sp-hero-num'}, fmt.usd(k.net)),
          h('p', {class: 'sp-hero-msg'}, h('b', {}, cooling ? 'Nice work. ' : 'Heads up. '),
            cooling ? 'Your spending has cooled down over the last four weeks.' : 'Your spending has picked up over the last four weeks.'),
          h('div', {class: 'sp-pill'}, arrow(cooling), fmt.pct(Math.abs(k.chg28)) + (cooling ? ' below' : ' above') + ' your usual pace')),
        h('div', {class: 'sp-hero-chart', id: 'hero-trend'})),
      h('div', {class: 'sp-month'},
        h('div', {class: 'sp-blob a', 'aria-hidden': 'true'}), h('div', {class: 'sp-blob b', 'aria-hidden': 'true'}),
        h('div', {class: 'sp-eyebrow'}, monthLabel + (per.monthDays < 28 ? ' · ' + per.monthDays + ' days in' : '')),
        h('div', {class: 'sp-month-num'}, fmt.usd(mrow ? mrow.cards : per.monthSpend)),
        h('p', {class: 'sp-month-msg'}, mrow
          ? (mrow.left < 0 ? ['You’ve spent ', h('b', {}, fmt.usd(-mrow.left) + ' more'), ' than this month’s income.'] : ['You have ', h('b', {}, fmt.usd(mrow.left) + ' left'), ' of this month’s income.'])
          : ['On pace for ', h('b', {}, fmt.usd(per.monthProj)), ', ' + fmt.pct(Math.abs(per.monthVs)) + (per.monthVs <= 0 ? ' under' : ' over') + ' a typical month.']),
        h('div', {class: 'sp-bar', role: 'img', 'aria-label': fmt.pct(spentPct) + (mrow ? ' of income spent' : ' of a typical month spent')}, h('span', {style: 'width:' + (spentPct * 100).toFixed(1) + '%'})),
        h('div', {class: 'sp-bar-scale'}, h('span', {}, '$0'), h('span', {}, mrow ? fmt.usd(mrow.incoming) + ' income' : fmt.usd(k.perMonth) + ' typical')),
        h('div', {class: 'sp-week'}, 'This week: ', h('b', {}, fmt.usd(per.weekSpend)), ', ' + fmt.pct(Math.abs(per.weekVs)) + (per.weekVs <= 0 ? ' under' : ' over') + ' a typical ' + (per.weekDays === 7 ? 'week' : per.weekDays + ' days'))),
      pace('mint', 'Weekly pace', fmt.usd(k.perWeek), (cooling ? '↓ Trending lower' : '↑ Trending higher') + ' · last 4 weeks ' + fmt.usd(k.last28)),
      pace('peach', 'Monthly pace', fmt.usd(k.perMonth), 'Based on your daily average'),
      pace('lav', 'Year-end estimate', fmt.usd(yearEnd), daysLeft ? 'If the next ' + daysLeft + ' days follow your usual pace' : 'Full year'),
      h('div', {class: 'sp-where'},
        h('div', {class: 'sp-where-head'}, h('div', {}, h('h3', {}, 'Where it went'), h('p', {class: 'sp-sub'}, 'Your top categories in ' + monthLabel)),
          h('button', {class: 'sp-link', onClick: seeMonth}, 'See details')),
        top.length ? h('div', {class: 'sp-where-body'}, h('div', {class: 'sp-donut', id: 'where-donut'}),
          h('ul', {class: 'sp-cats'}, top.map((c) => h('li', {},
            h('button', {class: 'sp-cat' + (f.category === c.name ? ' on' : ''), disabled: c.name === 'Everything else', onClick: () => setF({category: f.category === c.name ? '' : c.name})},
              h('span', {class: 'dot', style: 'background:' + c.color}), h('span', {class: 'nm'}, c.name), h('span', {class: 'pc'}, fmt.pct(c.value / monthTotal)))))))
          : h('p', {class: 'sp-sub'}, 'No spending this month yet.')),
      h('div', {class: 'sp-tip'},
        h('div', {class: 'sp-tip-ico', 'aria-hidden': 'true'}, '💡'),
        h('h3', {}, gap > 0 ? 'A small shift adds up' : 'Worth a look'),
        h('p', {}, gap > 0
          ? ['If every month went like this one, you’d spend ', h('b', {}, fmt.usd(gap * 12)), ' less over a year than your average so far, which includes big one-offs.']
          : ['This month is on track for ', h('b', {}, fmt.usd(-gap) + ' more'), ' than a typical month. ', monthCats[0] ? 'Your biggest category is ' + monthCats[0].category + ' at ' + fmt.usd(monthCats[0].spend) + '.' : '']),
        h('button', {class: 'sp-btn', onClick: seeMonth}, 'See this month’s spending'))));
}

function budgetSection(bud) {
  const withIncome = bud.filter((r) => r.hasIncome);
  const focus = withIncome.find((r) => r.month === f.budgetMonth) || withIncome[withIncome.length - 1];
  const sel = h('select', {'aria-label': 'Budget month', onChange: (ev) => setF({budgetMonth: ev.target.value})},
    withIncome.slice().reverse().map((r) => h('option', {value: r.month, selected: focus && r.month === focus.month}, monName(r.month))));
  const incomeRows = data.income.slice().sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
  const save = async (msg) => { await persist(msg); renderAll(); };
  const incTable = table([
    {t: 'Month', f: (r) => monName(r.month)}, {t: 'Payment', f: (r) => r.label},
    {t: 'Amount', num: true, f: (r) => d3num(r.amount) + ' ' + r.currency},
    {t: 'Rate', num: true, f: (r) => (r.currency === 'CAD' ? '—' : h('input', {type: 'number', step: '0.0001', min: '0', class: 'rate', value: r.fx, 'aria-label': 'Rate',
      onChange: (ev) => { const v = Number(ev.target.value); if (v > 0) { r.fx = v; save('Rate updated'); } }}))},
    {t: 'In CAD', num: true, f: (r) => fmt.usd2(A.incomeCad(r))},
    {t: 'Status', f: (r) => h('span', {class: 'tag ' + (r.status === 'received' ? 'in' : 'wait')}, r.status === 'received' ? 'Received' + (r.receivedOn ? ' ' + fmt.day(P(r.receivedOn)) : '') : 'Expected')},
    {t: '', num: true, f: (r) => h('div', {class: 'row-actions'},
      h('button', {class: 'btn small' + (r.status === 'received' ? '' : ' primary'), onClick: () => {
        if (r.status === 'received') { r.status = 'expected'; delete r.receivedOn; } else { r.status = 'received'; r.receivedOn = new Date().toLocaleDateString('en-CA'); }
        save(r.status === 'received' ? 'Marked received' : 'Marked not received');
      }}, r.status === 'received' ? 'Mark not received' : 'Mark received'),
      h('button', {class: 'btn small', onClick: (ev) => {
        if (!ev.target.dataset.armed) { ev.target.dataset.armed = '1'; ev.target.textContent = 'Click again to remove'; return; }
        data.income = data.income.filter((x) => x !== r); save('Payment removed');
      }}, 'Remove'))},
  ], incomeRows, {empty: 'No incoming payments yet. Add one below.'});
  const form = h('form', {class: 'form', onSubmit: (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target), amount = Number(fd.get('amount')), currency = fd.get('currency'), fx = currency === 'CAD' ? 1 : Number(fd.get('fx')), month = String(fd.get('month'));
    if (!/^\d{4}-\d{2}$/.test(month) || !(amount > 0) || !(fx > 0)) { toast('Check the month, amount and rate', true); return; }
    data.income.push({id: crypto.randomUUID(), month, label: String(fd.get('label') || 'Payment').slice(0, 80), amount, currency, fx, status: 'expected'});
    save('Payment added');
  }},
    h('label', {class: 'field'}, h('span', {}, 'Payment'), h('input', {name: 'label', value: 'Salary', required: true})),
    h('label', {class: 'field'}, h('span', {}, 'For month'), h('input', {name: 'month', type: 'month', required: true, value: new Date().toLocaleDateString('en-CA').slice(0, 7)})),
    h('label', {class: 'field'}, h('span', {}, 'Amount'), h('input', {name: 'amount', type: 'number', step: '0.01', min: '0', required: true})),
    h('label', {class: 'field'}, h('span', {}, 'Currency'), h('select', {name: 'currency'}, h('option', {value: 'USD'}, 'USD'), h('option', {value: 'CAD'}, 'CAD'))),
    h('label', {class: 'field'}, h('span', {}, 'USD to CAD rate' + (data.settings.fxDate && !data.settings.fxManual ? ' (BoC ' + fmt.day(P(data.settings.fxDate)) + ')' : '')), h('input', {name: 'fx', type: 'number', step: '0.0001', min: '0', value: data.settings.fx})),
    h('button', {class: 'btn primary', type: 'submit'}, 'Add expected payment'));
  charts.push(() => grouped($('#budget-chart'), bud, [['incoming', 'Income (received or expected)', COLORS[0]], ['cards', 'Card spending', COLORS[1]]],
    {ariaLabel: 'Income against card spending by month', picked: focus?.month, onPick: (r) => setF({budgetMonth: r.month})}));
  return section('budget', 'Incoming funds and budget',
    focus ? h('div', {class: 'headrow'},
      h('p', {class: 'take'}, 'In ', h('b', {}, monName(focus.month)), ', ', h('b', {}, fmt.usd(focus.incoming)), ' is coming in (',
        fmt.usd(focus.received) + ' received, ' + fmt.usd(focus.expected) + ' still expected) against ', h('b', {}, fmt.usd(focus.cards)), ' of card spending. That leaves you ',
        good(h('b', {}, fmt.usd(Math.abs(focus.left))), focus.left >= 0), focus.left >= 0 ? ' under' : ' over', ' budget for the month.',
        focus.assumed ? ' No salary is entered for this month yet, so it assumes the same as ' + monName(focus.assumedFrom) + '.' : ''), sel)
      : h('p', {class: 'muted'}, 'Add your salary or other incoming payments below to compare them with each month’s card spending.'),
    incTable, form,
    h('p', {class: 'note'}, 'Card spending is all cards together, whatever the filters above. A payment counts as salary, and carries forward to later months, if its description includes “salary”.'),
    h('h3', {}, 'Income vs. card spending by month'), chart('budget-chart'),
    table([{t: 'Month', f: (r) => monName(r.month)},
      {t: 'Incoming', num: true, f: (r) => fmt.usd(r.incoming) + (r.assumed ? ' (assumed, same as ' + fmt.mon(P(r.assumedFrom + '-01')) + ')' : r.expected ? ' (' + fmt.usd(r.expected) + ' expected)' : '')},
      {t: 'Card spending', num: true, f: (r) => fmt.usd(r.cards)},
      {t: 'Left over', num: true, f: (r) => good(h('span', {}, sign(r.left)), r.left >= 0)}], withIncome.slice().reverse(), {empty: 'No months with income yet.'}));
}
const d3num = (v) => (+v || 0).toLocaleString('en-CA', {minimumFractionDigits: 2, maximumFractionDigits: 2});

function cardsSection(rows, base, wins, k, months) {
  const picked = A.pickMonth(months, f.month);
  const md = picked ? A.monthDetail(rows, base, picked, k) : null;
  const all = cardAccounts(data.cards), keys = all.filter((a) => months.some((r) => r[a]));
  const colorOf = (a) => COLORS[all.indexOf(a) % COLORS.length];
  const cats = A.categories(base);
  const catItems = (list) => list.map((d) => ({name: d.category, value: d.spend, text: fmt.usd(d.spend) + ' · ' + fmt.pct(d.share), dim: f.category && f.category !== d.category,
    tip: [d.category, 'Net spend: ' + fmt.usd(d.spend) + ' (' + fmt.pct(d.share) + ')', d.n + ' transactions', 'Click to ' + (f.category === d.category ? 'clear' : 'filter')]}));
  const toggleCat = (d) => setF({category: f.category === d.name ? '' : d.name});
  const catCell = (r) => pickBtn(r.category, f.category === r.category, () => setF({category: f.category === r.category ? '' : r.category}));
  charts.push(() => stackedMonths($('#monthly-chart'), months, keys, colorOf, {picked, onPick: (r) => setF({month: r.month}), ariaLabel: 'Net card spend per month by card', cards: data.settings.cardArt || {}}));
  charts.push(() => weeklyChart($('#weekly-chart'), A.weekly(rows, wins), k));
  charts.push(() => hbars($('#cats-chart'), catItems(cats), {onClick: toggleCat, ariaLabel: 'Net spend by category'}));
  if (md) charts.push(() => hbars($('#mcats-chart'), catItems(md.cats), {onClick: toggleCat, bh: 16, ariaLabel: 'This month by category'}));
  const monthSel = h('select', {'aria-label': 'Month', onChange: (ev) => setF({month: ev.target.value})}, months.slice().reverse().map((r) => h('option', {value: r.month, selected: r.month === picked}, monName(r.month))));
  const txCols = [{t: 'Date', f: (r) => dateCell(r.date)}, {t: 'Merchant', f: (r) => r.merchant}, {t: 'Category', f: catCell}, {t: 'Card', f: (r) => r.account}, {t: 'Amount', num: true, f: (r) => fmt.usd2(r.spend)}];
  return section('cards', 'Cards',
    h('h3', {}, 'Spend by month, by card'), h('p', {class: 'note'}, 'Click a month to see its spending below.'), chart('monthly-chart'),
    md && h('div', {class: 'sub', id: 'month-detail'},
      h('div', {class: 'headrow'}, h('h3', {}, 'Month detail: ' + monName(md.month)), monthSel),
      h('div', {class: 'cards'},
        h('div', {class: 'card'}, h('div', {class: 'label'}, 'Net spend'), h('div', {class: 'val'}, fmt.usd(md.net)), h('div', {class: 'small'}, md.n + ' transactions')),
        h('div', {class: 'card'}, h('div', {class: 'label'}, 'Vs. a typical month'), good(h('div', {class: 'val'}, fmt.spct(md.vsAvg)), md.vsAvg <= 0), h('div', {class: 'small'}, 'Against the monthly run rate')),
        h('div', {class: 'card'}, h('div', {class: 'label'}, 'Biggest charge'), h('div', {class: 'val'}, md.top ? fmt.usd(md.top.spend) : '—'), h('div', {class: 'small'}, md.top ? md.top.merchant : 'No charges'))),
      h('div', {class: 'two'}, h('div', {}, h('h4', {}, 'By category'), chart('mcats-chart')),
        h('div', {}, h('h4', {}, 'Transactions'), table(txCols.filter((c) => c.t !== 'Card' || !f.account), md.txns, {scroll: true, empty: 'No transactions this month.'})))),
    h('h3', {}, 'Spend by week'), chart('weekly-chart'),
    h('h3', {}, 'Where it goes, by category'), h('p', {class: 'note'}, 'Click a bar or any category name to filter the card figures to it. Click again to clear.'), chart('cats-chart', 'tall'),
    h('div', {class: 'two'},
      h('div', {}, h('h3', {}, 'Top merchants'), table([{t: 'Merchant', f: (r) => r.merchant}, {t: 'Category', f: catCell}, {t: 'Charges', num: true, f: (r) => r.n}, {t: 'Net spend', num: true, f: (r) => fmt.usd2(r.spend)}], A.merchants(rows), {scroll: true})),
      h('div', {}, h('h3', {}, 'One-offs of $500 or more'), table([{t: 'Date', f: (r) => dateCell(r.date)}, {t: 'Merchant', f: (r) => r.merchant}, {t: 'Card', f: (r) => r.account}, {t: 'Amount', num: true, f: (r) => fmt.usd2(r.spend)}], A.bigOnes(data.cards), {scroll: true}))),
    h('h3', {}, 'Latest transactions'), table(txCols.concat([{t: '', f: (r) => (r.status === 'Pending' ? h('span', {class: 'tag wait'}, 'Pending') : '')}]), rows.slice(0, 60), {scroll: true}));
}

function pickList(title, key, rows, cols, empty) {
  const v = f[key];
  return h('div', {class: 'sub'},
    h('div', {class: 'headrow'}, h('h4', {}, 'Transactions: ' + (v || 'pick one above')),
      v && h('span', {class: 'pickchip'}, rows.length + ' transactions, net ' + fmt.usd2(rows.reduce((s, r) => s + r.amount, 0)), h('button', {class: 'btn small', onClick: () => setF({[key]: ''})}, 'Clear'))),
    v ? table(cols, rows, {scroll: true}) : h('p', {class: 'muted'}, empty));
}

function banksSection() {
  const kids = [];
  if (data.chq.length) {
    const s = A.chqSummary(data.chq), dates = data.chq.map((r) => r.date).sort();
    charts.push(() => grouped($('#chq-chart'), A.chqMonthly(data.chq), [['a', 'Money in', COLORS[0]], ['b', 'Money out', COLORS[1]], ['c', 'Card bills', COLORS[2]]], {ariaLabel: 'Wealthsimple chequing by month'}));
    const typeRows = data.chq.filter((r) => r.bucket === f.chqtype).map((r) => ({...r, detail: [r.type, r.subtype, r.payee].filter(Boolean).join(' · ')}));
    kids.push(h('h3', {}, 'Wealthsimple chequing'), h('p', {class: 'note'}, fmt.dayY(P(dates[0])) + ' to ' + fmt.dayY(P(dates[dates.length - 1])) + '. Moves between your own Wealthsimple accounts are left out.'),
      h('div', {class: 'cards'},
        h('div', {class: 'card'}, h('div', {class: 'label'}, 'Card bills paid'), h('div', {class: 'val'}, fmt.usd(s.billsPaid))),
        h('div', {class: 'card'}, h('div', {class: 'label'}, 'Money in'), h('div', {class: 'val'}, fmt.usd(s.moneyIn))),
        h('div', {class: 'card'}, h('div', {class: 'label'}, 'Money out'), h('div', {class: 'val'}, fmt.usd(s.moneyOut))),
        h('div', {class: 'card'}, h('div', {class: 'label'}, 'Interest earned'), h('div', {class: 'val'}, fmt.usd2(s.interest)))),
      chart('chq-chart'),
      table([{t: 'Type', f: (r) => pickBtn(r.bucket, f.chqtype === r.bucket, () => setF({chqtype: f.chqtype === r.bucket ? '' : r.bucket}))}, {t: 'Direction', f: (r) => r.flow}, {t: 'Count', num: true, f: (r) => r.n}, {t: 'Total', num: true, f: (r) => fmt.usd2(r.total)}], A.buckets(data.chq)),
      pickList('', 'chqtype', typeRows, [{t: 'Date', f: (r) => dateCell(r.date)}, {t: 'Details', f: (r) => r.detail}, {t: 'Amount', num: true, f: (r) => fmt.usd2(r.amount)}], 'Click a type in the table above to list its transactions here.'));
  }
  if (data.rbc.length) {
    const dates = data.rbc.map((r) => r.date).sort();
    const typeRows = data.rbc.filter((r) => r.bucket === f.rbctype);
    kids.push(h('h3', {}, 'RBC chequing'), h('p', {class: 'note'}, fmt.dayY(P(dates[0])) + ' to ' + fmt.dayY(P(dates[dates.length - 1])) + '. Moves between your own accounts and loan payments are listed but aren’t spending.'),
      table([{t: 'Type', f: (r) => pickBtn(r.bucket, f.rbctype === r.bucket, () => setF({rbctype: f.rbctype === r.bucket ? '' : r.bucket}))}, {t: 'Direction', f: (r) => r.flow}, {t: 'Count', num: true, f: (r) => r.n}, {t: 'Total', num: true, f: (r) => fmt.usd2(r.total)}], A.buckets(data.rbc, true)),
      pickList('', 'rbctype', typeRows, [{t: 'Date', f: (r) => dateCell(r.date)}, {t: 'Details', f: (r) => r.label}, {t: 'Amount', num: true, f: (r) => fmt.usd2(r.amount)}], 'Click a type in the table above to list its transactions here.'));
  }
  if (!kids.length) kids.push(h('p', {class: 'muted'}, 'Upload a Wealthsimple chequing or RBC file to see this section.'));
  return section('banks', 'Bank accounts', ...kids);
}

function housingSection() {
  if (!data.rbc.length) return section('housing', 'Housing and rental properties', h('p', {class: 'muted'}, 'Upload your RBC chequing file to see this section.'));
  const props = A.properties(data.rbc), hs = A.housing(data.rbc, props);
  const rbcRent = hs.mRent, myRent = data.settings.homeRent;
  if (myRent > 0) { hs.mRent = myRent; hs.mHousing = myRent - hs.mNetRental; }
  const rentInput = h('input', {type: 'number', step: '1', min: '0', value: Math.round(hs.mRent), 'aria-label': 'Your monthly rent', class: 'rent-input'});
  const rentEditor = h('div', {class: 'form rent-form'},
    h('label', {class: 'field'}, h('span', {}, 'Your rent per month'), rentInput),
    h('button', {class: 'btn', onClick: async () => { const v = Number(rentInput.value); if (!(v >= 0)) return; data.settings.homeRent = v; await persist('Rent set to ' + fmt.usd(v)); renderAll(); }}, 'Save rent'),
    myRent > 0 ? h('button', {class: 'linkbtn', onClick: async () => { delete data.settings.homeRent; await persist('Using the rent from RBC again'); renderAll(); }}, 'Use RBC amount (' + fmt.usd(rbcRent) + ')') : h('span', {class: 'note'}, 'Now using ' + fmt.usd(rbcRent) + ', the usual payment in your RBC account.'));
  const items = [{name: 'Rent for your home', value: -hs.mRent, color: COLORS[1], text: '−' + fmt.usd(hs.mRent), tip: ['Rent for your home', fmt.usd(hs.mRent) + ' a month']},
    ...props.map((p) => ({name: p.property + ', net', value: p.mNet, color: COLORS[0], text: sign(p.mNet), tip: [p.property, 'Rent: ' + fmt.usd(p.mIncome), 'Mortgage: ' + fmt.usd(p.mMortgage), ...(p.mFees ? ['Condo fee: ' + fmt.usd(p.mFees)] : []), 'Net: ' + fmt.usd(p.mNet)]})),
    {name: 'What your home costs you', value: -hs.mHousing, color: COLORS[2], text: '−' + fmt.usd(hs.mHousing), tip: ['What your home costs you', 'Rent minus the rentals’ net: ' + fmt.usd(hs.mHousing)]}];
  charts.push(() => hbars($('#htypical'), items, {bh: 22, ariaLabel: 'Housing in a typical month'}));
  charts.push(() => grouped($('#hmonthly'), A.housingMonthly(data.rbc), [['a', 'Rent collected', COLORS[0]], ['b', 'Mortgages and condo fee', COLORS[1]], ['c', 'Rent paid for your home', COLORS[2]]], {ariaLabel: 'Housing by month'}));
  const propRows = data.rbc.filter((r) => r.property === f.prop);
  return section('housing', 'Housing and rental properties',
    h('p', {class: 'take'}, 'Rent for your home is ', h('b', {}, fmt.usd(hs.mRent)), ' a month. After mortgages and the condo fee, the rentals bring in ', h('b', {}, fmt.usd(hs.mNetRental)),
      ' a month, so your home costs you about ', h('b', {}, fmt.usd(hs.mHousing)), ' a month once that’s counted.'),
    rentEditor,
    h('div', {class: 'two'},
      h('div', {}, h('h3', {}, 'A typical month'), chart('htypical', 'short')),
      h('div', {}, h('h3', {}, 'So far this year'), h('div', {class: 'cards'},
        h('div', {class: 'card'}, h('div', {class: 'label'}, 'Rent paid'), h('div', {class: 'val'}, fmt.usd(hs.rentPaid))),
        h('div', {class: 'card'}, h('div', {class: 'label'}, 'Rent collected'), h('div', {class: 'val'}, fmt.usd(hs.rentCollected))),
        h('div', {class: 'card'}, h('div', {class: 'label'}, 'Mortgages and condo fee'), h('div', {class: 'val'}, fmt.usd(hs.propertyCosts))),
        h('div', {class: 'card'}, h('div', {class: 'label'}, 'Net from rentals'), h('div', {class: 'val'}, fmt.usd(hs.netRental)))))),
    h('h3', {}, 'Each property'), h('p', {class: 'note'}, 'Cash flow, not profit: mortgage payments include principal. Click a property to see its transactions.'),
    table([{t: 'Property', f: (r) => pickBtn(r.property, f.prop === r.property, () => setF({prop: f.prop === r.property ? '' : r.property}))},
      {t: 'Rent in', num: true, f: (r) => fmt.usd(r.income)}, {t: 'Mortgage', num: true, f: (r) => fmt.usd(r.mortgage)}, {t: 'Condo fee', num: true, f: (r) => fmt.usd(r.fees)},
      {t: 'Net so far', num: true, f: (r) => fmt.usd(r.net)}, {t: 'Net, typical month', num: true, f: (r) => fmt.usd2(r.mNet)}], props),
    pickList('', 'prop', propRows, [{t: 'Date', f: (r) => dateCell(r.date)}, {t: 'Type', f: (r) => r.bucket}, {t: 'Amount', num: true, f: (r) => fmt.usd2(r.amount)}], 'Click a property in the table above to list its transactions here.'),
    h('h3', {}, 'By month'), chart('hmonthly'));
}


// ---- mortgages --------------------------------------------------------------
const whatIf = {};
const PROPS = ['Logan house', 'Condo'];
function mortgageDialog(m) {
  const isNew = !m;
  const v = m ? {...m} : {name: '', property: '', compound: 'monthly'};
  const err = h('p', {class: 'err'});
  const fields = {};
  const fld = (key, label, attrs = {}) => { fields[key] = h('input', {value: v[key] ?? '', ...attrs}); return h('label', {class: 'field'}, h('span', {}, label), fields[key]); };
  const sel = (key, label, opts) => { fields[key] = h('select', {}, opts.map(([val, t]) => h('option', {value: val, selected: (v[key] ?? '') === val}, t))); return h('label', {class: 'field'}, h('span', {}, label), fields[key]); };
  const paste = h('textarea', {class: 'paste', rows: 5, placeholder: 'Paste your bank’s mortgage page here: select all the text on the page (Cmd+A), copy, and paste.'});
  const fill = () => {
    const got = M.parseMortgageText(paste.value);
    if (!got.balance && !got.payment) { err.textContent = 'Couldn’t find mortgage details in that text.'; return; }
    err.textContent = '';
    for (const [k, val] of Object.entries(got)) if (fields[k]) fields[k].value = val;
    if (got.rateType) fields.compound.value = got.rateType === 'Fixed' ? 'semiannual' : 'monthly';
    toast('Filled in ' + Object.keys(got).length + ' details. Check them, then save.');
  };
  const num = (k) => (fields[k].value === '' ? null : Number(fields[k].value));
  const d = h('dialog', {class: 'dlg wide'},
    h('h2', {}, isNew ? 'Add a mortgage' : 'Update ' + (m.name || 'mortgage')),
    h('p', {class: 'muted'}, 'Paste the mortgage page from your bank to fill everything in, or type the numbers. Only this browser sees them, encrypted with your password.'),
    paste, h('div', {class: 'dlg-actions', style: 'margin-top:8px'}, h('button', {class: 'btn', onClick: fill}, 'Fill in from pasted text')),
    h('div', {class: 'form'},
      fld('name', 'Name', {placeholder: 'e.g. Logan house'}),
      sel('property', 'Rental it belongs to', [['', 'None'], ...PROPS.map((p) => [p, p])]),
      fld('balance', 'Outstanding balance', {type: 'number', step: '0.01'}),
      fld('payment', 'Payment', {type: 'number', step: '0.01'}),
      fld('nextDate', 'Next payment date', {type: 'date'}),
      fld('rate', 'Interest rate %', {type: 'number', step: '0.001'}),
      sel('rateType', 'Rate type', [['Variable', 'Variable'], ['Fixed', 'Fixed']]),
      sel('compound', 'Interest compounds', [['monthly', 'Monthly (RBC variable)'], ['semiannual', 'Twice a year (most fixed)']]),
      fld('maturity', 'Term ends (maturity)', {type: 'date'}),
      fld('original', 'Original balance', {type: 'number', step: '0.01'}),
      fld('bankRemaining', 'Months left, per bank', {type: 'number'}),
      fld('value', 'Home value (optional)', {type: 'number', step: '1000'})),
    err,
    h('div', {class: 'dlg-actions'},
      h('button', {class: 'btn', onClick: () => d.close()}, 'Cancel'),
      h('button', {class: 'btn primary', onClick: async () => {
        const o = {id: v.id || crypto.randomUUID(), name: fields.name.value.trim() || fields.property.value || 'Mortgage', property: fields.property.value,
          balance: num('balance'), payment: num('payment'), nextDate: fields.nextDate.value, rate: num('rate'), rateType: fields.rateType.value, compound: fields.compound.value,
          maturity: fields.maturity.value, original: num('original'), bankRemaining: num('bankRemaining'), value: num('value'), updated: todayISO()};
        if (!(o.balance > 0) || !(o.payment > 0) || !(o.rate >= 0) || !o.nextDate) { err.textContent = 'Fill in the balance, payment, rate and next payment date.'; return; }
        data.mortgages = isNew ? [...data.mortgages, o] : data.mortgages.map((x) => (x.id === o.id ? o : x));
        await persist(isNew ? 'Mortgage added' : 'Mortgage updated'); d.close(); renderAll();
      }}, isNew ? 'Add mortgage' : 'Save')));
  document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal();
}

function mortgagesSection() {
  const list = data.mortgages || [], today = todayISO();
  const addBtn = h('button', {class: 'btn primary', onClick: () => mortgageDialog(null)}, 'Add a mortgage');
  if (!list.length) return section('mortgages', 'Mortgages',
    h('p', {class: 'muted'}, 'Add your mortgages to see what’s left to pay, when each is paid off, what you’ll owe at renewal and how much interest is still to come. The quickest way: open the mortgage page on your bank’s website, copy the whole page and paste it in.'), addBtn);
  const sums = list.map((m) => ({m, s: M.summarize(m, today)}));
  const props = data.rbc.length ? A.properties(data.rbc) : [];
  const total = (f) => sums.reduce((a, x) => a + f(x), 0);
  charts.push(() => lineChart($('#mort-chart'), sums.map(({m, s}, i) => ({name: m.name, color: COLORS[i % COLORS.length],
    points: [{date: m.nextDate, value: m.balance}, ...s.rows.filter((r, j) => j % 3 === 2 || j === s.rows.length - 1).map((r) => ({date: r.date, value: r.balance}))]})),
    {marks: sums.filter(({m}) => m.maturity).map(({m}) => ({date: m.maturity, label: m.name + ' renews'})), ariaLabel: 'Mortgage balances over time'}));
  const card = (label, val, ...small) => h('div', {class: 'card'}, h('div', {class: 'label'}, label), h('div', {class: 'val'}, val), ...small.filter(Boolean).map((x) => h('div', {class: 'small'}, x)));
  const blocks = sums.map(({m, s}) => {
    const w = whatIf[m.id] || (whatIf[m.id] = {rate: m.rate, extra: 0});
    const out = h('p', {class: 'take whatif-out'});
    const runWhatIf = () => {
      const alt = M.summarize(m, today, {rate: w.rate, extra: w.extra});
      out.replaceChildren();
      if (alt.never) { out.append('At that rate the payment no longer covers the interest, so the balance would grow.'); return; }
      const dm = alt.monthsLeft - s.monthsLeft, di = alt.totalInterest - s.totalInterest;
      out.append('Paid off ', h('b', {}, fmt.monY(P(alt.payoff))), ' (', dm === 0 ? 'same time' : M.span(Math.abs(dm)) + (dm < 0 ? ' sooner' : ' later'), '), with ',
        h('b', {}, fmt.usd(alt.totalInterest)), ' of interest still to pay (', good(h('span', {}, (di <= 0 ? fmt.usd(-di) + ' less' : fmt.usd(di) + ' more')), di <= 0), '). ',
        alt.maturity ? 'At renewal you’d owe ' + fmt.usd(alt.maturity.balance) + '.' : '');
    };
    runWhatIf();
    const prop = props.find((p) => p.property === m.property);
    const stale = s.paidSince > 0;
    const yearly = M.byYear(s.rows);
    return h('div', {class: 'sub'},
      h('div', {class: 'headrow'},
        h('h3', {}, m.name, ' ', h('span', {class: 'tag wait'}, (m.rateType || '') + ' ' + m.rate + '%')),
        h('div', {class: 'row-actions'},
          h('span', {class: 'note'}, 'Updated ' + fmt.day(P(m.updated || today))),
          h('button', {class: 'btn small', onClick: () => mortgageDialog(m)}, 'Update'),
          h('button', {class: 'btn small', onClick: (ev) => {
            if (!ev.target.dataset.armed) { ev.target.dataset.armed = '1'; ev.target.textContent = 'Click again to remove'; return; }
            data.mortgages = data.mortgages.filter((x) => x.id !== m.id); persist('Mortgage removed'); renderAll();
          }}, 'Remove'))),
      h('div', {class: 'cards'},
        card(stale ? 'Balance today (estimated)' : 'Balance owing', fmt.usd(s.nowBalance), stale ? s.paidSince + ' payment' + (s.paidSince > 1 ? 's' : '') + ' since you last updated' : null,
          m.original ? fmt.usd(m.original - s.nowBalance) + ' paid down of ' + fmt.usd(m.original) + ' (' + fmt.pct((m.original - s.nowBalance) / m.original) + ')' : null),
        card('Next payment · ' + fmt.day(P(s.next.date)), fmt.usd2(s.next.payment), fmt.usd(s.next.interest) + ' interest, ' + fmt.usd(s.next.principal) + ' to the balance'),
        card('Paid off', s.never ? 'Never' : fmt.monY(P(s.payoff)), s.never ? 'The payment doesn’t cover the interest' : M.span(s.monthsLeft) + ' of payments left',
          m.bankRemaining ? 'Bank says ' + M.span(m.bankRemaining) : null),
        card('Interest still to pay', fmt.usd(s.totalInterest), 'If you keep this rate and payment to the end'),
        s.maturity && card('At renewal · ' + fmt.monY(P(m.maturity)), fmt.usd(s.maturity.balance), 'Owing when the term ends, after ' + s.maturity.payments + ' more payments',
          fmt.usd(s.maturity.interest) + ' interest and ' + fmt.usd(s.maturity.principal) + ' principal until then'),
        m.value ? card('Equity', fmt.usd(m.value - s.nowBalance), fmt.pct((m.value - s.nowBalance) / m.value) + ' of ' + fmt.usd(m.value)) : null),
      prop && h('p', {class: 'note'}, h('b', {}, m.property + ': '), 'typical rent ' + fmt.usd(prop.mIncome) + ' a month, against ' + fmt.usd(m.payment) + ' mortgage' + (prop.mFees ? ' and ' + fmt.usd(prop.mFees) + ' condo fee' : '') +
        ', so ' + fmt.usd(Math.abs(prop.mIncome - m.payment - prop.mFees)) + (prop.mIncome - m.payment - prop.mFees >= 0 ? ' left over' : ' short') + ' in cash. ' +
        'Counting the ' + fmt.usd(s.next.principal) + ' that goes to the balance as savings, it ' + ((prop.mIncome - s.next.interest - prop.mFees) >= 0 ? 'earns ' : 'costs ') + fmt.usd(Math.abs(prop.mIncome - s.next.interest - prop.mFees)) + ' a month before property tax, insurance and repairs.'),
      h('div', {class: 'whatif'},
        h('h4', {}, 'What if'),
        h('div', {class: 'form'},
          h('label', {class: 'field'}, h('span', {}, 'Rate %'), h('input', {type: 'number', step: '0.05', min: '0', value: w.rate, onInput: (ev) => { const x = Number(ev.target.value); if (x >= 0) { w.rate = x; runWhatIf(); } }})),
          h('label', {class: 'field'}, h('span', {}, 'Extra each month'), h('input', {type: 'number', step: '50', min: '0', value: w.extra, onInput: (ev) => { w.extra = Math.max(0, Number(ev.target.value) || 0); runWhatIf(); }}))),
        out),
      h('details', {}, h('summary', {class: 'linkbtn'}, 'Year by year'),
        table([{t: 'Year', f: (r) => r.year}, {t: 'Payments', num: true, f: (r) => r.payments}, {t: 'Interest', num: true, f: (r) => fmt.usd(r.interest)},
          {t: 'Principal', num: true, f: (r) => fmt.usd(r.principal)}, {t: 'Balance at year end', num: true, f: (r) => fmt.usd(r.balance)}], yearly, {scroll: true})));
  });
  return section('mortgages', 'Mortgages',
    h('p', {class: 'take'}, 'You owe ', h('b', {}, fmt.usd(total((x) => x.s.nowBalance))), ' across ' + list.length + (list.length === 1 ? ' mortgage' : ' mortgages') + ', paying ',
      h('b', {}, fmt.usd(total((x) => x.m.payment))), ' a month. Of the next payments, ', h('b', {}, fmt.usd(total((x) => x.s.next.interest))), ' is interest and ',
      h('b', {}, fmt.usd(total((x) => x.s.next.principal))), ' pays down the balance.'),
    h('div', {class: 'headrow'}, h('h3', {}, 'Balance owing over time'), addBtn), chart('mort-chart'),
    h('p', {class: 'note'}, 'Projected with today’s rate and payment. A variable rate will change this. Renewal is when the term ends and the rate is reset.'),
    ...blocks);
}

let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (session) for (const fn of charts) fn(); }, 200); });

if (!window.crypto?.subtle) {
  app.replaceChildren(h('main', {class: 'login'}, h('div', {class: 'login-card'}, h('h1', {}, 'This page needs a secure connection'), h('p', {}, 'Open it over https (GitHub Pages does this) or from localhost.'))));
} else {
  showLogin();
}
