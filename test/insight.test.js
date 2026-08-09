/**
 * INSIGHT QUALITY EVAL
 *
 * "Does it render" is not the same as "is it right". This plants KNOWN waste in synthetic
 * accounts, plus traps that look like waste but are not, then measures two things:
 *
 *   RECALL     did it find what is actually there?
 *   PRECISION  did it avoid claiming things that are not?
 *
 * Precision matters more. A missed subscription costs you $20. A false accusation that
 * your 401k contribution is waste costs you the whole app.
 */
import { runAgents } from '../verafi/agents.js';
import { AGENTS } from '../verafi/agents.js';

const DAY = 86400000, NOW = Date.UTC(2026, 7, 9);
let pass = 0, fail = 0;
const ck = (n, c, x='') => { console.log((c?'  ok  ':'  FAIL')+'  '+n+(x?'  — '+x:'')); c?pass++:fail++; };

const tx = (merchant, amount, daysAgo, o={}) => ({
  externalId: `${merchant}-${daysAgo}-${amount}`, merchantId: merchant.toLowerCase().replace(/\W+/g,'-'),
  merchantName: merchant, amountCents: Math.round(amount*100), postedAt: NOW - daysAgo*DAY,
  localHour: o.hour ?? 13, category: o.cat ?? 'other', isFee: o.fee ?? false,
  cardRewardMultiplier: 1, bestAvailableMultiplier: 1, ...o
});

function mkStore(transactions) {
  const data = { transactions, savings: [], runs: [], instruments: [],
    agents: Object.values(AGENTS).map(a => ({ name: a.label, enabled: true })),
    findings: [], seenFindings: {}, dismissed: {} };
  return { data, tx: () => transactions, save(){}, startRun:()=>({steps:[]}), step(){}, finishRun(){} };
}
const run = (transactions) => runAgents({ store: mkStore(transactions), now: NOW, cardRules:{default:{}} }).all;
const found = (findings, re) => findings.some(f => re.test(f.title) || re.test(f.detail ?? ''));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nRECALL — does it find what is genuinely there?\n');

// 1. dormant gym: charged monthly for a year, stopped going 4 months ago
{
  const t = [];
  for (let i = 4; i < 16; i++) t.push(tx('EQUINOX SF', 305, 30*i, {cat:'fitness'}));
  ck('dormant membership', found(run(t), /equinox/i), '$305/mo still billing, unused 4 months');
}

// 2. subscription that quietly went up 30%
{
  const t = [];
  for (let i = 6; i < 12; i++) t.push(tx('ADOBE CREATIVE CLOUD', 39.99, 30*i, {cat:'subscription'}));
  for (let i = 0; i < 6; i++)  t.push(tx('ADOBE CREATIVE CLOUD', 59.99, 30*i, {cat:'subscription'}));
  ck('price creep on a fixed subscription', found(run(t), /adobe/i), '$39.99 -> $59.99');
}

// 3. three overlapping streaming services
{
  const t = [];
  for (let i = 0; i < 8; i++) {
    t.push(tx('NETFLIX', 24.99, 30*i, {cat:'subscription'}));
    t.push(tx('HULU', 17.99, 30*i+2, {cat:'subscription'}));
    t.push(tx('DISNEY PLUS', 13.99, 30*i+5, {cat:'subscription'}));
  }
  ck('overlapping services', found(run(t), /video|overlap|3 /i), 'netflix + hulu + disney');
}

// 4. bank fees
{
  const t = [tx('CHASE OVERDRAFT FEE', 35, 10, {fee:true}), tx('CHASE OVERDRAFT FEE', 35, 45, {fee:true})];
  ck('overdraft fees', found(run(t), /overdraft/i), '2 x $35');
}

// 5. same-day identical charge at a rare merchant
{
  const t = [tx('WRISTBUDDYS', 67, 12, {cat:'shopping'}), tx('WRISTBUDDYS', 67, 12, {cat:'shopping'})];
  ck('true duplicate charge', found(run(t), /double charge/i), 'identical, same day, rare merchant');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nPRECISION — does it stay quiet when nothing is wrong?\n');

const noFindings = (t, re) => { const f = run(t); return !f.some(x => re.test(x.title) || re.test(x.detail ?? '')); };

// 6. recurring brokerage contributions — identical amount, monthly. NOT a duplicate.
{
  const t = [];
  for (let i = 0; i < 12; i++) t.push(tx('FID BKG SVC LLC', 2000, 30*i));
  ck('recurring investment not flagged', run(t).length === 0, '12 identical $2,000 contributions');
}

// 7. credit card autopay — large and recurring. NOT spending.
{
  const t = [];
  for (let i = 0; i < 12; i++) t.push(tx('CHASE CREDIT CRD', 1420 + i*10, 30*i));
  ck('card payments not flagged', run(t).length === 0, '$1,420/mo autopay');
}

// 8. rent — large, recurring, unavoidable
{
  const t = [];
  for (let i = 0; i < 12; i++) t.push(tx('RENT - PROPERTY MGMT', 2850, 30*i, {cat:'bills'}));
  ck('rent not flagged as waste', noFindings(t, /rent/i), '$2,850/mo');
}

// 9. groceries: bill size varies naturally. NOT price creep.
{
  const t = [];
  const amts = [62,88,45,103,71,96,58,112,67,94,49,101];
  amts.forEach((a,i) => t.push(tx('SAFEWAY', a, 20*i, {cat:'grocery'})));
  ck('variable grocery bills not "price creep"', noFindings(t, /safeway/i), 'basket size, not a price rise');
}

// 10. two Costco runs in a week — coincidence, not fraud
{
  const t = [tx('COSTCO WHSE', 184.20, 8, {cat:'grocery'}), tx('COSTCO WHSE', 184.20, 6, {cat:'grocery'})];
  for (let i = 0; i < 10; i++) t.push(tx('COSTCO WHSE', 150+i, 24*i+20, {cat:'grocery'}));
  ck('frequent-merchant repeat not a duplicate', noFindings(t, /double charge/i), 'same amount, 2 days apart');
}

// 11. a merchant you simply stopped using — not a membership
{
  const t = [];
  for (let i = 5; i < 15; i++) t.push(tx('WHOLE FOODS MKT', 80 + i*3, 25*i, {cat:'grocery'}));
  ck('stopped shopping somewhere is not a saving', noFindings(t, /whole foods/i), 'you shop elsewhere now');
}

// 12. empty account produces nothing rather than noise
ck('no data, no claims', run([]).length === 0);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nHONESTY — are the numbers defensible?\n');

{
  const t = [];
  for (let i = 4; i < 16; i++) t.push(tx('EQUINOX SF', 305, 30*i, {cat:'fitness'}));
  const f = run(t).find(x => /equinox/i.test(x.title));
  ck('annual figure = monthly x 12', f && f.annualCents === f.amountCents*12, f ? `$${f.amountCents/100}/mo -> $${f.annualCents/100}/yr` : 'not found');
  ck('finding explains itself', f && f.detail && f.detail.length > 40, f?.detail?.slice(0,60));
  ck('finding cites evidence', f && f.evidence && Object.keys(f.evidence).length > 0);
}

{
  const t = [tx('CHASE OVERDRAFT FEE', 35, 5, {fee:true})];
  const f = run(t).find(x => /overdraft/i.test(x.title));
  ck('one-off fee is not annualised', f && f.oneOff === true, 'a refunded fee happens once');
}

{
  const t = [];
  for (let i=0;i<20;i++) t.push(tx('DOORDASH', 40+i, i, {cat:'dining', hour:22}));
  for (let i=0;i<30;i++) t.push(tx('DOORDASH', 30, 40+i, {cat:'dining', hour:22}));
  const f = run(t).find(x => x.agent === 'budget_pacer');
  ck('budget alerts make no dollar claim', !f || f.alertOnly === true, 'a hot month is not $X/year');
}

console.log('\n' + (fail ? `${fail} FAILED / ${pass+fail}` : `insight quality verified — ${pass}/${pass} checks`));
process.exit(fail ? 1 : 0);
