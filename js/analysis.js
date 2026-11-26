// All the numbers on the dashboard, worked out from the stored rows.
import {cardAccounts} from './parse.js?v=202611261408';
import {ONE_OFF} from './rules.js?v=202611261408';

const DAY = 864e5;
export const pd = (s) => Date.parse(s + 'T00:00:00Z');
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const ym = (t) => iso(t).slice(0, 7);
const sum = (a, f = (x) => x) => a.reduce((s, r) => s + (f(r) || 0), 0);
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const groupBy = (a, f) => { const m = new Map(); for (const r of a) { const k = f(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
const mondayOf = (t) => { const d = new Date(t), wd = (d.getUTCDay() + 6) % 7; return t - wd * DAY; };
const monthStart = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const addMonths = (t, n) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1); };
export const monthsBetween = (a, b) => { const out = []; for (let t = monthStart(a); t <= b; t = addMonths(t, 1)) out.push(ym(t)); return out; };

// Each card's date range: from its first transaction to the last day in any card data.
export function windows(cards) {
  if (!cards.length) return [];
  const end = Math.max(...cards.map((r) => pd(r.date)));
  return [...groupBy(cards, (r) => r.account)].map(([account, v]) => {
    const start = Math.min(...v.map((r) => pd(r.date)));
    return {account, start: iso(start), end: iso(end), days: (end - start) / DAY + 1};
  });
}

export function filterBase(cards, f) {
  return cards.filter((r) => (!f.account || r.account === f.account) && (!f.group || r.group === f.group) && (!f.big || Math.abs(r.spend) < ONE_OFF));
}
export const filterAll = (base, f) => (f.category ? base.filter((r) => r.category === f.category) : base);

export function kpi(rows, wins, f) {
  if (!wins.length) return null;
  const ws = wins.filter((w) => !f.account || w.account === f.account);
  if (!ws.length) return null;
  const end = Math.max(...wins.map((w) => pd(w.end)));
  let perDay = 0;
  for (const w of ws) perDay += sum(rows.filter((r) => r.account === w.account), (r) => r.spend) / w.days;
  const net = sum(rows, (r) => r.spend), refunds = -sum(rows, (r) => (r.spend < 0 ? r.spend : 0));
  const last28 = sum(rows, (r) => (pd(r.date) > end - 28 * DAY ? r.spend : 0)), usual28 = perDay * 28;
  return {start: iso(Math.min(...ws.map((w) => pd(w.start)))), end: iso(end), net, gross: net + refunds, refunds, perDay,
    perWeek: perDay * 7, perMonth: (perDay * 365) / 12, projYear: perDay * 365, last28, usual28, chg28: usual28 ? last28 / usual28 - 1 : 0};
}

export function period(rows, k) {
  if (!k) return null;
  const end = pd(k.end), mS = monthStart(end), wS = mondayOf(end);
  const mDays = (end - mS) / DAY + 1, mTotal = (addMonths(mS, 1) - mS) / DAY, wDays = (end - wS) / DAY + 1;
  const from = (t) => sum(rows, (r) => { const d = pd(r.date); return d >= t && d <= end ? r.spend : 0; });
  const monthSpend = from(mS), weekSpend = from(wS), monthProj = (monthSpend / mDays) * mTotal;
  return {month: ym(mS), monthStart: iso(mS), end: k.end, monthSpend, monthDays: mDays, monthProj, monthVs: k.perMonth ? monthProj / k.perMonth - 1 : 0,
    weekStart: iso(wS), weekSpend, weekDays: wDays, weekVs: k.perDay ? weekSpend / (k.perDay * wDays) - 1 : 0};
}

export function monthly(rows, wins) {
  if (!wins.length) return [];
  const start = Math.min(...wins.map((w) => pd(w.start))), end = Math.max(...wins.map((w) => pd(w.end)));
  const m = new Map(), accts = cardAccounts(rows);
  for (const r of rows) { const k = r.date.slice(0, 7); if (!m.has(k)) m.set(k, {}); const o = m.get(k); o[r.account] = (o[r.account] || 0) + r.spend; }
  return monthsBetween(start, end).map((month) => {
    const o = m.get(month) || {}, row = {month, total: 0};
    for (const c of accts) { row[c] = o[c] || 0; row.total += row[c]; }
    return row;
  });
}

export function weekly(rows, wins) {
  if (!wins.length) return [];
  const start = Math.min(...wins.map((w) => pd(w.start))), end = Math.max(...wins.map((w) => pd(w.end)));
  const m = new Map();
  for (const r of rows) { const k = iso(mondayOf(pd(r.date))); m.set(k, (m.get(k) || 0) + r.spend); }
  const weeks = [];
  for (let t = mondayOf(start); t <= end; t += 7 * DAY) weeks.push({week: iso(t), spend: m.get(iso(t)) || 0});
  weeks.forEach((w, i) => { const s = weeks.slice(Math.max(0, i - 3), i + 1); w.avg4 = sum(s, (x) => x.spend) / s.length; });
  return weeks;
}

export function categories(rows) {
  const net = sum(rows, (r) => r.spend);
  return [...groupBy(rows, (r) => r.category)].map(([category, v]) => {
    const spend = sum(v, (r) => r.spend);
    return {category, group: v[0].group, spend, n: v.length, share: net ? spend / net : 0};
  }).sort((a, b) => b.spend - a.spend);
}

export function merchants(rows, n = 25) {
  return [...groupBy(rows, (r) => r.merchant)].map(([merchant, v]) => {
    const byCat = [...groupBy(v, (r) => r.category)].map(([c, x]) => [c, sum(x, (r) => r.spend)]).sort((a, b) => b[1] - a[1]);
    return {merchant, category: byCat[0][0], n: v.filter((r) => r.spend > 0).length, spend: sum(v, (r) => r.spend)};
  }).sort((a, b) => b.spend - a.spend).slice(0, n);
}

export const bigOnes = (cards) => cards.filter((r) => Math.abs(r.spend) >= ONE_OFF);

export function pickMonth(months, wanted) {
  return wanted && months.some((r) => r.month === wanted) ? wanted : (months.length ? months[months.length - 1].month : null);
}

export function monthDetail(rows, base, month, k) {
  const v = rows.filter((r) => r.date.slice(0, 7) === month), b = base.filter((r) => r.date.slice(0, 7) === month);
  const net = sum(v, (r) => r.spend), top = v.reduce((a, r) => (!a || r.spend > a.spend ? r : a), null);
  return {month, net, n: v.length, vsAvg: k && k.perMonth ? net / k.perMonth - 1 : 0, top, cats: categories(b), txns: v};
}

// Income: each payment in CAD. A month with no salary entered assumes the latest salary.
export const incomeCad = (r) => (+r.amount || 0) * (r.currency === 'CAD' ? 1 : (+r.fx || 0));
export function budget(income, cards) {
  const cardsBy = new Map();
  for (const r of cards) { const k = r.date.slice(0, 7); cardsBy.set(k, (cardsBy.get(k) || 0) + r.spend); }
  const inc = new Map(), salary = new Map();
  for (const r of income) {
    if (!r.month) continue;
    const o = inc.get(r.month) || {received: 0, expected: 0};
    if (r.status === 'received') o.received += incomeCad(r); else o.expected += incomeCad(r);
    inc.set(r.month, o);
    if (/salary/i.test(r.label || '')) salary.set(r.month, (salary.get(r.month) || 0) + incomeCad(r));
  }
  const months = [...new Set([...cardsBy.keys(), ...inc.keys()])].sort();
  let last = null;
  return months.map((month) => {
    const i = inc.get(month) || {received: 0, expected: 0}, c = cardsBy.get(month) || 0;
    let assumed = 0, assumedFrom = '';
    if (salary.has(month)) last = {month, cad: salary.get(month)};
    else if (last) { assumed = last.cad; assumedFrom = last.month; }
    const incoming = i.received + i.expected + assumed;
    return {month, received: i.received, expected: i.expected + assumed, assumed, assumedFrom, incoming, cards: c, left: incoming - c, hasIncome: inc.has(month) || assumed > 0};
  });
}

// Wealthsimple chequing
export function chqSummary(chq) {
  return {billsPaid: -sum(chq, (r) => (r.cardBill ? r.amount : 0)), moneyIn: sum(chq, (r) => (r.amount > 0 ? r.amount : 0)),
    moneyOut: -sum(chq, (r) => (r.amount < 0 ? r.amount : 0)), interest: sum(chq, (r) => (r.bucket === 'Interest' ? r.amount : 0))};
}
export function chqMonthly(chq) {
  return [...groupBy(chq, (r) => r.date.slice(0, 7))].map(([month, v]) => ({month,
    a: sum(v, (r) => (r.amount > 0 ? r.amount : 0)), b: -sum(v, (r) => (r.amount < 0 ? r.amount : 0)), c: -sum(v, (r) => (r.cardBill ? r.amount : 0))}))
    .sort((x, y) => (x.month < y.month ? -1 : 1));
}
export function buckets(rows, internalAware = false) {
  return [...groupBy(rows, (r) => r.bucket)].map(([bucket, v]) => {
    const net = sum(v, (r) => r.amount);
    const flow = internalAware && v[0].internal ? 'Between your accounts' : internalAware ? (net >= 0 ? 'In' : 'Out') : v[0].flow;
    return {bucket, flow, n: v.length, total: internalAware ? Math.abs(net) : Math.abs(net)};
  }).sort((a, b) => (a.flow < b.flow ? -1 : a.flow > b.flow ? 1 : b.total - a.total));
}

// Housing, from RBC
export function properties(rbc) {
  return ['Logan house', 'Condo'].map((property) => {
    const v = rbc.filter((r) => r.property === property);
    const s = (role) => sum(v, (r) => (r.role === role ? r.amount : 0));
    const typ = (role) => median([...groupBy(v.filter((r) => r.role === role), (r) => r.date.slice(0, 7)).values()].map((x) => sum(x, (r) => r.amount)));
    const income = s('income'), mortgage = -s('mortgage'), fees = -s('fee');
    const mIncome = typ('income'), mMortgage = -typ('mortgage'), mFees = -typ('fee');
    return {property, income, mortgage, fees, net: income - mortgage - fees, mIncome, mMortgage, mFees, mNet: mIncome - mMortgage - mFees};
  });
}
export function housing(rbc, props) {
  const rent = rbc.filter((r) => r.role === 'rent');
  const mRent = median([...groupBy(rent, (r) => r.date.slice(0, 7)).values()].map((x) => -sum(x, (r) => r.amount)));
  const rentCollected = sum(props, (p) => p.income), propertyCosts = sum(props, (p) => p.mortgage + p.fees), mNetRental = sum(props, (p) => p.mNet);
  return {rentPaid: -sum(rent, (r) => r.amount), mRent, rentCollected, propertyCosts, netRental: rentCollected - propertyCosts, mNetRental, mHousing: mRent - mNetRental};
}
export function housingMonthly(rbc) {
  return [...groupBy(rbc.filter((r) => r.role && r.role !== 'deposit'), (r) => r.date.slice(0, 7))].map(([month, v]) => ({month,
    a: sum(v, (r) => (r.role === 'income' ? r.amount : 0)),
    b: -sum(v, (r) => (r.role === 'mortgage' || r.role === 'fee' ? r.amount : 0)),
    c: -sum(v, (r) => (r.role === 'rent' ? r.amount : 0))})).sort((x, y) => (x.month < y.month ? -1 : 1));
}
