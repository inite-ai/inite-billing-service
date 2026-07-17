import { PromoCodesService } from '../src/promo-codes/promo-codes.service';

describe('PromoCodesService — validation logic', () => {
  let service: PromoCodesService;
  let mockPrisma: any;

  // Prisma Decimal — Number() calls valueOf()
  const decimal = (v: number) =>
    Object.assign(Object.create(null), { valueOf: () => v, toString: () => String(v) });

  const mockPrice = {
    id: 'price-1',
    amount: decimal(100),
    product: { serviceId: 'service-1' },
  };

  const basePromo = {
    id: 'promo-1',
    code: 'SAVE10',
    name: '10% Off',
    isActive: true,
    discountType: 'percentage',
    discountValue: decimal(10),
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
      promoCode: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
      },
      promoCodeUsage: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        findMany: jest.fn(),
      },
      price: {
        findUnique: jest.fn().mockResolvedValue(mockPrice),
      },
    };

    service = new PromoCodesService(mockPrisma);
  });

  it('returns invalid if code not found', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue(null);
    const result = await service.validatePromoCode('NOPE', 'price-1', 'user-1');
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe('not_found');
  });

  it('returns invalid if code inactive', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({ ...basePromo, isActive: false });
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe('inactive');
  });

  it('returns invalid if code expired', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      validUntil: new Date('2020-01-01'),
    });
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe('expired');
  });

  it('returns invalid if not yet valid', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      validFrom: new Date('2099-01-01'),
    });
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe('not_yet_valid');
  });

  it('returns invalid if global usage limit reached', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      maxUsageCount: 5,
      currentUsageCount: 5,
    });
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe('usage_limit_reached');
  });

  it('returns invalid if per-user limit reached', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      maxUsagePerUser: 1,
    });
    mockPrisma.promoCodeUsage.count.mockResolvedValue(1);
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe('per_user_limit_reached');
  });

  it('returns invalid if service scope mismatch', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      serviceId: 'service-999',
    });
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe('wrong_service');
  });

  it('returns invalid if min purchase amount not met', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      minPurchaseAmount: decimal(200),
    });
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe('min_purchase_not_met');
  });

  it('calculates percentage discount correctly', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue(basePromo);
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(true);
    expect(result.originalAmount).toBe(100);
    expect(result.discountAmount).toBe(10);
    expect(result.finalAmount).toBe(90);
  });

  it('calculates fixed amount discount correctly', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      discountType: 'fixed_amount',
      discountValue: decimal(25),
    });
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(true);
    expect(result.discountAmount).toBe(25);
    expect(result.finalAmount).toBe(75);
  });

  it('caps discount at maxDiscountAmount', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      discountType: 'percentage',
      discountValue: decimal(50), // 50% of 100 = 50
      maxDiscountAmount: decimal(20), // cap at 20
    });
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(true);
    expect(result.discountAmount).toBe(20);
    expect(result.finalAmount).toBe(80);
  });

  it('caps discount at original amount (never negative)', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      discountType: 'fixed_amount',
      discountValue: decimal(999), // more than price
    });
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(true);
    expect(result.discountAmount).toBe(100);
    expect(result.finalAmount).toBe(0);
  });

  it('allows service-scoped code when service matches', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue({
      ...basePromo,
      serviceId: 'service-1', // matches mockPrice.product.serviceId
    });
    const result = await service.validatePromoCode('SAVE10', 'price-1', 'user-1');
    expect(result.isValid).toBe(true);
  });
});

describe('PromoCodesService — apply', () => {
  let service: PromoCodesService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      promoCodeUsage: { create: jest.fn() },
      promoCode: { update: jest.fn() },
    };
    service = new PromoCodesService(mockPrisma);
  });

  it('creates usage record and increments count', async () => {
    await service.applyPromoCode('promo-1', 'order-1', 'user-1', 100, 10, 90);

    expect(mockPrisma.promoCodeUsage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        promoCodeId: 'promo-1',
        orderId: 'order-1',
        userId: 'user-1',
        discountApplied: 10,
        originalAmount: 100,
        finalAmount: 90,
      }),
    });

    expect(mockPrisma.promoCode.update).toHaveBeenCalledWith({
      where: { id: 'promo-1' },
      data: { currentUsageCount: { increment: 1 } },
    });
  });

  it('uses transaction client when provided', async () => {
    const mockTx: any = {
      promoCodeUsage: { create: jest.fn() },
      promoCode: { update: jest.fn() },
    };

    await service.applyPromoCode('promo-1', 'order-1', 'user-1', 100, 10, 90, mockTx);

    expect(mockTx.promoCodeUsage.create).toHaveBeenCalled();
    expect(mockTx.promoCode.update).toHaveBeenCalled();
    expect(mockPrisma.promoCodeUsage.create).not.toHaveBeenCalled();
  });
});

describe('PromoCodesService — admin CRUD', () => {
  let service: PromoCodesService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      promoCode: {
        create: jest.fn().mockResolvedValue({ id: 'new-promo' }),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        delete: jest.fn(),
      },
      promoCodeUsage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new PromoCodesService(mockPrisma);
  });

  it('rejects invalid discountType on create', async () => {
    await expect(
      service.create({
        code: 'BAD',
        name: 'Bad',
        discountType: 'invalid',
        discountValue: 10,
        validFrom: '2025-01-01',
      }),
    ).rejects.toThrow('discountType must be');
  });

  it('rejects percentage > 100 on create', async () => {
    await expect(
      service.create({
        code: 'BAD',
        name: 'Bad',
        discountType: 'percentage',
        discountValue: 150,
        validFrom: '2025-01-01',
      }),
    ).rejects.toThrow('between 0 and 100');
  });

  it('uppercases code on create', async () => {
    await service.create({
      code: 'lowercase',
      name: 'Test',
      discountType: 'percentage',
      discountValue: 10,
      validFrom: '2025-01-01',
    });

    expect(mockPrisma.promoCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: 'LOWERCASE' }),
    });
  });

  it('throws NotFoundException on update of missing code', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue(null);
    await expect(service.update('bad-id', { name: 'x' })).rejects.toThrow('not found');
  });

  it('throws NotFoundException on delete of missing code', async () => {
    mockPrisma.promoCode.findUnique.mockResolvedValue(null);
    await expect(service.delete('bad-id')).rejects.toThrow('not found');
  });
});
