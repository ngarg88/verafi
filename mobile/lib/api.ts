const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://your-app.vercel.app';

export async function api(path: string, opts: RequestInit & { token?: string } = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json',
               ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
               ...opts.headers }
  });
  if (!r.ok) throw Object.assign(new Error(await r.text()), { status: r.status });
  return r.json();
}

/** The full approval flow: issue → sign on device → submit. */
export async function approvePurchase({ token, amountCents, merchantSlug, category, savedCents }: any) {
  const { signMandate } = await import('./biometric');
  const { mandate, payloadToSign } = await api('/api/mandates/cart', {
    method: 'POST', token, body: JSON.stringify({ amountCents, merchantSlug, category }) });

  const signed = await signMandate(payloadToSign);
  if ('cancelled' in signed) return { cancelled: true };

  await api('/api/mandates/sign', { method: 'POST', token,
    body: JSON.stringify({ mandateId: mandate.id, signature: signed.signature }) });

  return api('/api/checkout', { method: 'POST', token,
    body: JSON.stringify({ mandateId: mandate.id, category, savedCents }) });
}
