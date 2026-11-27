import { DEMO_SUBSCRIBER } from '../src/common/demo';
import { buildDemoFixtures, demoId, KIND } from '../prisma/demo-tenant/fixtures';
import { applyDemoSeed, DemoSeedRefused, planDemoSeed, seedMode } from '../prisma/demo-tenant/seed';

/**
 * The demo tenant's seed runs once on production, by hand. It must write
 * only the demo tenant's rows, be repeatable, and refuse — before writing
 * anything — a row under its ids or codes that is someone else's.
 */

const NOW = new Date('2026-11-08T12:00:00Z');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An in-memory stand-in for the Prisma client, keyed by id and unique fields. */
function memoryDb(seed: Record<string, any[]> = {}) {
  const tables: Record<string, Map<string, any>> = {};
  const writes: Array<{ table: string; data: any }> = [];
  const table = (name: string) => {
    tables[name] ??= new Map((seed[name] ?? []).map((r) => [r.id, r]));
    const rows = tables[name];
    return {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return rows.get(where.id) ?? null;
        if (where.userId_serviceId) {
          const { userId, serviceId } = where.userId_serviceId;
          return (
            [...rows.values()].find((r) => r.userId === userId && r.serviceId === serviceId) ?? null
          );
        }
        const [k, v] = Object.entries(where)[0];
        return [...rows.values()].find((r) => r[k] === v) ?? null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = rows.get(where.id);
        const row = existing ? { ...existing, ...update } : create;
        rows.set(where.id, row);
        writes.push({ table: name, data: existing ? update : create });
        return row;
      }),
    };
  };
  const db: any = { writes, tables };
  for (const t of [
    'service',
    'product',
    'price',
    'subscription',
    'order',
    'invoice',
    'entitlement',
    'creditBalance',
    'creditUsage',
  ]) {
    db[t] = table(t);
  }
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  return db;
}

describe('the demo fixtures', () => {
  const fx = buildDemoFixtures(NOW);

  it('all belong to the demo tenant, under ids of its own', () => {
    expect(fx.subscriber).toBe(DEMO_SUBSCRIBER);
    const ids = [
      ...fx.services,
      ...fx.products,
      ...fx.prices,
      ...fx.subscriptions,
      ...fx.orders,
      ...fx.entitlements,
      ...fx.balances,
      ...fx.usages,
    ]
      .map((r) => r.id)
      .concat(fx.orders.map((o) => o.invoiceId));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(UUID);
      expect(id.startsWith('a7a71c00-de00-4000-8')).toBe(true);
    }
    expect(demoId(KIND.order, 1)).toBe('a7a71c00-de00-4000-8105-000000000001');
  });

  it('hang together: prices, orders and the credit ledger add up', () => {
    const priceCodes = new Set(fx.prices.map((p) => p.code));
    for (const s of fx.subscriptions) expect(priceCodes.has(s.priceCode)).toBe(true);
    for (const o of fx.orders) {
      const p = fx.prices.find((x) => x.code === o.priceCode)!;
      expect(o.amount).toBe(p.amount);
      expect(o.currency).toBe(p.currency);
      expect(o.amount).toMatch(/^\d+\.\d{4}$/);
    }
    const [b] = fx.balances;
    const grants = fx.usages.filter((u) => u.type === 'grant').reduce((s, u) => s + u.amount, 0);
    const used = fx.usages.filter((u) => u.type === 'consume').reduce((s, u) => s - u.amount, 0);
    expect(b.totalGranted).toBe(grants);
    expect(b.totalUsed).toBe(used);
    expect(b.balance).toBe(grants - used);
    expect(b.balance).toBeGreaterThan(0);
  });

  it('stay current: live plans run past today, and nothing is due within the sweeps', () => {
    for (const s of fx.subscriptions) {
      expect(s.currentPeriodEnd.getTime()).toBeGreaterThan(NOW.getTime() + 3 * 86_400_000);
      expect(s.currentPeriodStart.getTime()).toBeLessThan(NOW.getTime());
    }
    for (const o of fx.orders) expect(o.createdAt.getTime()).toBeLessThan(NOW.getTime());
  });

  it('use made-up names and no links out', () => {
    const text = JSON.stringify(fx);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/@(?!demo\.invalid)/);
  });
});

describe('seedMode', () => {
  it('writes only with DEMO_TENANT_SEED=1 and --apply', () => {
    expect(seedMode(['--apply'], { DEMO_TENANT_SEED: '1' })).toBe('apply');
    expect(seedMode(['--apply'], {})).toBe('dry-run');
    expect(seedMode([], { DEMO_TENANT_SEED: '1' })).toBe('dry-run');
    expect(seedMode(['--apply'], { DEMO_TENANT_SEED: 'yes' })).toBe('dry-run');
  });
});

describe('the demo seed', () => {
  const fx = buildDemoFixtures(NOW);

  it('plans everything as new on an empty database, and writes nothing in a dry run', async () => {
    const db = memoryDb();
    const plan = await planDemoSeed(db, fx);
    expect(plan.create).toMatchObject({
      service: 3,
      product: 4,
      price: 4,
      subscription: 3,
      order: 7,
      invoice: 7,
      entitlement: 3,
      creditBalance: 1,
    });
    expect(db.writes).toEqual([]);
  });

  it('writes only the demo tenant, inactive catalogue rows, and is the same on a second run', async () => {
    const db = memoryDb();
    await applyDemoSeed(db, fx);
    const first = db.writes.length;
    for (const w of db.writes) {
      if ('userId' in w.data) expect(w.data.userId).toBe(DEMO_SUBSCRIBER);
      if (['service', 'product', 'price'].includes(w.table)) {
        expect(w.data.isActive).toBe(false);
        expect(w.data.metadata.demo).toBe(true);
      }
      if (w.table === 'service') expect(w.data.webhookUrl).toBeNull();
      if (w.table === 'subscription') {
        expect(w.data.rail).toBeNull();
        expect(w.data.providerSubscriptionId).toBeNull();
      }
    }
    const plan = await applyDemoSeed(db, buildDemoFixtures(new Date(NOW.getTime() + 86_400_000)));
    expect(Object.values(plan.create).every((n) => n === 0)).toBe(true);
    expect(db.writes.length).toBe(first * 2);
    expect(db.tables.order.size).toBe(7);
  });

  const refuses = async (seed: Record<string, any[]>, message: RegExp) => {
    const db = memoryDb(seed);
    await expect(applyDemoSeed(db, fx)).rejects.toThrow(DemoSeedRefused);
    await expect(planDemoSeed(db, fx)).rejects.toThrow(message);
    expect(db.writes).toEqual([]);
  };

  it('refuses a subscription under its id that is not the demo tenant’s', () =>
    refuses(
      { subscription: [{ id: fx.subscriptions[0].id, userId: 'did:key:z6MkReal' }] },
      /not the demo tenant/,
    ));

  it('refuses an order or usage of a real customer', async () => {
    await refuses(
      { order: [{ id: fx.orders[2].id, userId: 'org:11111111-1111-4111-8111-111111111111' }] },
      /not the demo tenant/,
    );
    await refuses(
      { creditUsage: [{ id: fx.usages[0].id, userId: 'did:key:z6MkReal' }] },
      /not the demo tenant/,
    );
  });

  it('refuses a real service under a demo code, or a demo id holding another code', async () => {
    const s = fx.services[0];
    await refuses(
      { service: [{ id: '11111111-1111-4111-8111-111111111111', code: s.code, metadata: {} }] },
      /another id/,
    );
    await refuses(
      { service: [{ id: s.id, code: 'family-food', metadata: { demo: true } }] },
      /holds family-food/,
    );
    await refuses({ service: [{ id: s.id, code: s.code, metadata: {} }] }, /not marked demo/);
  });

  it('refuses an invoice under its id that is another order’s', () =>
    refuses(
      {
        invoice: [{ id: fx.orders[0].invoiceId, orderId: '11111111-1111-4111-8111-111111111111' }],
      },
      /belongs to order/,
    ));
});
