/** Knot adapter: merchant connectivity — card-on-file switching and subscription cancellation. */
export class KnotPort {
  async listSupportedMerchants() { throw new Error('not implemented'); }
  async switchCardOnFile(_p) { throw new Error('not implemented'); }
  async cancelSubscription(_p) { throw new Error('not implemented'); }
}

export class FakeKnot extends KnotPort {
  constructor(fixtures = {}) {
    super();
    // Your cancel/switch feature can never exceed this list. Get the real one under NDA
    // before promising users anything.
    this.supported = fixtures.supported ?? ['netflix','equinox','adobe','amazon','doordash','spotify'];
    this.calls = [];
  }
  async listSupportedMerchants() { return this.supported; }
  async switchCardOnFile({ merchantId, instrumentId }) {
    this.calls.push(['switchCardOnFile', merchantId]);
    if (!this.supported.includes(merchantId)) return { ok: false, reason: 'merchant_not_supported' };
    return { ok: true, merchantId, instrumentId };
  }
  async cancelSubscription({ merchantId }) {
    this.calls.push(['cancelSubscription', merchantId]);
    if (!this.supported.includes(merchantId)) return { ok: false, reason: 'merchant_not_supported' };
    return { ok: true, merchantId, effective: 'end_of_cycle', confirmationRef: 'knot_' + merchantId };
  }
}
