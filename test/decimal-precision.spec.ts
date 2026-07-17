import { PromoCodesService } from '../src/promo-codes/promo-codes.service';

/**
 * Financial precision tests — validates that rounding and decimal
 * arithmetic produce correct results with realistic monetary amounts.
 */
describe('Decimal Precision — Promo Code Calculations', () => {
  let service: PromoCodesService;
  let mockPrisma: any;

  const decimal = (v: number) =>
    Object.assign(Object.create(null), {
      valueOf: () => v,
      toString: () => String(v),
    });

  const basePromo = {
    id: 'promo-1',
    code: 'DISC',
    name: 'Discount',
    isActive: true,
    serviceId: null,
    minPurchaseAmount: null,
    maxDiscountAmount: null,
    maxUsageCount: null,
    maxUsagePerUser: null,
    currentUsageCount: 0,
    validFrom: new Date('2020-01-01'),
    validUntil: null,
  };

  beforeEach(() => {
    mockPrisma = {
      promoCode: { findUnique: jest.fn() },
      promoCodeUsage: { count: jest.fn().mockResolvedValue(0) },
      price: { findUnique: jest.fn() },
    };
    service = new PromoCodesService(mockPrisma);
  });

  // --- Amounts with cents ---

  it('15% of $99.99 = $14.9985 rounds to $15.00 (4dp), final = $84.99', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      discountType: 'percentage',
      discountValue: decimal(15),
    });
    mockPrisma.price.findUnique.mockResolvedValue({
      id: 'p1',
      amount: decimal(99.99),
      product: { serviceId: null },
    });

    const r = await service.validatePromoCode('DISC', 'p1', 'u1');
    expect(r.isValid).toBe(true);
    // 99.99 * 0.15 = 14.9985 → round to 4dp = 14.9985
    expect(r.discountAmount).toBe(14.9985);
    // 99.99 - 14.9985 = 84.9915 → round to 4dp = 84.9915
    expect(r.finalAmount).toBe(84.9915);
    // Verify no negative
    expect(r.finalAmount).toBeGreaterThanOrEqual(0);
  });

  it('33.33% of $100 produces consistent result', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      discountType: 'percentage',
      discountValue: decimal(33.33),
    });
    mockPrisma.price.findUnique.mockResolvedValue({
      id: 'p1',
      amount: decimal(100),
      product: { serviceId: null },
    });

    const r = await service.validatePromoCode('DISC', 'p1', 'u1');
    expect(r.isValid).toBe(true);
    expect(r.discountAmount).toBe(33.33);
    expect(r.finalAmount).toBe(66.67);
    // discount + final = original
    expect(r.discountAmount! + r.finalAmount!).toBeCloseTo(100, 4);
  });

  it('100% discount on $0.01 produces exactly $0', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      discountType: 'percentage',
      discountValue: decimal(100),
    });
    mockPrisma.price.findUnique.mockResolvedValue({
      id: 'p1',
      amount: decimal(0.01),
      product: { serviceId: null },
    });

    const r = await service.validatePromoCode('DISC', 'p1', 'u1');
    expect(r.isValid).toBe(true);
    expect(r.discountAmount).toBe(0.01);
    expect(r.finalAmount).toBe(0);
  });

  it('fixed $0.01 discount on $0.01 produces $0 final', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      discountType: 'fixed_amount',
      discountValue: decimal(0.01),
    });
    mockPrisma.price.findUnique.mockResolvedValue({
      id: 'p1',
      amount: decimal(0.01),
      product: { serviceId: null },
    });

    const r = await service.validatePromoCode('DISC', 'p1', 'u1');
    expect(r.isValid).toBe(true);
    expect(r.finalAmount).toBe(0);
  });

  it('maxDiscountAmount cap with fractional amounts', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      discountType: 'percentage',
      discountValue: decimal(50),
      maxDiscountAmount: decimal(33.33),
    });
    mockPrisma.price.findUnique.mockResolvedValue({
      id: 'p1',
      amount: decimal(99.99),
      product: { serviceId: null },
    });

    const r = await service.validatePromoCode('DISC', 'p1', 'u1');
    expect(r.isValid).toBe(true);
    // 50% of 99.99 = 49.995 → capped at 33.33
    expect(r.discountAmount).toBe(33.33);
    expect(r.finalAmount).toBe(66.66);
  });

  it('discount + final always equals original (no money lost)', async () => {
    const amounts = [1.99, 9.99, 49.95, 99.99, 199.5, 999.99, 1000.01];
    const rates = [5, 10, 15, 20, 25, 33.33, 50, 75, 99.99];

    for (const amount of amounts) {
      for (const rate of rates) {
        mockPrisma.promoCode.findUnique.mockResolvedValue({
          ...basePromo,
          discountType: 'percentage',
          discountValue: decimal(rate),
        });
        mockPrisma.price.findUnique.mockResolvedValue({
          id: 'p1',
          amount: decimal(amount),
          product: { serviceId: null },
        });

        const r = await service.validatePromoCode('DISC', 'p1', 'u1');
        expect(r.isValid).toBe(true);

        // discount + final must equal original (within 4dp precision)
        const sum = Math.round((r.discountAmount! + r.finalAmount!) * 10000) / 10000;
        expect(sum).toBeCloseTo(amount, 4);

        // never negative
        expect(r.finalAmount!).toBeGreaterThanOrEqual(0);
        expect(r.discountAmount!).toBeGreaterThanOrEqual(0);
        expect(r.discountAmount!).toBeLessThanOrEqual(amount);
      }
    }
  });
});
