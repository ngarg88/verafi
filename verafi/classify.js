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
  // Brokerages abbreviate brutally on statements: FID BKG SVC LLC is Fidelity.
  // Private markets, securities platforms and anything that reads like a brokerage.
  [FLOW.INVESTMENT, /templum|markets,? ?llc|securities|capital ?(mgmt|management|markets)|equit(y|ies)|\bfund\b|angellist|republic\.co|yieldstreet|fundrise|masterworks|carta|forge ?global|ec ?markets|private ?placement|fid ?bkg|fid(elity)? ?(bkg|brokerage|invest)|bkg ?svc|trump ?account|529 ?plan|custodial|utma|ugma|dca\b|recurring ?invest|auto ?invest|vanguard|fidelity|charles ?schwab|\bschwab\b|robinhood|e\*?trade|etrade|merrill|betterment|wealthfront|acorns|stash|m1 ?finance|public\.com|webull|interactive ?brokers|\bibkr\b|tastytrade|sofi ?invest|coinbase|kraken|gemini|binance|\b401k\b|\broth\b|\bira\b|brokerage|invest(ment)?s?\b|vested|carta|computershare|treasury ?direct|\btsp\b|hsa ?invest/i],
  [FLOW.TAX,        /\birs\b|internal revenue|franchise tax|dept.? of revenue|state tax|estimated tax|turbotax payment|tax pay(ment)?/i],
  // Real bank descriptors are abbreviated and ugly. These were written against actual
  // statement text, not tidy merchant names.
    // A card issuer's name standing alone in a descriptor is a payment TO that card,
  // not a purchase. "SoFi", "DISCOVER", "AMEX" are never merchants you buy things from.
  [FLOW.DEBT_PAYMENT, /^(sofi|discover|amex|american express|capital ?one|cap ?one|citi|chase|barclay|synchrony|us ?bank|wells ?fargo)\b(?!.*(market|grocer|store|gas|fuel|restaurant))|discover ?cap ?one|financial ?(svcs|services)?$|motor ?credit|auto ?fin|financial\b(?! aid)|acceptance corp|payment thank ?you|autopay|auto ?pay|online ?payment|epay\b|e-?payment|card ?p(ay|mt)|cc ?p(ay|mt)|credit ?crd|credit ?card ?(pmt|payment|pymt)?|loan ?p(ay|mt)|student ?loan|navient|nelnet|mohela|sallie ?mae|principal|mortgage|mtg\b|amex ?epayment|discover ?e-?pymt|citi ?(card|autopay)|capital ?one ?(mobile ?)?pymt|chase ?credit|boa ?cc|bk ?of ?america ?cc|sofi ?credit|barclay|synchrony|heloc|line of credit/i],
    // "To Checking - 0162", "To Dream House Vault" - money you moved to yourself.
  [FLOW.TRANSFER,   /^to [a-z]|to (checking|savings|vault|reserve|goal|bucket|pocket)|from (checking|savings)|round ?up|save ?as ?you ?go|transfer|zelle|venmo|cash ?app|paypal ?transfer|wire\b|ach ?(credit|debit)|to ?savings|from ?savings|internal|xfer|withdraw|deposit\b|online ?banking|bank ?transfer|acct ?trnsfr|trnsfr|p2p\b|apple ?cash/i],
  [FLOW.INCOME,     /payroll|direct ?dep|salary|paycheck|refund|reimburse|interest ?paid|dividend|cashback ?reward/i]
];

/**
 * Classify one transaction. `amountCents` is positive for money out.
 * Deliberately conservative: when unsure, call it an expense but mark low confidence,
 * because wrongly EXCLUDING real spend hides money, and wrongly INCLUDING a 401k is
 * insulting. Neither is free, so we surface the uncertainty instead of hiding it.
 */
export function classify(tx, learnedFlow = null) {
  if (learnedFlow) {
    const n = `${tx.merchantName ?? ''} ${tx.merchantId ?? ''}`.toLowerCase();
    for (const [pat, flow] of Object.entries(learnedFlow))
      if (n.includes(pat)) return { flow, confidence: 0.95, why: 'learned' };
  }
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
export function expensesOnly(tx, learnedFlow = null) {
  return tx.filter(t => classify(t, learnedFlow).flow === FLOW.EXPENSE);
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
