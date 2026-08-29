import { CreditsService } from '../src/credits/credits.service';

/**
 * Credits with no service are the platform's own, stored as `service_id NULL`.
 *
 * The lookup was a compound-unique read — `userId_serviceId: { userId,
 * serviceId: null }` — and Prisma refuses a null there outright ("Argument
 * `serviceId` must not be null"). Every credit operation that named no service
 * threw before it did anything: no balance to read, no grant, no consume. A
 * filter takes null and means IS NULL, which is what was meant.
 */
describe('platform-wide credit balances', () => {
  const build = (existing: any = null) => {
    const prisma: any = {
      creditBalance: {
        findFirst: jest.fn().mockResolvedValue(existing),
        findUnique: jest.fn(() => {
          throw new Error('findUnique must not be used for a nullable scope');
        }),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'bal-new', ...data })),
      },
    };
    return { prisma, service: new CreditsService(prisma, { emit: jest.fn() } as any) };
  };

  it('finds the balance that has no service', async () => {
    const { prisma, service } = build({
      id: 'bal-1',
      userId: 'user-1',
      serviceId: null,
      balance: 40,
    });

    const balance = await service.getBalance('user-1');

    expect(balance.id).toBe('bal-1');
    expect(prisma.creditBalance.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', serviceId: null },
    });
    expect(prisma.creditBalance.create).not.toHaveBeenCalled();
  });

  it('creates one when there is none, with no service attached', async () => {
    const { prisma, service } = build(null);

    await service.getBalance('user-1');

    expect(prisma.creditBalance.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', serviceId: null, balance: 0, totalGranted: 0, totalUsed: 0 },
    });
  });

  it('still scopes to a service when one is given', async () => {
    const { prisma, service } = build({ id: 'bal-2' });

    await service.getBalance('user-1', 'svc-a');

    expect(prisma.creditBalance.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', serviceId: 'svc-a' },
    });
  });

  it('yields to the winner when two first-time grants race', async () => {
    // The unique index decides; the loser reads the row the winner created
    // rather than failing the grant.
    const { prisma, service } = build(null);
    prisma.creditBalance.create.mockRejectedValueOnce(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );
    prisma.creditBalance.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'bal-winner', userId: 'user-1', serviceId: null });

    await expect(service.getBalance('user-1')).resolves.toMatchObject({ id: 'bal-winner' });
  });

  it('does not swallow a failure that is not a conflict', async () => {
    const { prisma, service } = build(null);
    prisma.creditBalance.create.mockRejectedValueOnce(new Error('connection lost'));

    await expect(service.getBalance('user-1')).rejects.toThrow('connection lost');
  });
});
