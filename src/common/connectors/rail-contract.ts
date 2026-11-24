import { Decimal } from '@prisma/client/runtime/library';

/**
 * What a rail says about an order before anyone clicks, and what it is asked
 * to do with it. Pure: no network, no database — the provider's row is passed
 * in, so an answer is as fresh as the row (a lava.top offer saved a moment ago
 * counts at once).
 */

/** Who starts a charge of a subscription's period. */
export type Strategy = 'provider_managed' | 'merchant_initiated' | 'buyer_approved';

/** What the adapter is asked to open. The buyer's side does not choose it. */
export type Purpose = 'one_off' | 'open_provider_subscription';

/** Why a rail does not take an order. Codes, read by the page and by admins. */
export type RefusalReason =
  | 'not_configured'
  | 'currency'
  | 'below_minimum'
  | 'interval'
  | 'no_offer'
  | 'no_general_offer'
  | 'app_store_only'
  | 'no_adapter'
  | 'no_method'
  | 'renewals_off';

export interface QuoteInput {
  /** Exact, in the order's own currency. */
  amount: Decimal;
  /** The price before any discount. */
  listAmount: Decimal;
  currency: string;
  interval: string | null;
  /** The order is for a plan that goes on, not for one period or a thing. */
  recurring: boolean;
  productType: string;
  orderMetadata?: unknown;
  priceMetadata?: unknown;
  productMetadata?: unknown;
}

/** The provider row as an adapter may read it. Never leaves the server. */
export interface QuoteProvider {
  code: string;
  currencies: string[];
  config?: unknown;
}

export type Quote =
  | { ok: true; purpose: Purpose; strategy: Strategy; chargedIn: string }
  | { ok: false; reason: RefusalReason };

export const refuse = (reason: RefusalReason): Quote => ({ ok: false, reason });

export const record = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' ? (v as Record<string, any>) : {};

/** Whether the admin ticked this currency on the provider. */
export const ticked = (provider: QuoteProvider, currency: string): boolean =>
  provider.currencies.some((c) => c.toUpperCase() === currency.toUpperCase());
