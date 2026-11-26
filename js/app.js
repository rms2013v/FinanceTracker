import * as vault from './vault.js';
import {parseFile, merge, CARD_ACCOUNTS, ACCOUNTS} from './parse.js';
import * as A from './analysis.js';
import {COLORS, fmt, P, monName, stackedMonths, weeklyChart, hbars, grouped} from './charts.js';
import {DEFAULT_FX} from './rules.js';

const XLSX = window.XLSX;
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
const emptyData = () => ({cards: [], chq: [], rbc: [], income: [], uploads: [], settings: {fx: DEFAULT_FX}});
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
  const pw = h('input', {type: 'password', id: 'pw', autocomplete: has ? 'current-password' : 'new-password', required: true, minlength: has ? null : 10, 'aria-label': 'Password'});
  const pw2 = has ? null : h('input', {type: 'password', id: 'pw2', autocomplete: 'new-password', required: true, 'aria-label': 'Repeat password'});
  const btn = h('button', {type: 'submit', class: 'btn primary wide'}, has ? 'Unlock' : 'Create password');
  const form = h('form', {class: 'login-card', onSubmit: async (ev) => {
    ev.preventDefault(); err.textContent = '';
    if (user.value.trim().toLowerCase() !== USERNAME) { err.textContent = has ? 'That username and password don’t match.' : 'Use the username “' + USERNAME + '”.'; pw.value = ''; return; }
    if (!has) {
      if (pw.value.length < 10) { err.textContent = 'Use at least 10 characters.'; return; }
      if (pw.value !== pw2.value) { err.textContent = 'The two passwords don’t match.'; return; }
    }
    btn.disabled = true; btn.textContent = has ? 'Unlocking…' : 'Setting up…';
    try {
      const s = has ? await vault.unlock(pw.value) : {...(await vault.create(pw.value, emptyData())), data: emptyData()};
      pw.value = ''; if (pw2) pw2.value = '';
      start(s);
    } catch (e) {
      err.textContent = e.message === 'wrong-password' ? 'That username and password don’t match.' : 'Something went wrong: ' + e.message;
      btn.disabled = false; btn.textContent = has ? 'Unlock' : 'Create password'; pw.select();
    }
  }},
    h('h1', {class: 'login-title'}, 'Finance dashboard'),
    h('p', {class: 'muted'}, has ? 'Sign in to open your data.' : 'Sign in as ' + USERNAME + ' and set your password. It encrypts everything stored in this browser.'),
    h('label', {class: 'field'}, h('span', {}, 'Username'), user),
    h('label', {class: 'field'}, h('span', {}, 'Password'), pw),
    pw2 && h('label', {class: 'field'}, h('span', {}, 'Repeat password'), pw2),
    !has && h('p', {class: 'note'}, 'There is no way to recover a lost password. Keep it somewhere safe, and download a backup from the menu once your data is in.'),
    err, btn,
    has && h('div', {class: 'login-links'},
      h('button', {type: 'button', class: 'linkbtn', onClick: () => restoreDialog(true)}, 'Restore from a backup file'),
      h('button', {type: 'button', class: 'linkbtn danger', onClick: forgetDialog}, 'Forgot password? Start over')),
    !has && h('div', {class: 'login-links'}, h('button', {type: 'button', class: 'linkbtn', onClick: () => restoreDialog(true)}, 'I have a backup file')),
  );
  app.replaceChildren(h('main', {class: 'login'}, form));
  user.focus();
}

function forgetDialog() {
  const d = h('dialog', {class: 'dlg'},
    h('h2', {}, 'Start over?'),
    h('p', {}, 'This deletes the encrypted data saved in this browser. Without your password it can’t be opened, so it can’t be recovered either. You can then set a new password and upload your files again, or restore a backup if you remember its password.'),
    h('div', {class: 'dlg-actions'},
      h('button', {class: 'btn', onClick: () => d.close()}, 'Cancel'),
      h('button', {class: 'btn danger', onClick: async () => { await vault.wipe(); d.close(); showLogin(); }}, 'Delete and start over')));
  document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal();
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
function start(s) { session = {key: s.key, salt: s.salt, iter: s.iter}; data = normalize(s.data); bumpIdle(); renderShell(); }
function lock(msg) { session = null; data = null; clearTimeout(idleTimer); document.querySelectorAll('dialog').forEach((d) => d.remove()); showLogin(); if (msg) toast(msg); }

// ---- uploads --------------------------------------------------------------
function readFile(file) {
  return /\.(csv|txt)$/i.test(file.name) ? file.text() : file.arrayBuffer().then((b) => new Uint8Array(b));
}
function uploadDialog(initial) {
  let items = [];
  const list = h('div', {class: 'upl-list'});
  const confirm = h('button', {class: 'btn primary', disabled: true}, 'Add to dashboard');
  const input = h('input', {type: 'file', multiple: true, accept: '.csv,.xlsx,.xls,.txt', id: 'upl-input', class: 'sr-only'});
  const drop = h('label', {class: 'drop', for: 'upl-input'}, h('strong', {}, 'Choose files'), ' or drop them here', h('br'),
    h('span', {class: 'muted'}, 'Wealthsimple card and chequing CSV, Amex Aeroplan and Delta SkyMiles Excel, RBC CSV, or a CSV of extra card transactions (Date, Description, Amount).'));
  const draw = () => {
    list.replaceChildren(...items.map((it, i) => {
      const b = it.batch;
      const row = h('div', {class: 'upl-item' + (b.error ? ' is-err' : '')},
        h('div', {class: 'upl-name'}, it.file.name),
        b.error ? h('div', {class: 'err'}, b.error) : h('div', {class: 'upl-meta'},
          b.label, ' · ', b.rows.length + ' transactions · ', b.from ? fmt.day(P(b.from)) + ' to ' + fmt.dayY(P(b.to)) : 'no dates',
          ' · ', b.mode === 'replace' ? 'replaces this account’s data for those dates' : 'adds only new transactions'),
        it.amex && h('label', {class: 'upl-card'}, 'Card: ', h('select', {onChange: async (ev) => { it.card = ev.target.value; it.batch = parseFile(XLSX, it.file.name, it.raw, {card: it.card, fx: data.settings.fx}); draw(); }},
          h('option', {value: 'aeroplan', selected: it.card === 'aeroplan'}, 'Amex Aeroplan Reserve (CAD)'),
          h('option', {value: 'delta', selected: it.card === 'delta'}, 'Delta SkyMiles (USD)'))),
        h('button', {class: 'linkbtn', onClick: () => { items.splice(i, 1); draw(); }}, 'Remove'));
      return row;
    }));
    confirm.disabled = !items.some((it) => !it.batch.error && it.batch.rows.length);
  };
  const add = async (files) => {
    for (const file of files) {
      try {
        const raw = await readFile(file);
        const batch = parseFile(XLSX, file.name, raw, {fx: data.settings.fx});
        const amex = !batch.error && batch.kind === 'cards' && batch.account !== ACCOUNTS.ws;
        items.push({file, raw, batch, amex, card: amex ? (batch.account === ACCOUNTS.delta ? 'delta' : 'aeroplan') : null});
      } catch (e) { items.push({file, batch: {error: 'Couldn’t read this file: ' + e.message}}); }
    }
    draw();
  };
  input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
  drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (ev) => { ev.preventDefault(); drop.classList.remove('over'); add([...ev.dataTransfer.files]); });
  confirm.addEventListener('click', async () => {
    const count = () => data.cards.length + data.chq.length + data.rbc.length;
    const before = count();
    for (const it of items) {
      if (it.batch.error || !it.batch.rows.length) continue;
      data = merge(data, it.batch);
      data.uploads.unshift({name: it.file.name, label: it.batch.label, rows: it.batch.rows.length, from: it.batch.from, to: it.batch.to, at: new Date().toISOString()});
    }
    data.uploads = data.uploads.slice(0, 50);
    const n = count() - before;
    await persist(n > 0 ? n + ' new transactions added' : 'No new transactions. Everything was already in.');
    d.close(); renderAll();
  });
  const d = h('dialog', {class: 'dlg wide'},
    h('h2', {}, 'Upload files'),
    h('p', {class: 'muted'}, 'Files are read here in your browser. Nothing is sent anywhere.'),
    input, drop, list,
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
function settingsDialog() {
  const oldPw = h('input', {type: 'password', autocomplete: 'current-password'}), newPw = h('input', {type: 'password', autocomplete: 'new-password'}), newPw2 = h('input', {type: 'password', autocomplete: 'new-password'});
  const msg = h('p', {class: 'err'});
  const fx = h('input', {type: 'number', step: '0.0001', min: '0', value: data.settings.fx});
  const d = h('dialog', {class: 'dlg wide'},
    h('h2', {}, 'Settings'),
    h('h3', {}, 'Change password'),
    h('div', {class: 'form'},
      h('label', {class: 'field'}, h('span', {}, 'Current password'), oldPw),
      h('label', {class: 'field'}, h('span', {}, 'New password'), newPw),
      h('label', {class: 'field'}, h('span', {}, 'Repeat new password'), newPw2),
      h('button', {class: 'btn', onClick: async () => {
        msg.textContent = '';
        if (newPw.value.length < 10) { msg.textContent = 'Use at least 10 characters.'; return; }
        if (newPw.value !== newPw2.value) { msg.textContent = 'The new passwords don’t match.'; return; }
        try { await persist(); const s = await vault.changePassword(oldPw.value, newPw.value); session = {key: s.key, salt: s.salt, iter: s.iter}; toast('Password changed. Download a new backup: old backups still use the old password.'); d.close(); }
        catch (e) { msg.textContent = e.message === 'wrong-password' ? 'The current password is wrong.' : e.message; }
      }}, 'Change password')),
    msg,
    h('h3', {}, 'Default USD to CAD rate'),
    h('p', {class: 'muted'}, 'Used for new USD salary entries, and for Delta months with no CAD-priced charge to read a rate from.'),
    h('div', {class: 'form'}, h('label', {class: 'field'}, h('span', {}, 'Rate'), fx),
      h('button', {class: 'btn', onClick: async () => { const v = Number(fx.value); if (v > 0) { data.settings.fx = v; await persist('Rate saved'); } }}, 'Save rate')),
    h('h3', {}, 'Uploads'),
    data.uploads.length ? h('div', {class: 'tablewrap scroll short'}, h('table', {class: 'table'},
      h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'File'), h('th', {}, 'Type'), h('th', {class: 'num'}, 'Rows'), h('th', {}, 'Dates'))),
      h('tbody', {}, data.uploads.map((u) => h('tr', {}, h('td', {}, new Date(u.at).toLocaleString()), h('td', {}, u.name), h('td', {}, u.label), h('td', {class: 'num'}, u.rows), h('td', {}, u.from ? u.from + ' to ' + u.to : '')))))) : h('p', {class: 'muted'}, 'No uploads yet.'),
    h('h3', {}, 'Delete everything'),
    h('p', {class: 'muted'}, 'Removes all data from this browser. Download a backup first if you may want it back.'),
    h('button', {class: 'btn danger', onClick: async () => { if (!window.confirm('Delete all data in this browser?')) return; await vault.wipe(); d.close(); lock('All data deleted'); }}, 'Delete all data'),
    h('div', {class: 'dlg-actions'}, h('button', {class: 'btn primary', onClick: () => d.close()}, 'Done')));
  document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal();
}

// ---- page shell -------------------------------------------------------------
function renderShell() {
  const menu = h('details', {class: 'menu'}, h('summary', {class: 'btn'}, 'Menu'),
    h('div', {class: 'menu-pop'},
      h('button', {onClick: (ev) => { ev.target.closest('details').open = false; downloadBackup(); }}, 'Download backup'),
      h('button', {onClick: (ev) => { ev.target.closest('details').open = false; restoreDialog(false); }}, 'Restore a backup'),
      h('button', {onClick: (ev) => { ev.target.closest('details').open = false; settingsDialog(); }}, 'Settings')));
  app.replaceChildren(
    h('header', {class: 'top'},
      h('div', {class: 'brand'}, h('strong', {}, 'Finance dashboard'), h('span', {class: 'muted', id: 'range'})),
      h('nav', {class: 'nav'}, ['overview:Overview', 'budget:Budget', 'cards:Cards', 'banks:Bank accounts', 'housing:Housing'].map((s) => { const [id, t] = s.split(':'); return h('a', {href: '#' + id}, t); })),
      h('div', {class: 'actions'},
        h('button', {class: 'btn primary', onClick: () => uploadDialog()}, 'Upload files'), menu,
        h('button', {class: 'btn', onClick: () => lock()}, 'Lock'))),
    h('main', {class: 'wrap', id: 'main'}));
  document.addEventListener('dragover', (ev) => { if (session && ev.dataTransfer?.types?.includes('Files')) ev.preventDefault(); });
  document.addEventListener('drop', (ev) => { if (!session || $('dialog[open]')) return; ev.preventDefault(); if (ev.dataTransfer.files.length) uploadDialog([...ev.dataTransfer.files]); });
  renderAll();
}

function section(id, title, ...kids) { return h('section', {class: 'sec', id}, h('h2', {class: 'sec-title'}, title), ...kids); }
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
    overview(k, per, bud),
    budgetSection(bud),
    cardsSection(rows, base, wins, k, months),
    banksSection(),
    housingSection(),
    h('details', {class: 'foot'}, h('summary', {}, 'How these numbers are worked out'),
      h('p', {}, 'Card payments are left out, so card figures count only charges and refunds, with refunds netted against their category. Run rates take each card’s net spend over its own date range and add them up. Delta SkyMiles is billed in USD and turned into CAD at each month’s rate, read from charges that statement also priced in CAD.'),
      h('p', {}, 'A one-off is any charge or refund of $500 or more. A month with no salary entered assumes the latest payment whose description includes “salary”. Housing amounts come from your RBC chequing using the rules in js/rules.js.')));
  for (const fn of charts) fn();
  window.scrollTo(0, scrollY);
}

function overview(k, per, bud) {
  const cardsSel = h('select', {'aria-label': 'Card', onChange: (ev) => setF({account: ev.target.value})},
    h('option', {value: ''}, 'All cards'), CARD_ACCOUNTS.filter((a) => data.cards.some((r) => r.account === a)).map((a) => h('option', {value: a, selected: f.account === a}, a)));
  const groups = [...new Set(data.cards.map((r) => r.group))].sort();
  const groupSel = h('select', {'aria-label': 'Category group', onChange: (ev) => setF({group: ev.target.value, category: ''})},
    h('option', {value: ''}, 'All category groups'), groups.map((g) => h('option', {value: g, selected: f.group === g}, g)));
  const big = h('label', {class: 'check'}, h('input', {type: 'checkbox', checked: f.big, onChange: (ev) => setF({big: ev.target.checked})}), ' Leave out one-offs of $500 or more');
  const pick = f.category ? h('span', {class: 'pickchip'}, 'Category: ' + f.category, h('button', {class: 'btn small', onClick: () => setF({category: ''})}, 'Clear')) : null;
  const mrow = per && bud.find((r) => r.month === per.month && r.hasIncome);
  const card = (label, val, ...small) => h('div', {class: 'card'}, h('div', {class: 'label'}, label), h('div', {class: 'val'}, val), ...small.filter(Boolean).map((s) => h('div', {class: 'small'}, s)));
  return h('section', {class: 'sec', id: 'overview'},
    h('h1', {class: 'page-title'}, 'Spending, 2026 to date'),
    k && h('p', {class: 'take'}, 'Net card spend is ', h('b', {}, fmt.usd(k.net)), ' so far, a run rate of about ', h('b', {}, fmt.usd(k.perWeek)), ' a week or ', h('b', {}, fmt.usd(k.perMonth)),
      ' a month. The last 4 weeks came in ', h('b', {}, fmt.pct(Math.abs(k.chg28))), k.chg28 >= 0 ? ' above' : ' below', ' that pace.'),
    h('div', {class: 'controls'}, cardsSel, groupSel, big, pick, h('button', {class: 'btn small', onClick: () => setF({account: '', group: '', big: false, category: ''})}, 'Reset filters')),
    k ? h('div', {class: 'cards'},
      card('This month · ' + fmt.day(P(per.monthStart)) + '–' + P(per.end).getUTCDate(), fmt.usd(per.monthSpend),
        h('span', {}, 'On pace for ' + fmt.usd(per.monthProj) + ', ', good(h('span', {}, fmt.spct(per.monthVs)), per.monthVs <= 0), ' vs. a typical month'),
        mrow && good(h('span', {}, (mrow.left >= 0 ? fmt.usd(mrow.left) + ' left of' : fmt.usd(-mrow.left) + ' over') + ' this month’s income'), mrow.left >= 0)),
      card('This week · ' + fmt.day(P(per.weekStart)) + (per.weekDays > 1 ? '–' + fmt.day(P(per.end)) : ''), fmt.usd(per.weekSpend),
        h('span', {}, good(h('span', {}, fmt.spct(per.weekVs)), per.weekVs <= 0), ' vs. a typical ' + (per.weekDays === 7 ? 'week' : per.weekDays + ' days'))),
      card('Net spend', fmt.usd(k.net), fmt.usd(k.gross) + ' charged, ' + fmt.usd(k.refunds) + ' back as refunds'),
      card('Run rate per week', fmt.usd(k.perWeek), 'Each card’s spend over its own date range'),
      card('Run rate per month', fmt.usd(k.perMonth), 'Daily rate × 365 ÷ 12'),
      card('Last 4 weeks', fmt.usd(k.last28), h('span', {}, good(h('span', {}, fmt.spct(k.chg28)), k.chg28 <= 0), ' vs. a typical 4 weeks')),
      card('Full-year pace', fmt.usd(k.projYear), 'Daily rate × 365'))
      : h('p', {class: 'muted'}, 'No card data matches these filters.'));
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
    h('label', {class: 'field'}, h('span', {}, 'USD to CAD rate'), h('input', {name: 'fx', type: 'number', step: '0.0001', min: '0', value: data.settings.fx})),
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
  const keys = CARD_ACCOUNTS.filter((a) => months.some((r) => r[a]));
  const colorOf = (a) => COLORS[CARD_ACCOUNTS.indexOf(a) % COLORS.length];
  const cats = A.categories(base);
  const catItems = (list) => list.map((d) => ({name: d.category, value: d.spend, text: fmt.usd(d.spend) + ' · ' + fmt.pct(d.share), dim: f.category && f.category !== d.category,
    tip: [d.category, 'Net spend: ' + fmt.usd(d.spend) + ' (' + fmt.pct(d.share) + ')', d.n + ' transactions', 'Click to ' + (f.category === d.category ? 'clear' : 'filter')]}));
  const toggleCat = (d) => setF({category: f.category === d.name ? '' : d.name});
  const catCell = (r) => pickBtn(r.category, f.category === r.category, () => setF({category: f.category === r.category ? '' : r.category}));
  charts.push(() => stackedMonths($('#monthly-chart'), months, keys, colorOf, {picked, onPick: (r) => setF({month: r.month}), ariaLabel: 'Net card spend per month by card'}));
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
  const items = [{name: 'Rent for your home', value: -hs.mRent, color: COLORS[1], text: '−' + fmt.usd(hs.mRent), tip: ['Rent for your home', fmt.usd(hs.mRent) + ' a month']},
    ...props.map((p) => ({name: p.property + ', net', value: p.mNet, color: COLORS[0], text: sign(p.mNet), tip: [p.property, 'Rent: ' + fmt.usd(p.mIncome), 'Mortgage: ' + fmt.usd(p.mMortgage), ...(p.mFees ? ['Condo fee: ' + fmt.usd(p.mFees)] : []), 'Net: ' + fmt.usd(p.mNet)]})),
    {name: 'What your home costs you', value: -hs.mHousing, color: COLORS[2], text: '−' + fmt.usd(hs.mHousing), tip: ['What your home costs you', 'Rent minus the rentals’ net: ' + fmt.usd(hs.mHousing)]}];
  charts.push(() => hbars($('#htypical'), items, {bh: 22, ariaLabel: 'Housing in a typical month'}));
  charts.push(() => grouped($('#hmonthly'), A.housingMonthly(data.rbc), [['a', 'Rent collected', COLORS[0]], ['b', 'Mortgages and condo fee', COLORS[1]], ['c', 'Rent paid for your home', COLORS[2]]], {ariaLabel: 'Housing by month'}));
  const propRows = data.rbc.filter((r) => r.property === f.prop);
  return section('housing', 'Housing and rental properties',
    h('p', {class: 'take'}, 'Rent for your home is ', h('b', {}, fmt.usd(hs.mRent)), ' a month. After mortgages and the condo fee, the rentals bring in ', h('b', {}, fmt.usd(hs.mNetRental)),
      ' a month, so your home costs you about ', h('b', {}, fmt.usd(hs.mHousing)), ' a month once that’s counted.'),
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

let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (session) for (const fn of charts) fn(); }, 200); });

if (!window.crypto?.subtle) {
  app.replaceChildren(h('main', {class: 'login'}, h('div', {class: 'login-card'}, h('h1', {}, 'This page needs a secure connection'), h('p', {}, 'Open it over https (GitHub Pages does this) or from localhost.'))));
} else {
  showLogin();
}
