/**
 * Billing's own renewals (PIX, crypto, the INITE wallet) ship dark, like
 * every new subsystem here: SUBSCRIPTION_RENEWALS_ENABLED=true turns them on.
 * While off, a subscription on such a rail ends with its period, as before.
 */
export function renewalsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUBSCRIPTION_RENEWALS_ENABLED === 'true';
}

/** How many days before a period ends its renewal link is sent (default 3, 1–14). */
export function renewalLeadDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SUBSCRIPTION_RENEWAL_LEAD_DAYS);
  if (!Number.isInteger(raw) || raw < 1 || raw > 14) return 3;
  return raw;
}
