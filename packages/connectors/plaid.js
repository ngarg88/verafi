/**
 * Plaid adapter. The interface is what matters — swap `FakePlaid` for `PlaidClient`
 * with real credentials and nothing upstream changes.
 */
export class PlaidPort {
  async createLinkToken(_userId) { throw new Error('not implemented'); }
  async exchangePublicToken(_publicToken) { throw new Error('not implemented'); }
  async syncTransactions(_accessToken, _cursor) { throw new Error('not implemented'); }
  async getBalances(_accessToken) { throw new Error('not implemented'); }
  async initiateTransfer(_p) { throw new Error('not implemented'); }
}

export class FakePlaid extends PlaidPort {
  constructor(fixtures = {}) { super(); this.f = fixtures; this.calls = []; }
  async createLinkToken(userId) { this.calls.push(['createLinkToken', userId]); return { linkToken: 'link-sandbox-' + userId }; }
  async exchangePublicToken(publicToken) {
    this.calls.push(['exchangePublicToken', publicToken]);
    return { accessToken: 'access-sandbox-x', itemId: 'item_1', institutions: this.f.institutions ?? 2 };
  }
  async syncTransactions(_a, cursor = null) {
    this.calls.push(['syncTransactions', cursor]);
    return { added: this.f.transactions ?? [], nextCursor: 'cur_end', hasMore: false };
  }
  async getBalances() { this.calls.push(['getBalances']); return this.f.balances ?? []; }
  /** Bank → recipient. Money never touches us; that's why there is no `amountToPlatform`. */
  async initiateTransfer({ fromAccountId, toAccountId, amountCents, description }) {
    this.calls.push(['initiateTransfer', amountCents]);
    if (!toAccountId) throw new Error('transfer requires an explicit destination account');
    return { transferId: 'tr_' + Date.now(), status: 'pending', fromAccountId, toAccountId, amountCents, description };
  }
}
