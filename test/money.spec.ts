import { Decimal } from '@prisma/client/runtime/library';
import {
  clampToZero,
  minMoney,
  moneyToNumber,
  percentOf,
  roundMoney,
  sumMoney,
  toMoney,
} from '../src/common/money';

/**
 * Money is `Decimal(19,4)` everywhere it is stored, and float arithmetic on it
 * is how a fifteen-percent discount on 19.99 arrives as 16.991499999999998 —
 * then gets "fixed" by `Math.round(x * 10000) / 10000`, which lands on the
 * wrong side for exactly the values that sit on a boundary.
 */
describe('money', () => {
  it('takes a discount off a price without inventing a fraction', () => {
    // In floats: 19.99 * 0.15 === 2.9984999999999995
    const discount = percentOf('19.99', 15);
    expect(discount.toFixed(4)).toBe('2.9985');
    expect(toMoney('19.99').minus(discount).toFixed(4)).toBe('16.9915');
  });

  it('rounds half away from zero, as an invoice says it does', () => {
    // Math.round(1.00005 * 10000) / 10000 === 1.0001 by luck, 8.00005 is not.
    expect(roundMoney('1.00005').toFixed(4)).toBe('1.0001');
    expect(roundMoney('8.00005').toFixed(4)).toBe('8.0001');
    expect(roundMoney('2.00004').toFixed(4)).toBe('2.0000');
  });

  it('adds without drift', () => {
    // 0.1 + 0.2 === 0.30000000000000004
    expect(sumMoney(['0.1', '0.2']).toFixed(4)).toBe('0.3000');
    expect(sumMoney(Array.from({ length: 10 }, () => '0.1')).toFixed(4)).toBe('1.0000');
  });

  it('caps a discount at the price rather than paying the customer', () => {
    expect(minMoney('30.00', '19.99').toFixed(2)).toBe('19.99');
    expect(clampToZero(toMoney('19.99').minus('30.00')).toFixed(2)).toBe('0.00');
  });

  it('accepts whatever Prisma hands back', () => {
    expect(toMoney(new Decimal('12.3400')).toFixed(2)).toBe('12.34');
    expect(toMoney('12.34').toFixed(2)).toBe('12.34');
    expect(toMoney(12.34).toFixed(2)).toBe('12.34');
    expect(toMoney(null).toFixed(2)).toBe('0.00');
  });

  it('converts to a number only at the edge, already rounded', () => {
    expect(moneyToNumber('16.99149')).toBe(16.9915);
  });
});
