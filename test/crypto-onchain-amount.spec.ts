import { toOnChainAmount } from '../src/adapters/crypto/amount.util';

/**
 * On-chain amounts must be scaled without floating-point error — the old
 * `BigInt(Math.round(amount * 10 ** decimals))` loses precision for high-decimal
 * tokens and some values, requesting/validating the wrong integer amount.
 */
describe('toOnChainAmount', () => {
  it('scales USDT/USDC (6 decimals) exactly', () => {
    expect(toOnChainAmount(10, 6)).toBe('10000000');
    expect(toOnChainAmount(10.1, 6)).toBe('10100000');
    expect(toOnChainAmount(0.5, 6)).toBe('500000');
    expect(toOnChainAmount(0, 6)).toBe('0');
  });

  it('collapses float artifacts at the token precision', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754.
    expect(toOnChainAmount(0.1 + 0.2, 6)).toBe('300000');
  });

  it('scales 18-decimal tokens without the multiply-then-round error', () => {
    // Float-exact values: multiplying by 1e18 loses precision, string scaling
    // does not. (A value that is not float-exact, like 0.1, is limited by the
    // number input itself — that is a caller concern, not this function's.)
    expect(toOnChainAmount(1.5, 18)).toBe('1500000000000000000');
    expect(toOnChainAmount(2.25, 18)).toBe('2250000000000000000');
    expect(toOnChainAmount(100, 18)).toBe('100000000000000000000');
  });

  it('rounds to the token precision (values below one unit)', () => {
    // 6 decimals: 1.2345678 rounds to 1.234568 → 1234568.
    expect(toOnChainAmount(1.2345678, 6)).toBe('1234568');
  });

  it('handles zero decimals', () => {
    expect(toOnChainAmount(42, 0)).toBe('42');
  });

  it('rejects invalid input', () => {
    expect(() => toOnChainAmount(Number.NaN, 6)).toThrow();
    expect(() => toOnChainAmount(1, -1)).toThrow();
  });
});
