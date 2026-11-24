import { Decimal } from '@prisma/client/runtime/library';

/**
 * Money arithmetic, in decimal.
 *
 * Every amount in this service is `Decimal(19,4)` in the database, and Prisma
 * hands it back as a `Decimal`. Converting one to a JS number to do arithmetic
 * and rounding the result with `Math.round(x * 10000) / 10000` is how a
 * fifteen-percent discount on 19.99 becomes 16.991499999999998 — binary floats
 * cannot represent most decimal fractions, and the error compounds through
 * every operation before the rounding that was supposed to hide it.
 *
 * These are thin wrappers, not a new type: the point is that there is an
 * obvious right answer to reach for, and that the arithmetic happens in decimal
 * even when the value has to leave as a number at an API boundary.
 */

/** The scale every stored amount uses. */
export const MONEY_SCALE = 4;

export type MoneyInput = Decimal | string | number | { toString(): string };

export function toMoney(value: MoneyInput | null | undefined): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  return value instanceof Decimal ? value : new Decimal(value.toString());
}

/** Round to the stored scale, half away from zero — the rule invoices state. */
export function roundMoney(value: MoneyInput): Decimal {
  return toMoney(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** `percent` as written on the promo code: 15 means fifteen percent. */
export function percentOf(amount: MoneyInput, percent: MoneyInput): Decimal {
  return roundMoney(toMoney(amount).mul(toMoney(percent)).div(100));
}

/** Never below zero: a discount cannot turn into a payout. */
export function clampToZero(value: MoneyInput): Decimal {
  const amount = toMoney(value);
  return amount.lt(0) ? new Decimal(0) : amount;
}

export function minMoney(a: MoneyInput, b: MoneyInput): Decimal {
  const left = toMoney(a);
  const right = toMoney(b);
  return left.lte(right) ? left : right;
}

export function sumMoney(values: Iterable<MoneyInput>): Decimal {
  let total = new Decimal(0);
  for (const value of values) total = total.plus(toMoney(value));
  return total;
}

/**
 * For an API field typed as a number. The arithmetic is already done; this is
 * the last step before serialisation, not a step in the calculation.
 */
export function moneyToNumber(value: MoneyInput): number {
  return roundMoney(value).toNumber();
}

/** ISO 4217 currencies whose smallest unit is not a hundredth. */
const MINOR_DIGITS: Record<string, number> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

/** How many decimals a currency has: 2 for most, 0 for CLP or JPY, 3 for KWD. */
export function minorDigits(currency: string): number {
  return MINOR_DIGITS[String(currency).toUpperCase()] ?? 2;
}

/** An amount in a currency's smallest unit (cents), as an exact decimal. */
export function fromMinorUnits(minor: number | string | bigint, currency: string): Decimal {
  return new Decimal(minor.toString()).div(new Decimal(10).pow(minorDigits(currency)));
}

/** An exact amount in a currency's smallest unit; refuses one finer than that unit. */
export function toMinorUnits(amount: Decimal | string | number, currency: string): number {
  const minor = new Decimal(amount.toString()).mul(new Decimal(10).pow(minorDigits(currency)));
  if (!minor.isInteger()) {
    throw new Error(`${amount} ${currency} is finer than the currency's smallest unit`);
  }
  return minor.toNumber();
}
