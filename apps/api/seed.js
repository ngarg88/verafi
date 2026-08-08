import { CAPABILITY, SURFACE, makeAgent, makeSavingsEvent, verify, METHOD } from '../../packages/core/index.js';

const DAY = 86400000;

export function seed(repo, { publicKeyPem }) {
  const u = repo.createUser('neel@example.com');
  const dev = repo.addDevice(u.id, publicKeyPem);

  for (const [slug, name, trust, knot] of [
    ['amazon','Amazon',0.94,true], ['bestbuy','Best Buy',0.91,true],
    ['woot','Woot',0.72,false], ['costco','Costco',0.95,true],
    ['ana','ANA',0.93,false], ['netflix','Netflix',0.97,true],
    ['equinox','Equinox',0.96,true], ['adobe','Adobe',0.96,true],
    ['sketchy-store','Unknown Storefront',0.31,false]
  ]) repo.db.merchants.set(slug, { slug, name, trustScore: trust, knotSupported: knot });

  repo.db.instruments.push(
    { id:'amex',  userId:u.id, rail:'card_credit', displayName:'Amex Gold ···4021',
      rewardsByMcc:{ 5812:4, 5411:4, default:1 }, ownedByPlatform:false },
    { id:'csr',   userId:u.id, rail:'card_credit', displayName:'Sapphire Reserve ···9930',
      rewardsByMcc:{ 4511:3, 7011:3, default:1 }, ownedByPlatform:false },
    { id:'debit', userId:u.id, rail:'card_debit', displayName:'Chase debit ···1187',
      balanceCents: 841_209, rewardsByMcc:{ default:0 }, ownedByPlatform:false },
    { id:'ach',   userId:u.id, rail:'ach', displayName:'ACH from Chase ···1187', ownedByPlatform:false },
    { id:'usdc',  userId:u.id, rail:'stablecoin', displayName:'Coinbase Wallet (self-custody)',
      balanceCents: 124_055, ownedByPlatform:false }
  );

  const now = Date.now();
  const push = (merchantId, amountCents, daysAgo, o={}) => repo.db.transactions.push({
    id:'tx_'+repo.db.transactions.length, userId:u.id, merchantId, amountCents,
    postedAt: now - daysAgo*DAY, localHour: o.localHour ?? 13,
    category: o.category ?? 'retail', mcc: o.mcc ?? 5999, isFee: o.isFee ?? false,
    cardRewardMultiplier: o.cardRewardMultiplier ?? 1,
    bestAvailableMultiplier: o.bestAvailableMultiplier ?? 1, ...o
  });

  for (let i = 0; i < 9; i++) push('netflix', 2499, 30*i + 4, { category:'subscription' });
  for (let i = 0; i < 7; i++) push('equinox', 30500, 30*i + 74, { category:'subscription' }); // billing, dormant
  for (let i = 0; i < 8; i++) push('adobe', 5999, 30*i + 9, { category:'subscription' });
  for (let i = 0; i < 9; i++) push('costco', 18420, 24*i + 3, { category:'grocery', mcc:5411 });
  for (let i = 0; i < 22; i++) push('amazon', 3800 + i*37, i*3 + 1,
    { category:'dining', mcc:5812, localHour: i % 3 === 0 ? 14 : 22, cardRewardMultiplier:1, bestAvailableMultiplier:4 });
  push('chase', 3500, 12, { category:'fee', isFee:true });
  push('chase', 3500, 44, { category:'fee', isFee:true });
  push('chase', 1500, 71, { category:'fee', isFee:true });

  const preset = (surface, name, capability, evidence, enabled=false) =>
    repo.saveAgent({ ...makeAgent({ id:`agt_${repo.db.agents.length}`, userId:u.id, surface, name, capability, enabled }), evidence });

  preset(SURFACE.ASK,  'Deal Hunter',          CAPABILITY.RECOMMEND, 'Checks 14 merchants, coupons and cashback before any buy', true);
  preset(SURFACE.ASK,  'Price Patience',       CAPABILITY.RECOMMEND, '8 of your last 11 electronics purchases dropped after you bought', true);
  preset(SURFACE.ASK,  'Restock Runner',       CAPABILITY.EXECUTE_PREAUTHORIZED, 'You reorder from Costco on a steady ~24-day cadence');
  preset(SURFACE.SPEND,'Fee Catcher',          CAPABILITY.EXECUTE_AUTHORIZED, '$85 in avoidable fees found in your history', true);
  preset(SURFACE.SPEND,'Duplicate Watch',      CAPABILITY.OBSERVE, 'Catches double-charges and pending/posted mismatches', true);
  preset(SURFACE.SPEND,'Late-Night Guard',     CAPABILITY.OBSERVE, '67% of your delivery orders are placed after 9pm');
  preset(SURFACE.SAVE, 'Subscription Auditor', CAPABILITY.EXECUTE_AUTHORIZED, '1 subscription billing for 74 days without use', true);
  preset(SURFACE.SAVE, 'Card Router',          CAPABILITY.RECOMMEND, '$894 spent on a 1x card where you hold a 4x card', true);
  preset(SURFACE.SAVE, 'Bill Negotiator',      CAPABILITY.EXECUTE_AUTHORIZED, 'Requests better rates on insurance, internet, phone');

  repo.saveMandate({
    id:'mnd_root', userId:u.id, type:'root', deviceId: dev.id,
    perTxCents: 50_000, dailyCents: 120_000, monthlyCents: 400_000,
    allowedCategories:['retail','travel','grocery','subscription'],
    blockedCategories:['crypto','gambling','gift_card','p2p'],
    minMerchantTrust: 0.6, issuedAt: now, expiresAt: now + 90*DAY, revokedAt: null
  });

  repo.addSavings(verify(makeSavingsEvent({ id:'sv_1', userId:u.id, method:METHOD.SUBSCRIPTION_CANCEL,
    amountCents: 1199, recurringMonths: 11, evidence:{ kind:'email', ref:'dropbox-cancel-aug-2' } })));
  repo.addSavings(verify(makeSavingsEvent({ id:'sv_2', userId:u.id, method:METHOD.NEGOTIATION,
    amountCents: 18600, evidence:{ kind:'quote', before: 94800, after: 76200 } })));
  repo.addSavings(makeSavingsEvent({ id:'sv_3', userId:u.id, method:METHOD.CARD_ROUTING,
    amountCents: 3140, evidence:{ kind:'tx', ref:'tx_11', before:1, after:4 } }));  // pending on purpose

  return { user: u, device: dev };
}
