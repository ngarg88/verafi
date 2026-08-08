/**
 * Planners return TYPED STEPS, never executable text.
 *
 * RulePlanner covers every MVP path with zero model calls — cheaper, faster, and
 * deterministic enough to unit-test. LlmPlanner is the escape hatch for open-ended
 * intents; note that it still returns steps that the registry re-validates.
 */
export class RulePlanner {
  async plan({ intentText, capability }) {
    const s = (intentText ?? '').toLowerCase();
    const canBuy = capability === 'execute_authorized' || capability === 'execute_preauthorized';

    if (/cancel|subscription|unused|audit/.test(s)) {
      return [
        step('context.load', 'Reading your spending context'),
        step('subscriptions.find', 'Finding subscriptions you stopped using'),
        ...(canBuy ? [step('subscriptions.cancel', 'Cancelling the dead ones')] : [])
      ];
    }
    if (/which card|card|rewards|routing/.test(s)) {
      return [step('context.load', 'Reading your spending context'),
              step('cards.optimize', 'Checking which card wins where')];
    }
    if (/fee|overdraft|atm|refund/.test(s)) {
      return [step('context.load', 'Reading your spending context'),
              step('fees.find', 'Scanning for avoidable fees')];
    }
    // default: a shopping intent
    return [
      step('context.load',   'Reading your spending context'),
      step('catalog.search', 'Searching merchants and live inventory'),
      step('price.history',  'Checking 90-day price history'),
      step('deals.resolve',  'Stacking coupons, cashback and card rewards'),
      step('offers.rank',    'Ranking by true net cost'),
      step('purchase.propose', 'Preparing the purchase for your approval')
    ];
  }
}
const step = (tool, label, args) => ({ tool, label, args });

/** Wire your model here. It must return the same typed shape — nothing else changes. */
export class LlmPlanner {
  constructor({ complete, fallback = new RulePlanner() }) { this.complete = complete; this.fallback = fallback; }
  async plan(input) {
    try {
      const raw = await this.complete({
        system: 'Return ONLY a JSON array of {tool,label,args}. Tools available: '
              + input.tools.map(t => t.name).join(', ') + '. No prose.',
        user: input.intentText
      });
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(s => typeof s.tool === 'string')) throw new Error('bad plan shape');
      return parsed;
    } catch {
      return this.fallback.plan(input);   // a malformed plan must never halt the product
    }
  }
}
