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

/**
 * An on-chain integer amount as a decimal token amount, without trailing zeros
 * beyond what identifies it: `10000137` at 6 decimals is `10.000137`, and
 * `10000000` is `10`. Exact — string arithmetic only.
 */
export function formatUnits(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid on-chain amount: ${raw}`);
  if (decimals === 0) return raw.replace(/^0+(?=\d)/, '');
  const padded = raw.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals).replace(/^0+(?=\d)/, '');
  const frac = padded.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Parse a token amount that may be given either in smallest units (`"10000000"`)
 * or as a decimal (`"10.0"`), as indexers disagree on which they report.
 * Returns null when it cannot be read.
 */
export function parseRawAmount(value: unknown, decimals: number): bigint | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return BigInt(s);
  const m = s.match(/^(\d+)\.(\d+)$/);
  if (!m) return null;
  if (m[2].length > decimals && /[1-9]/.test(m[2].slice(decimals))) return null;
  const frac = m[2].padEnd(decimals, '0').slice(0, decimals);
  return BigInt(m[1] + frac);
}
