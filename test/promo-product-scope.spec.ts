import { PromoCodesService } from '../src/promo-codes/promo-codes.service';

/**
 * A promo code could be scoped to a service and to nothing finer.
 *
 * inite.ai sells a $29 Atlas listing and a $149 monthly plan behind one
 * service id, so a coupon cut for the listing took half off the plan. The
 * caller could refuse the mismatch itself, but a caller is not a gate: the
 * checkout API answers any buyer's token.
 */
describe('promo codes scope by product', () => {
  const base = {
    id: 'p1',
    code: 'ATLAS50',
    isActive: true,
    validFrom: new Date('2020-01-01'),
    validUntil: null,
    maxUsageCount: null,
    currentUsageCount: 0,
    maxUsagePerUser: null,
    minPurchaseAmount: null,
    maxDiscountAmount: null,
    discountType: 'percentage',
    discountValue: 50,
    serviceId: null,
  };

  const price = (productCode: string) => ({
    id: 'price1',
    amount: 149,
    product: { code: productCode, serviceId: 'svc' },
  });

  function serviceWith(promo: Record<string, unknown>, productCode: string) {
    const prisma = {
      promoCode: { findUnique: jest.fn().mockResolvedValue({ ...base, ...promo }) },
      promoCodeUsage: { count: jest.fn().mockResolvedValue(0) },
      price: { findUnique: jest.fn().mockResolvedValue(price(productCode)) },
    } as never;
    return new PromoCodesService(prisma);
  }

  it('refuses a code cut for another product', async () => {
    const svc = serviceWith({ productCodes: ['inite-atlas-premium'] }, 'inite-visibility-autopilot');
    const r = await svc.validatePromoCode('ATLAS50', 'price1', 'u1');
    expect(r.isValid).toBe(false);
    expect(r.errorCode).toBe('wrong_product');
  });

  it('allows the product it was cut for', async () => {
    const svc = serviceWith({ productCodes: ['inite-atlas-premium'] }, 'inite-atlas-premium');
    expect((await svc.validatePromoCode('ATLAS50', 'price1', 'u1')).isValid).toBe(true);
  });

  /** Empty is what every row written before this column meant. */
  it('an unscoped code still works on anything in the service', async () => {
    for (const productCodes of [[], undefined]) {
      const svc = serviceWith({ productCodes }, 'inite-visibility-autopilot');
      expect((await svc.validatePromoCode('X', 'price1', 'u1')).isValid).toBe(true);
    }
  });
});
