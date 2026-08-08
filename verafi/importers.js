/**
 * Aggregator-free import paths.
 *
 * Every bank in America lets you export CSV or OFX/QFX from online banking. For a
 * personal app that is a completely valid data source — no third party ever sees your
 * credentials, no vendor, no cost, no signup. Use this to test the whole product today
 * and add Plaid later if you want it to refresh itself.
 */

/** Tolerant CSV parser: handles quotes, commas inside quotes, CRLF. */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

const HEADER_ALIASES = {
  date:        ['date','transaction date','posted date','post date','posting date','trans date','date posted'],
  description: ['description','name','merchant','payee','memo','transaction description','details','original description'],
  amount:      ['amount','debit','transaction amount','amount (usd)'],
  credit:      ['credit','deposit'],
  category:    ['category','type','transaction type']
};
function findCol(headers, key) {
  const h = headers.map(x => x.trim().toLowerCase());
  for (const alias of HEADER_ALIASES[key]) { const i = h.indexOf(alias); if (i >= 0) return i; }
  return -1;
}

const CATEGORY_RULES = [
  [/doordash|uber ?eats|grubhub|seamless|postmates|caviar|restaurant|cafe|coffee|starbucks|chipotle|pizza|sushi|bar\b/i, 'dining'],
  [/whole ?foods|trader ?joe|safeway|kroger|costco|wegmans|aldi|publix|grocer|market/i, 'grocery'],
  [/netflix|spotify|hulu|disney|adobe|dropbox|icloud|notion|figma|github|openai|anthropic|patreon|substack|prime video/i, 'subscription'],
  [/uber(?! ?eats)|lyft|shell|chevron|exxon|bp\b|parking|transit|bart|mta|caltrain|toll/i, 'transport'],
  [/airlines?|united|delta|american air|southwest|jetblue|alaska air|hotel|marriott|hilton|airbnb|expedia|booking\.com/i, 'travel'],
  [/amazon|target|walmart|best ?buy|apple store|ikea|home depot|lowes|etsy|ebay/i, 'retail'],
  [/rent|mortgage|comcast|xfinity|verizon|at&t|t-mobile|pg&e|electric|water|internet|insurance/i, 'bills'],
  [/gym|equinox|planet fitness|classpass|peloton|soulcycle/i, 'fitness'],
  [/cvs|walgreens|pharmacy|dental|medical|clinic|hospital|doctor/i, 'health'],
  [/\bfee\b|overdraft|atm surcharge|service charge|foreign transaction|late fee|maintenance fee/i, 'fee'],
  [/transfer|payment thank you|autopay|online payment|zelle|venmo|cash app/i, 'transfer']
];
export function categorise(description) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(description)) return cat;
  return 'other';
}

export function normaliseMerchant(description) {
  return String(description)
    .replace(/\b(sq|tst|pos|purchase|debit card|pp|paypal|sp|amzn mktp|www\.)\b/gi, ' ')
    .replace(/\b\d{3,}\b/g, ' ').replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .trim().toLowerCase().split(/\s+/).slice(0, 3).join('-') || 'unknown';
}

/**
 * Bank CSV → core transaction shape. Handles the two conventions banks use:
 * a single signed amount column, or separate debit/credit columns.
 */
export function importCsv(text, { instrumentId = null, source = 'csv' } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('csv looks empty');
  const headers = rows[0];
  const iDate = findCol(headers, 'date'), iDesc = findCol(headers, 'description');
  const iAmt = findCol(headers, 'amount'), iCredit = findCol(headers, 'credit');
  if (iDate < 0 || iDesc < 0 || (iAmt < 0 && iCredit < 0))
    throw new Error(`could not find date/description/amount columns in: ${headers.join(', ')}`);

  const out = [];
  for (const r of rows.slice(1)) {
    const dateStr = (r[iDate] ?? '').trim();
    const posted = Date.parse(dateStr);
    if (!dateStr || Number.isNaN(posted)) continue;
    const desc = (r[iDesc] ?? '').trim();

    let cents;
    if (iAmt >= 0 && (r[iAmt] ?? '').trim()) {
      const raw = parseFloat(r[iAmt].replace(/[$,()]/g, '')) * (/\(/.test(r[iAmt]) ? -1 : 1);
      cents = Math.round(raw * 100);
      // Banks disagree on sign. Most exports make spending negative; we store spending positive.
      cents = -cents;
    } else if (iCredit >= 0) {
      cents = -Math.round(parseFloat((r[iCredit] || '0').replace(/[$,]/g, '')) * 100);
    } else continue;
    if (!Number.isFinite(cents) || cents === 0) continue;

    const category = categorise(desc);
    out.push({
      id: `${source}_${posted}_${Math.abs(cents)}_${normaliseMerchant(desc).slice(0,12)}`,
      externalId: `${source}_${posted}_${Math.abs(cents)}_${desc.slice(0,24)}`,
      merchantId: normaliseMerchant(desc), merchantName: desc,
      instrumentId, amountCents: cents, postedAt: posted,
      localHour: new Date(posted).getHours(), category, mcc: null,
      isFee: category === 'fee', pending: false,
      cardRewardMultiplier: 1, bestAvailableMultiplier: 1, source
    });
  }
  return out;
}

/** OFX/QFX — what most banks call "Quicken" or "Money" export. */
export function importOfx(text, { instrumentId = null } = {}) {
  const out = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b, t) => (b.match(new RegExp(`<${t}>([^<\r\n]*)`, 'i')) ?? [])[1]?.trim();
  for (const b of blocks) {
    const dt = tag(b, 'DTPOSTED'); if (!dt) continue;
    const posted = Date.UTC(+dt.slice(0,4), +dt.slice(4,6)-1, +dt.slice(6,8), +(dt.slice(8,10) || 12));
    const desc = tag(b, 'NAME') ?? tag(b, 'MEMO') ?? 'unknown';
    const cents = -Math.round(parseFloat(tag(b, 'TRNAMT') ?? '0') * 100);
    if (!cents) continue;
    const category = categorise(desc);
    out.push({
      id: `ofx_${tag(b,'FITID') ?? posted}`, externalId: `ofx_${tag(b,'FITID') ?? posted+'_'+cents}`,
      merchantId: normaliseMerchant(desc), merchantName: desc, instrumentId,
      amountCents: cents, postedAt: posted, localHour: new Date(posted).getHours(),
      category, mcc: null, isFee: category === 'fee', pending: false,
      cardRewardMultiplier: 1, bestAvailableMultiplier: 1, source: 'ofx'
    });
  }
  return out;
}
