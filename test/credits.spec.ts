import { CreditsService } from '../src/credits/credits.service';

describe('CreditsService', () => {
  let service: CreditsService;
  let mockPrisma: any;
  let mockTx: any;

  const decimal = (v: number) =>
    Object.assign(Object.create(null), {
      valueOf: () => v,
      toString: () => String(v),
    });

  const baseBalance = {
    id: 'bal-1',
    userId: 'user-1',
    serviceId: null,
    balance: 0,
    totalGranted: 0,
    totalUsed: 0,
    resetsAt: null,
  };

  beforeEach(() => {
    mockTx = {
      creditBalance: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      creditUsage: {
        create: jest.fn(),
      },
    };

    mockPrisma = {
      $transaction: jest.fn((fn: any) => fn(mockTx)),
      creditBalance: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      creditUsage: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
    };

    service = new CreditsService(mockPrisma);
  });

  // --- grant() ---

  it('grant() creates balance and usage record, increments totalGranted', async () => {
    mockTx.creditBalance.findUnique.mockResolvedValue(null);
    mockTx.creditBalance.create.mockResolvedValue({ ...baseBalance });
    mockTx.creditBalance.update.mockResolvedValue({
      ...baseBalance,
      balance: 100,
      totalGranted: 100,
    });
    mockTx.creditUsage.create.mockResolvedValue({});

    const result = await service.grant({
      userId: 'user-1',
      amount: 100,
      description: 'Welcome credits',
    });

    expect(result.balance).toBe(100);
    expect(result.totalGranted).toBe(100);
    expect(mockTx.creditBalance.create).toHaveBeenCalled();
    expect(mockTx.creditBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bal-1' },
        data: expect.objectContaining({
          balance: { increment: 100 },
          totalGranted: { increment: 100 },
        }),
      }),
    );
    expect(mockTx.creditUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'grant',
          amount: 100,
        }),
      }),
    );
  });

  it('grant() on existing balance adds to it', async () => {
    const existing = { ...baseBalance, balance: 50, totalGranted: 50 };
    mockTx.creditBalance.findUnique.mockResolvedValue(existing);
    mockTx.creditBalance.update.mockResolvedValue({
      ...existing,
      balance: 150,
      totalGranted: 150,
    });
    mockTx.creditUsage.create.mockResolvedValue({});

    const result = await service.grant({
      userId: 'user-1',
      amount: 100,
    });

    expect(result.balance).toBe(150);
    expect(result.totalGranted).toBe(150);
    expect(mockTx.creditBalance.create).not.toHaveBeenCalled();
    expect(mockTx.creditBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          balance: { increment: 100 },
          totalGranted: { increment: 100 },
        }),
      }),
    );
  });

  // --- consume() ---

  it('consume() deducts from balance, increments totalUsed', async () => {
    const existing = { ...baseBalance, balance: 100, totalUsed: 0 };
    mockTx.creditBalance.findUnique.mockResolvedValue(existing);
    mockTx.creditBalance.update.mockResolvedValue({
      ...existing,
      balance: 70,
      totalUsed: 30,
    });
    mockTx.creditUsage.create.mockResolvedValue({});

    const result = await service.consume({
      userId: 'user-1',
      amount: 30,
    });

    expect(result.success).toBe(true);
    expect(result.remainingBalance).toBe(70);
    expect(mockTx.creditBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          balance: { decrement: 30 },
          totalUsed: { increment: 30 },
        }),
      }),
    );
    expect(mockTx.creditUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'consume',
          amount: -30,
        }),
      }),
    );
  });

  it('consume() returns error when insufficient balance', async () => {
    const existing = { ...baseBalance, balance: 10 };
    mockTx.creditBalance.findUnique.mockResolvedValue(existing);

    const result = await service.consume({
      userId: 'user-1',
      amount: 50,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Insufficient credits');
    expect(result.remainingBalance).toBe(10);
    expect(mockTx.creditBalance.update).not.toHaveBeenCalled();
  });

  it('consume() returns error when no balance record exists', async () => {
    mockTx.creditBalance.findUnique.mockResolvedValue(null);

    const result = await service.consume({
      userId: 'user-1',
      amount: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Insufficient credits');
    expect(result.remainingBalance).toBe(0);
  });

  it('consume() with exact balance succeeds (balance becomes 0)', async () => {
    const existing = { ...baseBalance, balance: 50 };
    mockTx.creditBalance.findUnique.mockResolvedValue(existing);
    mockTx.creditBalance.update.mockResolvedValue({
      ...existing,
      balance: 0,
      totalUsed: 50,
    });
    mockTx.creditUsage.create.mockResolvedValue({});

    const result = await service.consume({
      userId: 'user-1',
      amount: 50,
    });

    expect(result.success).toBe(true);
    expect(result.remainingBalance).toBe(0);
  });

  // --- resetForPeriod() ---

  it('resetForPeriod() resets balance and logs reset + grant usages', async () => {
    const existing = { ...baseBalance, balance: 30, totalGranted: 100 };
    const resetsAt = new Date('2026-04-01');
    mockTx.creditBalance.findUnique.mockResolvedValue(existing);
    mockTx.creditBalance.update.mockResolvedValue({
      ...existing,
      balance: 200,
      totalGranted: 300,
      resetsAt,
    });
    mockTx.creditUsage.create.mockResolvedValue({});

    const result = await service.resetForPeriod({
      userId: 'user-1',
      newBalance: 200,
      resetsAt,
    });

    expect(result.balance).toBe(200);

    // Should create a reset usage (old balance expired)
    expect(mockTx.creditUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'reset',
          amount: -30,
        }),
      }),
    );

    // Should create a grant usage (new balance)
    expect(mockTx.creditUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'grant',
          amount: 200,
        }),
      }),
    );

    expect(mockTx.creditUsage.create).toHaveBeenCalledTimes(2);
  });

  // --- adminAdjust() ---

  it('adminAdjust() positive adds to balance', async () => {
    const existing = { ...baseBalance, balance: 50, totalGranted: 50 };
    mockTx.creditBalance.findUnique.mockResolvedValue(existing);
    mockTx.creditBalance.update.mockResolvedValue({
      ...existing,
      balance: 80,
      totalGranted: 80,
    });
    mockTx.creditUsage.create.mockResolvedValue({});

    const result = await service.adminAdjust({
      userId: 'user-1',
      amount: 30,
      description: 'Bonus credits',
    });

    expect(result.balance).toBe(80);
    expect(mockTx.creditBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          balance: { increment: 30 },
          totalGranted: { increment: 30 },
        }),
      }),
    );
    expect(mockTx.creditUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'admin_adjust',
          amount: 30,
          description: 'Bonus credits',
        }),
      }),
    );
  });

  it('adminAdjust() negative subtracts from balance', async () => {
    const existing = { ...baseBalance, balance: 100, totalUsed: 0 };
    mockTx.creditBalance.findUnique.mockResolvedValue(existing);
    mockTx.creditBalance.update.mockResolvedValue({
      ...existing,
      balance: 80,
      totalUsed: 20,
    });
    mockTx.creditUsage.create.mockResolvedValue({});

    const result = await service.adminAdjust({
      userId: 'user-1',
      amount: -20,
      description: 'Correction',
    });

    expect(result.balance).toBe(80);
    expect(mockTx.creditBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          balance: { decrement: 20 },
          totalUsed: { increment: 20 },
        }),
      }),
    );
    expect(mockTx.creditUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'admin_adjust',
          amount: -20,
        }),
      }),
    );
  });

  // --- refund() ---

  it('refund() adds back to balance with type=refund', async () => {
    const existing = { ...baseBalance, balance: 50 };
    mockTx.creditBalance.findUnique.mockResolvedValue(existing);
    mockTx.creditBalance.update.mockResolvedValue({
      ...existing,
      balance: 100,
      totalGranted: 50,
    });
    mockTx.creditUsage.create.mockResolvedValue({});

    const result = await service.refund({
      userId: 'user-1',
      amount: 50,
      orderId: 'order-123',
    });

    expect(result.balance).toBe(100);
    expect(mockTx.creditBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          balance: { increment: 50 },
          totalGranted: { increment: 50 },
        }),
      }),
    );
    expect(mockTx.creditUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'refund',
          amount: 50,
          orderId: 'order-123',
          description: 'Refund for order order-123',
        }),
      }),
    );
  });
});
