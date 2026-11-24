import { RAILS } from '../common/connectors/rail';

/**
 * Plan prices in these currencies sit below the dollar price of the same plan.
 * The reader picks the currency in a footer, so without a check anyone could
 * pick the cheapest list. EUR, USD and RUB are not listed: they need no proof.
 */
export const LOCAL_PRICE_CURRENCIES: ReadonlySet<string> = new Set([
  'BRL',
  'MXN',
  'ARS',
  'CLP',
  'COP',
]);

/**
 * Rails that by themselves prove where the payer is: a PIX is paid from a
 * Brazilian account. A rail is added here only for a currency it cannot take
 * from abroad. Crypto carries no country, and a rail that converts the price
 * into dollars takes any card, so neither belongs here.
 */
const RAIL_PROVES: Record<string, ReadonlySet<string>> = {
  [RAILS.HODLE]: new Set(['BRL']),
};

/** Off unless LOCAL_CURRENCY_PROOF_ENABLED=true, like every new subsystem. */
export function currencyProofEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LOCAL_CURRENCY_PROOF_ENABLED === 'true';
}

/**
 * Whether this order may be paid only with proof of the payer's country.
 * Renewals and plan changes are held to it too: a trial opens a subscription
 * with no payment, so its first charge may be the first proof there is. Nothing
 * the caller sends (price code, metadata, cookie, header, language) is proof.
 */
export function needsCountryProof(order: { currency: string; productType: string }): boolean {
  // One-time items (books, donations, credit packs) keep selling as they did:
  // their local prices were set before this rule and are not plan prices.
  if (order.productType !== 'subscription') return false;
  return LOCAL_PRICE_CURRENCIES.has(String(order.currency).toUpperCase());
}

/** Whether paying on this rail proves the payer is in the currency's country. */
export function railProvesCountry(rail: string, currency: string): boolean {
  return RAIL_PROVES[rail]?.has(String(currency).toUpperCase()) ?? false;
}
