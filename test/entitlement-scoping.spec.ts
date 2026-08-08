import { EntitlementsService } from '../src/entitlements/entitlements.service';

/**
 * A service-to-service entitlement read must be scoped to the CALLER's service —
 * service A must not see service B's grants (IDOR). Legacy rows without a
 * recorded service_id stay visible during the transition so existing access
 * checks don't regress. A user read (no callerServiceId) sees everything.
 */
describe('EntitlementsService cross-service scoping', () => {
  const rows = [
    {
      id: 'e-a',
      userId: 'u1',
      key: 'k',
      status: 'active',
      source: 'subscription',
      value: { service_id: 'svc-A' },
      startsAt: null,
      expiresAt: null,
      createdAt: new Date('2026-01-01'),
    },
    {
      id: 'e-b',
      userId: 'u1',
      key: 'k',
      status: 'active',
      source: 'subscription',
      value: { service_id: 'svc-B' },
      startsAt: null,
      expiresAt: null,
      createdAt: new Date('2026-01-02'),
    },
    {
      id: 'e-legacy',
      userId: 'u1',
      key: 'k',
      status: 'active',
      source: 'order',
      value: { product_code: 'p' },
      startsAt: null,
      expiresAt: null,
      createdAt: new Date('2026-01-03'),
    },
  ];

  const service = () => {
    const prisma: any = { entitlement: { findMany: jest.fn().mockResolvedValue(rows) } };
    return new EntitlementsService(prisma);
  };

  it('a service caller sees only its own service (plus legacy unscoped) rows', async () => {
    const result = await service().getUserEntitlementsByUserId('u1', 'svc-A');
    const ids = result.map((e) => e.id).sort();
    expect(ids).toEqual(['e-a', 'e-legacy']); // NOT e-b
  });

  it('a different service caller sees its own + legacy, never the other service', async () => {
    const result = await service().getUserEntitlementsByUserId('u1', 'svc-B');
    expect(result.map((e) => e.id).sort()).toEqual(['e-b', 'e-legacy']);
  });

  it('a user read (no callerServiceId) sees all of their entitlements', async () => {
    const result = await service().getUserEntitlementsByUserId('u1');
    expect(result).toHaveLength(3);
  });
});
