// Reads bank and card exports in the browser and turns them into rows for the dashboard.
import {GROUP_OF, AMEX_RULES, DELTA_RULES, WS_BUSINESS, HOUSING, DEFAULT_FX} from './rules.js?v=202611261401';

export const ACCOUNTS = {
  ws: 'Wealthsimple',
  aeroplan: 'Amex Aeroplan',
  delta: 'Delta SkyMiles (USD)',
};
export const CARD_ACCOUNTS = [ACCOUNTS.ws, ACCOUNTS.aeroplan, ACCOUNTS.delta];
// Every card in the data: the three known ones first, then any added with AI.
export function cardAccounts(cards) {
  const have = new Set(cards.map((r) => r.account));
  return [...CARD_ACCOUNTS.filter((a) => have.has(a)), ...[...have].filter((a) => !CARD_ACCOUNTS.includes(a)).sort()];
}

// Turns rows read with AI into card rows. merchants maps a merchant key to {name, category}.
export function aiCardBatch(raw, {account, currency, fx, keyOf, merchants, fileLabel, mode = 'replace'}) {
  const rate = currency === 'CAD' ? 1 : (+fx || DEFAULT_FX);
  const rows = raw.map((r) => {
    const m = merchants[keyOf(r.desc)] || {name: title(r.desc).slice(0, 60), category: 'Uncategorized'};
    const row = {date: r.date, account, merchant: m.name, category: m.category, group: GROUP_OF[m.category] || 'Other',
      type: r.charge > 0 ? 'Purchase' : 'Refund', spend: Math.round(r.charge * rate * 100) / 100};
    if (currency !== 'CAD') { row.usd = r.charge; row.fx = rate; }
    return row;
  });
  return {kind: 'cards', account, mode, label: fileLabel || account + ' (read with AI)',
    rows: withIds(rows, 'x', (r) => [r.account, r.date, r.spend, r.merchant].join('|')), ...span(rows)};
}

const MONTHS = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
const pad = (n) => String(n).padStart(2, '0');

export function num(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]|CAD|USD/gi, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

// Accepts 2026-11-20, 20 Nov 2026, 11/20/2026 (US order) and Excel serial numbers.
export function isoDate(v, order = 'mdy') {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]*(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) {
    let [d, mo] = order === 'dmy' ? [+m[1], +m[2]] : [+m[2], +m[1]];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${m[3]}-${pad(mo)}-${pad(d)}` : '';
  }
  return '';
}

const title = (s) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
const cleanDesc = (s) => String(s ?? '').replace(/\s{2,}.*$/, '').trim();
const firstMatch = (rules, desc) => { for (const [re, cat] of rules) if (re.test(desc)) return cat; return 'Uncategorized'; };

function amexName(desc) {
  if (/^(AMAZON|AMZN)/.test(desc) && !desc.includes('PRIME')) return 'Amazon';
  if (desc.startsWith('MICROSOFT')) return 'Microsoft';
  if (desc.startsWith('SQSP')) return 'Squarespace';
  if (desc.startsWith('AIRBNB')) return 'Airbnb';
  if (/^(AIR CANADA|AIRCANADA)/.test(desc)) return 'Air Canada';
  if (/^(SIXT|PRICELN\*EUROPCAR|3CPAYMENT\*EUROPCAR)/.test(desc)) return 'Sixt / Europcar';
  if (/^(UHAUL|U-HAUL)/.test(desc)) return 'U-Haul';
  return title(desc);
}
function deltaName(desc) {
  const n = desc.replace(/^AplPay /, '');
  for (const [k, v] of [['KINDLE', 'Kindle'], ['ANTHROPIC', 'Anthropic (Claude)'], ['CLAUDE.AI', 'Anthropic (Claude)'], ['MANIFEST LEGAL', 'Manifest Legal Services'], ['Interest Charge', 'Interest charge']]) {
    if (n.startsWith(k)) return v;
  }
  return title(n);
}

// Stable ids: the same transaction gets the same id when a file is uploaded again.
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function withIds(rows, prefix, keyFn) {
  const seen = new Map();
  return rows.map((r) => {
    const k = keyFn(r), n = (seen.get(k) || 0) + 1; seen.set(k, n);
    return {...r, id: prefix + hash(k + '#' + n)};
  });
}
function span(rows) {
  const ds = rows.map((r) => r.date).filter(Boolean).sort();
  return {from: ds[0] || '', to: ds[ds.length - 1] || ''};
}

// ---- reading files -------------------------------------------------------

export function readTable(XLSX, name, data) {
  const isCsv = /\.(csv|txt)$/i.test(name);
  const wb = isCsv ? XLSX.read(data, {type: 'string', raw: true}) : XLSX.read(data, {type: 'array'});
  return wb.SheetNames.map((sn) => ({name: sn, rows: XLSX.utils.sheet_to_json(wb.Sheets[sn], {header: 1, raw: true, defval: ''})}));
}

function objects(rows, headerIdx) {
  const head = rows[headerIdx].map((h) => String(h).trim());
  return rows.slice(headerIdx + 1).filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const findHeader = (rows, need) => rows.findIndex((r) => { const s = r.map((c) => String(c).trim()); return need.every((n) => s.includes(n)); });

// Works out what a file is. Returns a batch, or {error}.
export function parseFile(XLSX, name, data, opts = {}) {
  const sheets = readTable(XLSX, name, data);
  for (const sh of sheets) {
    const rows = sh.rows;
    let h = findHeader(rows, ['transaction_date', 'merchant', 'category']);
    if (h >= 0) return wsCard(objects(rows, h));
    h = findHeader(rows, ['transaction_date', 'account_type', 'transaction_type']);
    if (h >= 0) return wsChequing(objects(rows, h));
    h = findHeader(rows, ['Account Type', 'Description 1', 'CAD$']);
    if (h >= 0) return rbc(objects(rows, h));
    h = findHeader(rows, ['Date', 'Description', 'Amount']);
    if (h >= 0) {
      const objs = objects(rows, h).filter((o) => String(o.Date).trim());
      const sample = objs.map((o) => String(o.Date).trim()).find(Boolean) || '';
      const guess = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(sample) ? 'delta' : 'aeroplan';
      const card = opts.card || guess;
      const isStatement = sheets.length > 1 || /transaction details/i.test(sh.name) || !isCsvName(name);
      return card === 'delta' ? delta(objs, opts.fx, isStatement) : aeroplan(objs, isStatement);
    }
  }
  return {error: 'This file doesn’t look like a Wealthsimple, Amex or RBC export.'};
}
const isCsvName = (n) => /\.(csv|txt)$/i.test(n);

// ---- each kind of file ---------------------------------------------------

function wsCard(objs) {
  const rows = objs.filter((o) => ['Purchase', 'Refund'].includes(String(o.transaction_type).trim())).map((o) => {
    const category = String(o.category || 'Uncategorized').trim();
    return {date: isoDate(o.transaction_date), account: ACCOUNTS.ws, merchant: String(o.merchant || '').trim() || 'Unknown',
      category, group: GROUP_OF[category] || 'Other', type: String(o.transaction_type).trim(),
      status: String(o.status || '').trim(), spend: Math.round(-num(o.amount) * 100) / 100};
  }).filter((r) => r.date && Number.isFinite(r.spend));
  return {kind: 'cards', account: ACCOUNTS.ws, mode: 'replace', label: 'Wealthsimple credit card',
    rows: withIds(rows, 'w', (r) => [r.account, r.date, r.spend, r.merchant].join('|')), ...span(rows)};
}

function aeroplan(objs, isStatement) {
  const rows = [];
  for (const o of objs) {
    const desc = cleanDesc(o.Description), amt = num(o.Amount), date = isoDate(o.Date, 'dmy');
    if (!date || !Number.isFinite(amt) || amt === 0 || desc.startsWith('PAYMENT RECEIVED')) continue;
    const category = firstMatch(AMEX_RULES, desc);
    rows.push({date, account: ACCOUNTS.aeroplan, merchant: amexName(desc), category, group: GROUP_OF[category] || 'Other',
      type: amt > 0 ? 'Purchase' : 'Refund', spend: Math.round(amt * 100) / 100});
  }
  return {kind: 'cards', account: ACCOUNTS.aeroplan, mode: isStatement ? 'replace' : 'append', label: 'Amex Aeroplan Reserve (CAD)',
    rows: withIds(rows, 'a', (r) => [r.account, r.date, r.spend, r.merchant].join('|')), ...span(rows)};
}

// Delta is billed in USD. Each month's rate comes from charges the statement also priced in CAD.
function delta(objs, fxFallback, isStatement) {
  const imp = new Map();
  const items = [];
  for (const o of objs) {
    const desc = cleanDesc(o.Description), usd = num(o.Amount), date = isoDate(o.Date, 'mdy');
    if (!date || !Number.isFinite(usd)) continue;
    const text = Object.values(o).map(String).join(' ');
    const m = text.match(/Foreign Spend Amount:\s*([\d,.]+)\s*CANADIAN/i);
    if (m && usd) { const k = date.slice(0, 7); if (!imp.has(k)) imp.set(k, []); imp.get(k).push(num(m[1]) / usd); }
    if (usd === 0 || desc.startsWith('ONLINE PAYMENT')) continue;
    items.push({desc, usd, date});
  }
  const known = new Map([...imp].map(([k, v]) => [k, v.sort((a, b) => a - b)[Math.floor(v.length / 2)]]));
  const monthIdx = (k) => +k.slice(0, 4) * 12 + +k.slice(5, 7);
  const rateFor = (k) => {
    if (known.has(k)) return known.get(k);
    let best = null, bd = Infinity;
    for (const [kk, v] of known) { const d = Math.abs(monthIdx(kk) - monthIdx(k)); if (d < bd) { bd = d; best = v; } }
    return best ?? fxFallback ?? DEFAULT_FX;
  };
  const rows = items.map(({desc, usd, date}) => {
    const fx = rateFor(date.slice(0, 7)), category = firstMatch(DELTA_RULES, desc);
    return {date, account: ACCOUNTS.delta, merchant: deltaName(desc), category, group: GROUP_OF[category] || 'Other',
      type: usd > 0 ? 'Purchase' : 'Refund', spend: Math.round(usd * fx * 100) / 100, usd: Math.round(usd * 100) / 100, fx: Math.round(fx * 10000) / 10000};
  });
  return {kind: 'cards', account: ACCOUNTS.delta, mode: isStatement ? 'replace' : 'append', label: 'Delta SkyMiles (USD, shown in CAD)',
    rows: withIds(rows, 'd', (r) => [r.account, r.date, r.usd, r.merchant].join('|')), ...span(rows), rates: Object.fromEntries(known)};
}

function wsBucket(t, s, p) {
  if (t === 'Credit Card Payment') return 'Wealthsimple card bill';
  if (p === 'Amex aeroplan') return 'Amex Aeroplan bill';
  if (p === 'NEO MC') return 'Neo Mastercard bill';
  if (t === 'Withdrawal' && s === 'Eft') return 'EFT out';
  if (t === 'Withdrawal') return 'Other payments out';
  if (t === 'Deposit' && s === 'Aft') return 'Transfers in from other banks (AFT)';
  if (t === 'Deposit' && s === 'E Transfer') return 'E-transfers in';
  if (t === 'Deposit' && s === 'Eft') return 'EFT in';
  if (t === 'Interest') return 'Interest';
  if (t === 'Reimbursement' || t === 'Promotion') return 'Cashback and bonuses';
  return 'Other money in';
}
function wsChequing(objs) {
  // Moves between your own Wealthsimple accounts are left out: single moves of over $1M would swamp everything else.
  const rows = objs.filter((o) => String(o.status).trim() === 'Completed' && String(o.transaction_type).trim() !== 'Internal Transfer').map((o) => {
    const t = String(o.transaction_type).trim(), s = String(o.transaction_sub_type || '').trim(), p = String(o.payee || '').trim(), amount = num(o.amount);
    const bucket = wsBucket(t, s, p);
    return {date: isoDate(o.transaction_date), type: t, subtype: s, payee: WS_BUSINESS[p] || '', bucket,
      flow: amount > 0 ? 'In' : 'Out', amount: Math.round(amount * 100) / 100, cardBill: bucket.endsWith(' bill')};
  }).filter((r) => r.date && Number.isFinite(r.amount));
  return {kind: 'chq', account: 'Wealthsimple chequing', mode: 'replace', label: 'Wealthsimple chequing',
    rows: withIds(rows, 'c', (r) => [r.date, r.amount, r.type, r.subtype].join('|')), ...span(rows)};
}

function rbcClassify(desc, a) {
  const D = desc.toUpperCase(), H = HOUSING;
  if (D.startsWith('MOBILE CHEQUE DEPOSIT') && a === H.houseRentCheque) return ['Rent collected: Logan house', 'Logan house', 'income', false, 'Rent cheque'];
  if (D.startsWith('MOBILE CHEQUE DEPOSIT') && a === H.condoRentCheque) return ['Rent collected: condo', 'Condo', 'income', false, 'Rent cheque'];
  if (D.includes(H.homeRentText)) return ['Rent paid for your home', '', 'rent', false, 'Royal LePage rent'];
  if (D === 'MORTGAGE PAYMENT' && Math.abs(a + H.condoMortgage) < 0.01) return ['Condo mortgage', 'Condo', 'mortgage', false, 'Mortgage payment'];
  if (D === 'MORTGAGE PAYMENT') return ['Logan house mortgage', 'Logan house', 'mortgage', false, 'Mortgage payment'];
  if (D.includes(H.condoFeeText)) return ['Condo maintenance fee', 'Condo', 'fee', false, 'Forest Hill Res'];
  for (const [k, lab] of [['ENBRIDGE', 'Enbridge Gas'], ['TORONTO HYDRO', 'Toronto Hydro'], ['B.C. HYDRO', 'BC Hydro'], ['FORTIS', 'FortisBC'], ['W. VANCOUVER UT', 'West Vancouver utilities']]) {
    if (D.includes(k)) return ['Utilities', '', '', false, lab];
  }
  if (D.includes('CITY OF TORONTO')) return ['City of Toronto bill', '', '', false, 'City of Toronto'];
  for (const [k, lab] of [['BELAIR', 'Belair insurance'], ['ICBC', 'ICBC'], ['TRUPANION', 'Trupanion pet insurance']]) {
    if (D.includes(k)) return ['Insurance', '', '', false, lab];
  }
  if (D.includes('VW CREDIT')) return ['Car payments', '', '', false, 'VW Credit'];
  if (D.includes('TESLA CANADA')) return ['Car payments', '', '', false, 'Tesla car payment'];
  if (D.includes('CCRA')) return ['Taxes (CRA)', '', '', false, 'CRA'];
  if (D.includes('AMEX CARDS')) return ['Card bills', '', '', false, 'Amex'];
  if (D.includes('NEO FINANCIAL')) return ['Card bills', '', '', false, 'Neo Financial'];
  if (D.startsWith('ONLINE BANKING LOAN PAYMENT')) return ['Loan and credit line payments', '', '', false, 'Loan payment'];
  if (D === 'LOAN INTEREST') return ['Loan interest', '', '', false, 'Loan interest'];
  if (D.includes('FEE') && (D.includes('MONTHLY') || D.includes('ELECTRONIC'))) return ['Bank fees', '', '', false, 'Bank fee'];
  if (D.includes(H.depositText)) return ['Deposit for your rental home', '', 'deposit', false, 'Mander Real Estate deposit'];
  if (D.startsWith('E-TRANSFER SENT') && /CLEAN|CLENAING/.test(D)) return ['Cleaning', '', '', false, 'Cleaning'];
  if (D.includes('CASH WITHDRAWAL')) return ['Cash withdrawals', '', '', false, 'Branch withdrawal'];
  if (D.includes('CANADA ESSENTIALS BENEFIT')) return ['Government benefits', '', '', false, 'Canada essentials benefit'];
  if (D.includes('CONTACTLESS INTERAC PURCHASE')) return ['Debit purchases', '', '', false, 'Debit purchase'];
  if (/^(ONLINE BANKING TRANSFER|BR TO BR|MISC PAYMENT OLEH KARNAUKHOV|INVESTMENT WS INVESTMENTS)/.test(D) || D.includes('REQUEST FULFILLED OLEH')) {
    return ['Moves between your own accounts', '', '', true, 'Transfer'];
  }
  if (/^(E-TRANSFER SENT|E-TRANSFER REQUEST FULFILLED|E-TRANSFER CANCEL)/.test(D)) return ['E-transfers to and from people', '', '', false, 'E-transfer'];
  if (D.includes('CLUTCH TECHNOLOGIES')) return ['Other money in', '', '', false, 'Clutch Technologies'];
  return ['Other payments', '', '', false, title(desc).slice(0, 40)];
}
function rbc(objs) {
  const rows = objs.map((o) => {
    const desc = String(o['Description 1'] || '').replace(/\s+/g, ' ').trim(), amount = num(o['CAD$']);
    const [bucket, property, role, internal, label] = rbcClassify(desc, amount);
    return {date: isoDate(o['Transaction Date'], 'mdy'), label, bucket, property, role, internal, flow: amount > 0 ? 'In' : 'Out', amount: Math.round(amount * 100) / 100};
  }).filter((r) => r.date && Number.isFinite(r.amount));
  return {kind: 'rbc', account: 'RBC chequing', mode: 'replace', label: 'RBC chequing',
    rows: withIds(rows, 'r', (r) => [r.date, r.amount, r.label, r.bucket].join('|')), ...span(rows)};
}

// ---- merging an upload into what is stored ---------------------------------

// A full export replaces that account's rows in its date range. A short list of extra transactions is added, skipping duplicates.
export function merge(store, batch) {
  const list = store[batch.kind] || [];
  const sameAcct = (r) => batch.kind !== 'cards' || r.account === batch.account;
  let kept;
  if (batch.mode === 'replace') {
    kept = list.filter((r) => !(sameAcct(r) && r.date >= batch.from && r.date <= batch.to));
    return {...store, [batch.kind]: sortRows([...kept, ...batch.rows])};
  }
  const key = (r) => [r.account, r.date, r.spend].join('|');
  const counts = new Map();
  for (const r of list) counts.set(key(r), (counts.get(key(r)) || 0) + 1);
  const add = [];
  for (const r of batch.rows) { const k = key(r); if (counts.get(k)) counts.set(k, counts.get(k) - 1); else add.push(r); }
  return {...store, [batch.kind]: sortRows([...list, ...add])};
}
const sortRows = (rows) => rows.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
