import { Decimal } from '@prisma/client/runtime/library';
import { ConnectorCapabilities } from '../common/connectors/connector.interface';
import { toMoney } from '../common/money';

/**
 * The smallest amount a rail takes in a currency, or null when none is known.
 *
 * A rail declares what its provider documents (`capabilities().minAmounts`:
 * PIX through Hodle refuses under R$1.00). An admin may state a provider's
 * minimum on the provider (`PaymentProvider.config.minAmounts`, e.g.
 * `{ "USD": "1.00" }`) when the provider has one it does not publish, and the
 * higher of the two wins. Amounts are in the order's own currency: a rail that
 * converts a currency is checked only if a minimum is stated for that one.
 */
export function railMinimum(
  capabilities: ConnectorCapabilities | undefined,
  providerConfig: unknown,
  currency: string,
): Decimal | null {
  const cur = currency.toUpperCase();
  const declared = read(capabilities?.minAmounts?.[cur]);
  const configured = read(
    ((providerConfig ?? {}) as Record<string, any>).minAmounts?.[cur] as unknown,
  );
  if (declared && configured) return declared.gt(configured) ? declared : configured;
  return declared ?? configured;
}

/** Whether `amount` meets the rail's minimum in `currency` (true when it has none). */
export function meetsRailMinimum(
  amount: Decimal,
  capabilities: ConnectorCapabilities | undefined,
  providerConfig: unknown,
  currency: string,
): boolean {
  const min = railMinimum(capabilities, providerConfig, currency);
  return !min || amount.gte(min);
}

function read(value: unknown): Decimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  if (!/^\d{1,12}(?:\.\d{1,4})?$/.test(s)) return null;
  return toMoney(s);
}
