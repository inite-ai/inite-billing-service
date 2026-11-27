import { RAILS } from '../common/connectors/rail';

/** What decides whether a rail would take an order, read without calling it. */
export interface PayableOrder {
  mode: 'PAYMENT' | 'SUBSCRIPTION';
  currency: string;
  productType: string;
  priceMetadata?: unknown;
  productMetadata?: unknown;
  /** A lava.top offer named on the order itself. */
  orderLavaOfferId?: unknown;
  /** The order costs less than its price (a promo code). */
  discounted?: boolean;
}

export interface PayableProvider {
  code: string;
  currencies: string[];
  config?: unknown;
}

const LAVA_NATIVE = ['RUB', 'USD', 'EUR'];
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/**
 * Why a rail would refuse this order, or null when nothing here says it would.
 *
 * The page offered a rail by currency alone, so a plan showed PIX or a card and
 * was refused after the click: Hodle takes one-time payments only, and lava.top
 * bills a subscription only through an offer named on its price.
 *
 * Not decided by `supportedModes`: crypto declares PAYMENT and still takes a
 * subscription's order, one period at a time. Each rule mirrors one refusal in
 * an adapter; test/payable-contract.spec.ts holds them to the real adapters.
 */
export function railRefuses(provider: PayableProvider, order: PayableOrder): string | null {
  const currency = order.currency.toUpperCase();
  const subscription = order.mode === 'SUBSCRIPTION';

  if (provider.code === RAILS.HODLE) {
    if (subscription) return 'one_time_only';
    return currency === 'BRL' ? null : 'currency';
  }

  if (provider.code === RAILS.LAVA) {
    const config = record(provider.config);
    const ticked = provider.currencies.map((c) => c.toUpperCase()).includes(currency);
    const converting = !LAVA_NATIVE.includes(currency);
    if (converting) {
      if (!ticked) return 'currency';
      if (subscription) return 'subscription_not_converted';
      return config.defaultOfferId ? null : 'no_default_offer';
    }
    const own =
      order.orderLavaOfferId ||
      record(order.priceMetadata).lavaOfferId ||
      record(order.productMetadata).lavaOfferId;
    if (own && !order.discounted && order.productType !== 'open') return null;
    if (subscription) return own ? 'discounted_subscription' : 'no_subscription_offer';
    return config.defaultOfferId ? null : 'no_default_offer';
  }

  return null;
}
