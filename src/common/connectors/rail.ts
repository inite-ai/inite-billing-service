/**
 * Canonical payment-rail identity — the SINGLE source of truth for rail ids.
 *
 * Before this, the rail string was re-typed across ≥6 files with three
 * disagreeing spellings for Apple/Google (`APPLE` vs `APPLE_IAP`), which is what
 * silently broke mobile subscription linkage. Every place that names a rail —
 * adapter `rail()`, `PaymentProvider.code`, the webhook route, the orchestrator
 * switch — should use these constants so the identity can never drift again.
 */
export const RAILS = {
  ONE: 'ONE',
  LAVA: 'LAVA',
  STRIPE: 'STRIPE',
  CRYPTO: 'CRYPTO',
  APPLE_IAP: 'APPLE_IAP',
  GOOGLE_PLAY: 'GOOGLE_PLAY',
  /** Virtual rail: a 100%-off promo has no provider/adapter and goes straight
   * to fulfilment. It must never be looked up as a live adapter. */
  PROMO: 'PROMO',
} as const;

export type Rail = (typeof RAILS)[keyof typeof RAILS];

/** All known rail ids, including virtual ones. */
export const ALL_RAILS: Rail[] = Object.values(RAILS);

/** Rails that have no payment adapter (fulfilment happens without a provider). */
export const VIRTUAL_RAILS: readonly Rail[] = [RAILS.PROMO];

export function isRail(value: string): value is Rail {
  return (ALL_RAILS as readonly string[]).includes(value);
}

export function isVirtualRail(value: string): boolean {
  return (VIRTUAL_RAILS as readonly string[]).includes(value);
}
