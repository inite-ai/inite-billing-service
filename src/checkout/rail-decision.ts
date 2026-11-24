import { Connector } from '../common/connectors/connector.interface';
import { RAILS } from '../common/connectors/rail';
import { Quote, QuoteInput, QuoteProvider, refuse } from '../common/connectors/rail-contract';
import { toMoney } from '../common/money';
import { renewalsEnabled } from '../subscription-lifecycle/renewals-config';

/** An order, or a price that could become one, as rails are asked about it. */
export function quoteInput(order: {
  amount: unknown;
  currency: string;
  mode: 'PAYMENT' | 'SUBSCRIPTION';
  metadata?: unknown;
  price: {
    amount: unknown;
    interval?: string | null;
    metadata?: unknown;
    product: { type: string; metadata?: unknown };
  };
}): QuoteInput {
  return {
    amount: toMoney(order.amount as any),
    listAmount: toMoney(order.price.amount as any),
    currency: String(order.currency).toUpperCase(),
    interval: order.price.interval && order.price.interval !== 'none' ? order.price.interval : null,
    recurring: order.mode === 'SUBSCRIPTION',
    productType: order.price.product.type,
    orderMetadata: order.metadata,
    priceMetadata: order.price.metadata,
    productMetadata: order.price.product.metadata,
  };
}

/**
 * What a rail would do with this order. Null: the rail does not answer, and is
 * treated as it always was.
 *
 * A plan collected one payment at a time is sold only while billing renews
 * such plans itself; otherwise it would end with its first period and nobody
 * told the buyer. Crypto has sold plans this way all along and is left as is.
 */
export function railDecision(
  connector: Connector | null,
  provider: QuoteProvider,
  order: QuoteInput,
): Quote | null {
  const quote = connector?.quote?.(order, provider) ?? null;
  if (
    quote?.ok &&
    order.recurring &&
    quote.strategy === 'buyer_approved' &&
    provider.code !== RAILS.CRYPTO &&
    !renewalsEnabled()
  ) {
    return refuse('renewals_off');
  }
  return quote;
}
