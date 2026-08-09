/**
 * Plaid REST client over plain fetch. No SDK, no npm install.
 *
 * Environments:
 *   sandbox    — fake banks, works instantly, user_good / pass_good
 *   production — REAL banks. On a Trial plan this is auto-approved for most
 *                developers and covers up to 10 Items, which is plenty for one person.
 */
const HOSTS = { sandbox: 'https://sandbox.plaid.com', production: 'https://production.plaid.com' };

export class Plaid {
  constructor({ clientId, secret, env = 'sandbox' }) {
    if (!clientId || !secret) throw new Error('PLAID_CLIENT_ID and PLAID_SECRET are required');
    Object.assign(this, { clientId, secret, host: HOSTS[env] ?? HOSTS.sandbox, env });
  }
  async call(path, body = {}) {
    // Plaid is usually fast but occasionally is not. A slow sync must not wedge a request.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Number(process.env.PLAID_TIMEOUT_MS ?? 30000));
    let r;
    try {
      r = await fetch(this.host + path, {
        method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: this.clientId, secret: this.secret, ...body })
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? `plaid ${path} timed out` : `plaid ${path}: ${e.message}`);
    } finally { clearTimeout(timer); }
    const j = await r.json();
    if (!r.ok) throw new Error(`plaid ${path} ${r.status}: ${j.error_code ?? ''} ${j.error_message ?? ''}`);
    return j;
  }
  createLinkToken(userId) {
    return this.call('/link/token/create', {
      user: { client_user_id: userId }, client_name: 'Verafi',
      products: ['transactions'], country_codes: ['US'], language: 'en'
    });
  }
  exchange(publicToken)      { return this.call('/item/public_token/exchange', { public_token: publicToken }); }
  accounts(accessToken)      { return this.call('/accounts/get', { access_token: accessToken }); }
  institution(id)            { return this.call('/institutions/get_by_id', { institution_id: id, country_codes:['US'] }); }
  sync(accessToken, cursor)  { return this.call('/transactions/sync', { access_token: accessToken, ...(cursor ? { cursor } : {}), count: 500 }); }

  /** Pull everything Plaid will give us, following the cursor to the end. */
  async syncAll(accessToken, cursor) {
    let added = [], modified = [], removed = [], more = true, cur = cursor;
    while (more) {
      const p = await this.sync(accessToken, cur);
      added.push(...p.added); modified.push(...p.modified); removed.push(...p.removed);
      cur = p.next_cursor; more = p.has_more;
    }
    return { added, modified, removed, cursor: cur };
  }
}

/** Plaid's shape → the shape packages/core expects. One place, easy to audit. */
export function toCoreTx(t, instrumentByAccount = {}) {
  const merchant = (t.merchant_name ?? t.name ?? 'unknown').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  const cat = (t.personal_finance_category?.primary ?? 'OTHER').toLowerCase();
  const map = { food_and_drink:'dining', general_merchandise:'retail', travel:'travel',
                transportation:'transport', rent_and_utilities:'bills', entertainment:'entertainment',
                loan_payments:'bills', medical:'health', personal_care:'personal',
                general_services:'services', bank_fees:'fee', transfer_out:'transfer', transfer_in:'transfer' };
  return {
    id: t.transaction_id, externalId: t.transaction_id,
    merchantId: merchant, merchantName: t.merchant_name ?? t.name,
    accountId: t.account_id, instrumentId: instrumentByAccount[t.account_id] ?? null,
    amountCents: Math.round(t.amount * 100),          // Plaid: positive = money out
    postedAt: new Date(t.datetime ?? t.authorized_date ?? t.date).getTime(),
    localHour: t.datetime ? new Date(t.datetime).getHours() : 13,
    category: map[cat] ?? cat, mcc: null,
    isFee: cat === 'bank_fees' || /\bfee\b|overdraft|atm surcharge/i.test(t.name ?? ''),
    pending: !!t.pending,
    cardRewardMultiplier: 1, bestAvailableMultiplier: 1
  };
}
