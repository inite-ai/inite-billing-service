import { AffiliatesService } from '../src/affiliates/affiliates.service';

/**
 * getDownlineUserIds runs during paid-order fulfilment. It must NOT run inside
 * the fulfilment transaction, must not loop forever on a referral cycle, and
 * should traverse level-by-level (not one query per referral).
 */
describe('AffiliatesService.getDownlineUserIds', () => {
  // Build a mock prisma whose referral/affiliate graph is described by maps.
  const buildService = (graph: {
    referralsByAffiliate: Record<string, string[]>; // affiliateId -> referred userIds
    affiliateByUser: Record<string, string>; // userId -> affiliateId (if they are an affiliate)
  }) => {
    const referralCalls: any[] = [];
    const prisma: any = {
      referral: {
        findMany: jest.fn(async ({ where }: any) => {
          referralCalls.push(where.affiliateId.in);
          const ids: string[] = where.affiliateId.in;
          return ids.flatMap((id) =>
            (graph.referralsByAffiliate[id] || []).map((u) => ({ referredUserId: u })),
          );
        }),
      },
      affiliate: {
        findMany: jest.fn(async ({ where }: any) => {
          const users: string[] = where.userId.in;
          return users
            .filter((u) => graph.affiliateByUser[u])
            .map((u) => ({ id: graph.affiliateByUser[u] }));
        }),
      },
    };
    const service = new AffiliatesService(prisma, { get: () => undefined } as any, {} as any);
    return { service, prisma, referralCalls };
  };

  it('collects the whole downline breadth-first', async () => {
    // A(aff-A) → users u1,u2 ; u2 is aff-B → users u3
    const { service } = buildService({
      referralsByAffiliate: { 'aff-A': ['u1', 'u2'], 'aff-B': ['u3'] },
      affiliateByUser: { u2: 'aff-B' },
    });
    const ids = await (service as any).getDownlineUserIds('aff-A');
    expect(ids.sort()).toEqual(['u1', 'u2', 'u3']);
  });

  it('is level-batched — one referral query per level, not per referral', async () => {
    const { service, prisma } = buildService({
      referralsByAffiliate: { 'aff-A': ['u1', 'u2'], 'aff-B': ['u3'] },
      affiliateByUser: { u1: 'aff-B' },
    });
    await (service as any).getDownlineUserIds('aff-A');
    // Level 0: [aff-A]; Level 1: [aff-B]; Level 2: [] → 2 queries that return rows.
    expect(prisma.referral.findMany).toHaveBeenCalledTimes(2);
  });

  it('does not loop forever on a referral cycle', async () => {
    // aff-A refers user uB (aff-B); aff-B refers user uA (aff-A) → cycle.
    const { service } = buildService({
      referralsByAffiliate: { 'aff-A': ['uB'], 'aff-B': ['uA'] },
      affiliateByUser: { uB: 'aff-B', uA: 'aff-A' },
    });
    const ids = await (service as any).getDownlineUserIds('aff-A');
    // Terminates, and each user appears once per traversal (no infinite growth).
    expect(ids.sort()).toEqual(['uA', 'uB']);
  });
});
