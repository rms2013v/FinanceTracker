// Reads files the dashboard doesn't know, with Claude.
// Claude only sees the first rows of a file (to work out its columns) and the merchant names (to sort them into categories).
// Every row is then read here in the browser with the layout Claude described.
import {isoDate, num} from './parse.js?v=202611261258';
import {GROUPS, GROUP_OF} from './rules.js?v=202611261258';

const API = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const PREVIEW_ROWS = 30;

async function ask(settings, system, text, tool) {
  if (!settings.aiKey) throw new Error('Add your Anthropic API key in Menu → Settings first.');
  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-api-key': settings.aiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'},
      body: JSON.stringify({model: settings.aiModel || DEFAULT_MODEL, max_tokens: 8000, system, tools: [tool], tool_choice: {type: 'tool', name: tool.name},
        messages: [{role: 'user', content: text}]}),
    });
  } catch (e) { throw new Error('Couldn’t reach Claude. Check your connection.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || res.statusText;
    if (res.status === 401) throw new Error('Claude didn’t accept the API key. Check it in Settings.');
    throw new Error('Claude returned an error: ' + msg);
  }
  const use = (body.content || []).find((c) => c.type === 'tool_use');
  if (!use) throw new Error('Claude didn’t return a layout for this file.');
  return use.input;
}

// A fingerprint of a file's layout, so the same kind of file is read without asking again.
export function signature(sheets) {
  for (const sh of sheets) {
    const head = sh.rows.slice(0, 15).find((r) => r.filter((c) => String(c).trim()).length >= 3);
    if (head) return sh.name.toLowerCase() + '|' + head.map((c) => String(c).trim().toLowerCase()).join('|');
  }
  return '';
}

const LAYOUT_TOOL = {
  name: 'file_layout',
  description: 'Describe where the transactions are in this exported bank or credit card file.',
  input_schema: {
    type: 'object',
    properties: {
      isTransactions: {type: 'boolean', description: 'True if the file is a list of card or bank transactions.'},
      kind: {type: 'string', enum: ['card', 'bank'], description: 'card = credit card activity; bank = chequing or savings account.'},
      accountName: {type: 'string', description: 'Short name for the account, e.g. "Wealthsimple" or "TD Visa". Use the issuer if you can tell.'},
      currency: {type: 'string', enum: ['CAD', 'USD', 'EUR', 'GBP', 'OTHER']},
      sheet: {type: 'integer', description: 'Index of the sheet that holds the transactions.'},
      firstDataRow: {type: 'integer', description: 'Row index of the first transaction (after any header row).'},
      dateCol: {type: 'integer'},
      dateOrder: {type: 'string', enum: ['ymd', 'mdy', 'dmy'], description: 'Order of day and month in the dates.'},
      descCol: {type: 'integer', description: 'Merchant or description column.'},
      amountCol: {type: ['integer', 'null'], description: 'Single signed amount column, or null if the file has separate debit and credit columns.'},
      debitCol: {type: ['integer', 'null']},
      creditCol: {type: ['integer', 'null']},
      chargesArePositive: {type: 'boolean', description: 'For a single amount column: true if purchases are positive numbers.'},
      categoryCol: {type: ['integer', 'null'], description: 'Column with the issuer’s own category, if any.'},
      typeCol: {type: ['integer', 'null'], description: 'Column with the transaction type (purchase, refund, payment), if any.'},
      skipPattern: {type: 'string', description: 'Case-insensitive regular expression matching rows that are payments toward the card balance or moves between own accounts, which are not spending. Empty if none.'},
      summary: {type: 'string', description: 'One plain sentence about what the file is.'},
    },
    required: ['isTransactions', 'kind', 'accountName', 'currency', 'sheet', 'firstDataRow', 'dateCol', 'dateOrder', 'descCol', 'amountCol', 'chargesArePositive', 'skipPattern', 'summary'],
  },
};

export async function readLayout(settings, sheets, fileName) {
  const preview = sheets.slice(0, 4).map((sh, i) => `Sheet ${i} "${sh.name}" (${sh.rows.length} rows):\n` +
    sh.rows.slice(0, PREVIEW_ROWS).map((r, j) => `${j}: ${JSON.stringify(r.map((c) => (typeof c === 'string' ? c.slice(0, 80) : c)))}`).join('\n')).join('\n\n');
  return ask(settings,
    'You read exported bank and credit card files for a personal finance dashboard in Canada. Row and column indexes start at 0. Excel dates may appear as serial numbers.',
    `File name: ${fileName}\n\n${preview}`, LAYOUT_TOOL);
}

// Reads every row with the layout. Returns rows with the raw description, ready to be categorised.
export function applyLayout(sheets, L) {
  const sh = sheets[L.sheet] || sheets[0];
  let skip = null;
  if (L.skipPattern) { try { skip = new RegExp(L.skipPattern, 'i'); } catch { skip = null; } }
  const out = [];
  for (const r of sh.rows.slice(L.firstDataRow)) {
    const date = isoDate(r[L.dateCol], L.dateOrder);
    const desc = String(r[L.descCol] ?? '').replace(/\s+/g, ' ').trim();
    if (!date || !desc) continue;
    let charge;
    if (L.amountCol != null) { const a = num(r[L.amountCol]); charge = L.chargesArePositive ? a : -a; }
    else { const d = num(r[L.debitCol]), c = num(r[L.creditCol]); charge = (Number.isFinite(d) ? Math.abs(d) : 0) - (Number.isFinite(c) ? Math.abs(c) : 0); }
    if (!Number.isFinite(charge) || charge === 0) continue;
    const typ = L.typeCol != null ? String(r[L.typeCol] ?? '') : '';
    if (skip && (skip.test(desc) || (typ && skip.test(typ)))) continue;
    out.push({date, desc, charge: Math.round(charge * 100) / 100, hint: L.categoryCol != null ? String(r[L.categoryCol] ?? '').trim() : ''});
  }
  return out;
}

export const merchantKey = (desc) => desc.toUpperCase().replace(/\d{3,}|#\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
export const CATEGORIES = Object.values(GROUPS).flat();

const CAT_TOOL = {
  name: 'merchants',
  description: 'Give each merchant a clean display name and one category.',
  input_schema: {
    type: 'object',
    properties: {items: {type: 'array', items: {type: 'object', properties: {
      i: {type: 'integer'}, name: {type: 'string', description: 'Short readable merchant name, e.g. "Safeway" not "SAFEWAY #4909 VANCOUVER BC".'},
      category: {type: 'string', enum: [...CATEGORIES, 'Uncategorized']}}, required: ['i', 'name', 'category']}}},
    required: ['items'],
  },
};

// Names and categories for merchants not seen before. Known ones come from the saved list.
export async function categorize(settings, list) {
  const out = {};
  for (let s = 0; s < list.length; s += 150) {
    const chunk = list.slice(s, s + 150);
    const res = await ask(settings,
      'You sort credit card merchants into spending categories for a person in Canada. Use the issuer’s category hint when it fits. Use Uncategorized only if you really can’t tell.',
      chunk.map((m, i) => `${i}: ${m.desc}${m.hint ? ' (issuer category: ' + m.hint + ')' : ''}`).join('\n'), CAT_TOOL);
    for (const it of res.items || []) {
      const m = chunk[it.i]; if (!m) continue;
      out[m.key] = {name: String(it.name || m.desc).slice(0, 60), category: CATEGORIES.includes(it.category) ? it.category : 'Uncategorized'};
    }
  }
  return out;
}

export {GROUP_OF};

const EXTRACT_TOOL = {
  name: 'transactions',
  description: 'List the card transactions found in the pasted text.',
  input_schema: {
    type: 'object',
    properties: {
      accountName: {type: 'string', description: 'Card name if the text shows it (e.g. "Wealthsimple", "Amex Aeroplan"), otherwise empty.'},
      currency: {type: 'string', enum: ['CAD', 'USD', 'EUR', 'GBP', 'OTHER']},
      summary: {type: 'string', description: 'One plain sentence about what was pasted.'},
      items: {type: 'array', items: {type: 'object', properties: {
        date: {type: 'string', description: 'YYYY-MM-DD. If the year is missing, use the most recent date on or before today.'},
        raw: {type: 'string', description: 'The description exactly as written.'},
        merchant: {type: 'string', description: 'Short readable merchant name.'},
        amount: {type: 'number', description: 'Positive for a purchase or charge, negative for a refund or credit.'},
        category: {type: 'string', enum: [...CATEGORIES, 'Uncategorized']},
        isPayment: {type: 'boolean', description: 'True for a payment toward the card balance, which is not spending.'},
      }, required: ['date', 'raw', 'merchant', 'amount', 'category', 'isPayment']}},
    },
    required: ['currency', 'summary', 'items'],
  },
};

// Pulls transactions out of text copied from a bank or card website.
export async function extractFromText(settings, text) {
  const today = new Date().toLocaleDateString('en-CA');
  const res = await ask(settings,
    `You read credit card transactions that a person in Canada copied from their bank's website or app. Today is ${today}. Include pending transactions. Leave out headings, balances and totals.`,
    text.slice(0, 40000), EXTRACT_TOOL);
  return res;
}
