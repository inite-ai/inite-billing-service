import { BadRequestException } from '@nestjs/common';
import {
  checkBounds,
  checkRef,
  openConfig,
  openDailyCap,
  openEntitlementKey,
  openPriceCode,
  parseOpenAmount,
  sanitizeTitle,
} from '../src/checkout/open-product';
import { meetsRailMinimum, railMinimum } from '../src/checkout/rail-minimums';
import { toMoney } from '../src/common/money';

/**
 * The open product's rules, without a database: a service names the amount,
 * title and ref of what it sells, so each of them is a place it could ask for
 * more than the product allows — an amount out of bounds, a title that
 * disguises itself on the receipt, a ref that escapes its namespace, an
 * entitlement in another service's.
 */
describe('open product rules', () => {
  const product = (metadata: Record<string, unknown>, type = 'open') => ({
    code: 'education-open',
    type,
    metadata: {
      open: { currencies: { USD: { min: '1.00', max: '50.00' }, brl: { min: '5', max: '250' } } },
      ...metadata,
    },
  });
  const course = product({
    entitlementTemplate: 'education:course:{ref}',
    itemParams: { ref: '^[a-z0-9][a-z0-9-]{0,79}$' },
  });

  describe('openConfig', () => {
    it('reads the bounds per currency, upper-cased', () => {
      const config = openConfig(course, 'education');
      expect(Object.keys(config.currencies).sort()).toEqual(['BRL', 'USD']);
      expect(config.currencies.USD.min.toFixed(2)).toBe('1.00');
    });

    it('refuses a product that is not open, or has no or inverted bounds', () => {
      expect(() => openConfig(product({}, 'one_time'), 'education')).toThrow(BadRequestException);
      expect(() => openConfig({ ...course, metadata: { open: {} } }, 'education')).toThrow(
        /no currency/,
      );
      expect(() =>
        openConfig(
          { ...course, metadata: { open: { currencies: { USD: { min: '5', max: '1' } } } } },
          'education',
        ),
      ).toThrow(/invalid bounds/);
      expect(() =>
        openConfig(
          { ...course, metadata: { open: { currencies: { USD: { min: '0', max: '1' } } } } },
          'education',
        ),
      ).toThrow(/invalid bounds/);
    });

    it("keeps the entitlement in the seller's own namespace", () => {
      // A bare `course:{ref}` could be another service's course.
      const bare = product({ entitlementTemplate: 'course:{ref}', itemParams: { ref: '.+' } });
      expect(() => openConfig(bare, 'education')).toThrow(/education:/);
      // Another service's prefix is refused just the same.
      const foreign = product({ entitlementTemplate: 'shop:{ref}', itemParams: { ref: '.+' } });
      expect(() => openConfig(foreign, 'education')).toThrow(BadRequestException);
      // Only {ref} may be filled in.
      const two = product({
        entitlementTemplate: 'education:{a}:{ref}',
        itemParams: { a: '.+', ref: '.+' },
      });
      expect(() => openConfig(two, 'education')).toThrow(BadRequestException);
    });

    it('grants the template with the ref put in, or nothing without one', () => {
      expect(openEntitlementKey(openConfig(course, 'education'), 'ai-basics')).toBe(
        'education:course:ai-basics',
      );
      expect(openEntitlementKey(openConfig(product({}), 'shop'), 'ord-1')).toBeNull();
    });
  });

  describe('a line', () => {
    const config = openConfig(course, 'education');

    it('takes an amount within the bounds, in decimal, and refuses one outside', () => {
      expect(() => checkBounds(toMoney('1.00'), 'USD', config)).not.toThrow();
      expect(() => checkBounds(toMoney('50'), 'USD', config)).not.toThrow();
      expect(() => checkBounds(toMoney('0.99'), 'USD', config)).toThrow(/between 1.00 and 50.00/);
      expect(() => checkBounds(toMoney('50.01'), 'USD', config)).toThrow(BadRequestException);
      expect(() => checkBounds(toMoney('2'), 'EUR', config)).toThrow(/not sold in EUR/);
    });

    it('reads the amount as a decimal string only', () => {
      expect(parseOpenAmount('2.00').toFixed(2)).toBe('2.00');
      for (const bad of [2, '2,00', '-1', '1e3', '0.12345', '', null]) {
        expect(() => parseOpenAmount(bad)).toThrow(BadRequestException);
      }
    });

    it('cleans the title the receipt will show', () => {
      expect(sanitizeTitle('  AI   for\tbeginners  ')).toBe('AI for beginners');
      // Bidi overrides and controls could make a title read as something else.
      expect(sanitizeTitle('Course‮gnp.exe\u0007')).toBe('Course gnp.exe');
      expect(sanitizeTitle('<script>x</script>Course')).toBe('scriptx/scriptCourse');
      expect(() => sanitizeTitle('​ ‮')).toThrow(/needs a title/);
      expect(() => sanitizeTitle('x'.repeat(121))).toThrow(/at most 120/);
      expect(sanitizeTitle('Курс по ИИ')).toBe('Курс по ИИ');
    });

    it('takes a safe ref that fits the product, and nothing that could escape it', () => {
      expect(checkRef('ai-basics', config)).toBe('ai-basics');
      for (const bad of ['', 'a:b', '../x', 'a b', 'x'.repeat(101), '-lead', 'UPPER']) {
        expect(() => checkRef(bad, config)).toThrow(BadRequestException);
      }
      // Without a pattern of its own, the product takes any safe ref.
      expect(checkRef('ORD_123.a', openConfig(product({}), 'shop'))).toBe('ORD_123.a');
    });
  });

  it('reads the daily cap per currency, none meaning none sold', () => {
    expect(openDailyCap({ openDailyCap: { USD: '200.00' } }, 'USD')?.toFixed(2)).toBe('200.00');
    expect(openDailyCap({ openDailyCap: { USD: '200.00' } }, 'BRL')).toBeNull();
    expect(openDailyCap({}, 'USD')).toBeNull();
    expect(openDailyCap({ openDailyCap: { USD: '0' } }, 'USD')).toBeNull();
  });

  it('names the anchor price per product and currency', () => {
    expect(openPriceCode('education-open', 'USD')).toBe('education-open-open-usd');
  });

  describe('rail minimums', () => {
    const pix = { supportedModes: ['PAYMENT' as const], minAmounts: { BRL: '1.00' } };

    it('takes the higher of what the rail declares and what the admin set', () => {
      expect(railMinimum(pix, {}, 'BRL')?.toFixed(2)).toBe('1.00');
      expect(railMinimum(pix, { minAmounts: { BRL: '5' } }, 'brl')?.toFixed(2)).toBe('5.00');
      expect(railMinimum(pix, { minAmounts: { BRL: '0.5' } }, 'BRL')?.toFixed(2)).toBe('1.00');
      expect(railMinimum(undefined, { minAmounts: { USD: '1.00' } }, 'USD')?.toFixed(2)).toBe(
        '1.00',
      );
      expect(railMinimum(pix, {}, 'USD')).toBeNull();
    });

    it('lets an amount through at the minimum and drops it below', () => {
      expect(meetsRailMinimum(toMoney('1.00'), pix, {}, 'BRL')).toBe(true);
      expect(meetsRailMinimum(toMoney('0.99'), pix, {}, 'BRL')).toBe(false);
      expect(meetsRailMinimum(toMoney('0.01'), undefined, {}, 'USD')).toBe(true);
    });
  });
});
