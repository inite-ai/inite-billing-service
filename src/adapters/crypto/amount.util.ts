/**
 * Convert a token amount (major units, e.g. 10.10 USDT) to its on-chain integer
 * amount in the token's smallest unit, as a decimal string.
 *
 * The previous `BigInt(Math.round(amount * 10 ** decimals))` did the scaling in
 * IEEE-754 floating point, which loses precision for large amounts or high
 * decimal counts (e.g. 18-decimal tokens) — the wrong integer amount would be
 * requested/validated on chain. Rounding the value to the token's precision with
 * toFixed(decimals) and then scaling by string concatenation keeps the math
 * exact (integer-only via BigInt).
 */
export function toOnChainAmount(amount: number, decimals: number): string {
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`Invalid token decimals: ${decimals}`);
  }

  const negative = amount < 0;
  // toFixed rounds to the token's precision (the smallest representable unit),
  // so float artifacts like 0.30000000000000004 collapse to "0.300000".
  const fixed = Math.abs(amount).toFixed(decimals);
  const [intPart, fracPart = ''] = fixed.split('.');
  const digits = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, '');
  const scaled = BigInt(digits === '' ? '0' : digits);
  return (negative ? -scaled : scaled).toString();
}
