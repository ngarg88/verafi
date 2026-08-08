import { assertPassThrough } from '../core/rails.js';

/**
 * Payment initiation. Every method asserts the destination is not platform-owned
 * before it does anything else. This is the compliance boundary, in code.
 */
export class PspPort {
  async authorizeCard(_p) { throw new Error('not implemented'); }
  async initiateAch(_p) { throw new Error('not implemented'); }
  async prepareStablecoinTx(_p) { throw new Error('not implemented'); }
}

export class FakePsp extends PspPort {
  constructor() { super(); this.calls = []; }

  async authorizeCard({ networkTokenRef, amountCents, merchantAccount, mandateId }) {
    assertPassThrough(merchantAccount);
    if (!networkTokenRef) throw new Error('card authorization requires a single-use network token');
    if (!mandateId) throw new Error('card authorization requires a signed mandate');
    this.calls.push(['authorizeCard', amountCents]);
    return { authId: 'auth_' + Date.now().toString(36), network: 'visa_trusted_agent',
             amountCents, latencyMs: 340, settlesTo: merchantAccount.id };
  }

  async initiateAch({ fromAccount, toAccount, amountCents, mandateId }) {
    assertPassThrough(toAccount);
    if (!mandateId) throw new Error('ach requires a signed mandate');
    this.calls.push(['initiateAch', amountCents]);
    return { transferId: 'ach_' + Date.now().toString(36), status: 'pending',
             etaDays: 2, from: fromAccount.id, to: toAccount.id, amountCents };
  }

  /**
   * We never hold keys. We build the transaction; the user's own wallet signs it.
   * Returning an unsigned payload is the whole point.
   */
  async prepareStablecoinTx({ toAddress, amountCents, chain = 'base' }) {
    this.calls.push(['prepareStablecoinTx', amountCents]);
    return { unsignedTx: { to: toAddress, valueUsdc: amountCents / 100, chain },
             requiresUserSignature: true, custodial: false };
  }
}
