// Mortgage maths. Everything runs in the browser from the numbers on your bank's mortgage page.

const MONTHS = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
const pad = (n) => String(n).padStart(2, '0');
const money = (s) => (s == null ? null : Number(String(s).replace(/[$,\s]/g, '')));
function textDate(s) {
  const m = String(s || '').match(/([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`;
  const n = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return n ? n[0] : '';
}

// Reads the text copied from a bank's mortgage page (RBC's layout and similar ones).
export function parseMortgageText(text) {
  const t = text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
  const after = (label, re) => { const m = t.match(new RegExp(label + '[\\s:]*' + re, 'i')); return m ? m[1] : null; };
  const AMT = '\\$?\\s*([\\d,]+(?:\\.\\d{1,2})?)';
  const out = {
    balance: money(after('Outstanding Balance', AMT)),
    payment: money(after('Next Payment Due', AMT)),
    nextDate: textDate(after('Next Payment Due[\\s\\S]{0,40}?On', '([A-Za-z]{3,9}\\.? \\d{1,2},? \\d{4})')),
    rate: Number(after('Interest Rate', '([\\d.]+)\\s*%')),
    rateType: /variable/i.test(t) ? 'Variable' : /fixed/i.test(t) ? 'Fixed' : '',
    maturity: textDate(after('Maturity Date', '([A-Za-z]{3,9}\\.? \\d{1,2},? \\d{4})')),
    original: money(after('Original Balance', AMT)),
    origAmort: Number(after('Original Amortization', '(\\d+)\\s*Months')) || null,
    bankRemaining: Number(after('(?:Actual )?Amortization Remaining', '(\\d+)\\s*Months')) || null,
    term: Number(after('Mortgage Term', '(\\d+)\\s*Months')) || null,
  };
  if (!out.rate) delete out.rate;
  for (const k of Object.keys(out)) if (out[k] == null || out[k] === '' || Number.isNaN(out[k])) delete out[k];
  return out;
}

export const monthlyRate = (m, rate = m.rate) => (m.compound === 'semiannual' ? Math.pow(1 + rate / 200, 1 / 6) - 1 : rate / 1200);
export function addMonths(iso, n) {
  const [y, mo, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

// Payment-by-payment schedule from the next payment until the balance reaches zero.
export function schedule(m, {rate = m.rate, extra = 0, payment = m.payment} = {}) {
  const r = monthlyRate(m, rate), rows = [];
  let bal = m.balance;
  for (let i = 0; i < 720 && bal > 0.005; i++) {
    const interest = bal * r;
    let pay = payment + extra;
    if (pay <= interest) return {rows, never: true};
    const principal = Math.min(pay - interest, bal);
    bal -= principal;
    rows.push({n: i + 1, date: addMonths(m.nextDate, i), interest, principal, payment: interest + principal, balance: Math.max(bal, 0)});
  }
  return {rows, never: false};
}

export function summarize(m, today, opts) {
  const {rows, never} = schedule(m, opts);
  const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
  const past = rows.filter((x) => x.date <= today);
  const toMat = m.maturity ? rows.filter((x) => x.date <= m.maturity) : [];
  const atMat = toMat.length ? toMat[toMat.length - 1] : null;
  const first = rows[0];
  return {
    rows, never,
    payoff: never ? null : rows[rows.length - 1]?.date,
    monthsLeft: never ? null : rows.length,
    totalInterest: sum(rows, 'interest'),
    nowBalance: past.length ? past[past.length - 1].balance : m.balance,
    paidSince: past.length,
    next: rows.find((x) => x.date > today) || first,
    maturity: atMat && {date: m.maturity, balance: atMat.balance, interest: sum(toMat, 'interest'), principal: sum(toMat, 'principal'), payments: toMat.length},
    paidOff: m.original ? m.original - m.balance : null,
  };
}

export function byYear(rows) {
  const map = new Map();
  for (const x of rows) {
    const y = x.date.slice(0, 4), o = map.get(y) || {year: y, interest: 0, principal: 0, balance: 0, payments: 0};
    o.interest += x.interest; o.principal += x.principal; o.balance = x.balance; o.payments++;
    map.set(y, o);
  }
  return [...map.values()];
}

export const span = (months) => {
  if (months == null) return 'never at this payment';
  const y = Math.floor(months / 12), mo = months % 12;
  return [y && y + (y === 1 ? ' year' : ' years'), mo && mo + (mo === 1 ? ' month' : ' months')].filter(Boolean).join(' ') || '0 months';
};
