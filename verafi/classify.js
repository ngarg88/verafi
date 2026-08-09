/**
 * MONEY-MOVEMENT CLASSIFIER
 *
 * The single most important idea in this app: **money leaving your account is not the
 * same as money you spent.**
 *
 *   $2,000 to Vanguard      → you got richer
 *   $1,400 to Chase card    → paying for spending already counted; counting it again double-counts
 *   $500 to your own HYSA   → still yours
 *   $9,000 to the IRS       → not optional, not a saving opportunity
 *   $38 on DoorDash         → this is the only one that is actually spending
 *
 * Only `expense` is analysed for findings or totals. Everything else is excluded —
 * silently flagging someone's 401k contribution as waste destroys trust instantly.
 */

export const FLOW = Object.freeze({
  EXPENSE:      'expense',
  INVESTMENT:   'investment',
  TRANSFER:     'transfer',
  DEBT_PAYMENT: 'debt_payment',
  INCOME:       'income',
  TAX:          'tax'
});

const RULES = [
  [FLOW.INVESTMENT, /vanguard|fidelity|charles ?schwab|\bschwab\b|robinhood|e\*?trade|etrade|merrill|betterment|wealthfront|acorns|stash|m1 ?finance|public\.com|webull|interactive ?brokers|\bibkr\b|tastytrade|sofi ?invest|coinbase|kraken|gemini|binance|\b401k\b|\broth\b|\bira\b|brokerage|invest(ment)?s?\b|vested|carta|computershare|treasury ?direct|\btsp\b|hsa ?invest/i],
  [FLOW.TAX,        /\birs\b|internal revenue|franchise tax|dept.? of revenue|state tax|estimated tax|turbotax payment|tax pay(ment)?/i],
  [FLOW.DEBT_PAYMENT, /payment thank ?you|autopay|online ?payment|card ?payment|cc ?payment|loan ?payment|student ?loan|navient|nelnet|mohela|sallie ?mae|principal ?payment|mortgage ?pmt/i],
  [FLOW.TRANSFER,   /transfer|zelle|venmo|cash ?app|paypal ?transfer|wire|ach ?(credit|debit)|to ?savings|from ?savings|internal|xfer|withdrawal|deposit\b/i],
  [FLOW.INCOME,     /payroll|direct ?dep|salary|paycheck|refund|reimburse|interest ?paid|dividend|cashback ?reward/i]
];

/**
 * Classify one transaction. `amountCents` is positive for money out.
 * Deliberately conservative: when unsure, call it an expense but mark low confidence,
 * because wrongly EXCLUDING real spend hides money, and wrongly INCLUDING a 401k is
 * insulting. Neither is free, so we surface the uncertainty instead of hiding it.
 */
export function classify(tx) {
  const text = `${tx.merchantName ?? ''} ${tx.merchantId ?? ''} ${tx.category ?? ''}`;

  if (tx.amountCents < 0) return { flow: FLOW.INCOME, confidence: 0.95, why: 'money in' };

  for (const [flow, re] of RULES) {
    const m = text.match(re);
    if (m) return { flow, confidence: 0.9, why: `matched “${m[0].trim()}”` };
  }
  if (tx.category === 'transfer') return { flow: FLOW.TRANSFER, confidence: 0.8, why: 'category is transfer' };
  return { flow: FLOW.EXPENSE, confidence: 0.7, why: 'no exclusion matched' };
}

/** Only real spending. This is what every agent and every total must run on. */
export function expensesOnly(tx) {
  return tx.filter(t => classify(t).flow === FLOW.EXPENSE);
}

/** Where the money actually went, so the app can show it instead of hiding the exclusions. */
export function breakdown(tx) {
  const out = { expense:0, investment:0, transfer:0, debt_payment:0, income:0, tax:0 };
  const counts = { ...out };
  for (const t of tx) {
    const { flow } = classify(t);
    out[flow] += Math.abs(t.amountCents);
    counts[flow] += 1;
  }
  return { cents: out, counts };
}
