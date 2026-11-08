import { randomBytes } from 'crypto';
import { DEMO_SUBSCRIBER, isDemoSubscriber } from '../../src/common/demo-tenant';
import { DEMO_MARK, DemoFixtures } from './fixtures';

/**
 * Load «Atlântica Group (demo)»'s fixtures (./fixtures.ts) into billing.
 *
 * Safe on production by construction:
 *   - dry run unless the caller asks to write (`DEMO_TENANT_SEED=1` and
 *     `--apply`, checked in ./run.ts);
 *   - every row has a fixed id and is upserted, so a re-run changes only the
 *     dates and never duplicates;
 *   - it refuses, before writing anything, a row it would touch that is not
 *     the demo tenant's: a subscription, order, entitlement, balance or usage
 *     whose owner is not `org:<DEMO_ORG_ID>`, an invoice of another order, or
 *     a service, product or price under a demo code or id that is not marked
 *     `demo: true`;
 *   - it writes rows directly, not through the payment orchestrator, on
 *     purpose: the orchestrator's side effects are outbox events, webhooks,
 *     grants and mail, and a made-up customer must cause none of them.
 */

type Db = any;

export class DemoSeedRefused extends Error {}

export interface DemoSeedPlan {
  create: Record<string, number>;
  update: Record<string, number>;
}

const TABLES = [
  'service',
  'product',
  'price',
  'subscription',
  'order',
  'invoice',
  'entitlement',
  'creditBalance',
  'creditUsage',
] as const;

/** The one owner this seed writes for; anything else is refused. */
export function assertDemoOwner(userId: string | null | undefined, what: string): void {
  if (!isDemoSubscriber(userId)) {
    throw new DemoSeedRefused(
      `${what} belongs to ${userId ?? 'nobody'}, not the demo tenant ${DEMO_SUBSCRIBER}; refusing`,
    );
  }
}

function isMarked(metadata: unknown): boolean {
  return !!metadata && typeof metadata === 'object' && (metadata as any).demo === true;
}

/** A catalogue row under a demo code or id that is not the demo's own. */
async function checkCatalogue(
  table: { findUnique: (q: any) => Promise<any> },
  what: string,
  row: { id: string; code: string },
  marked: (existing: any) => Promise<boolean> | boolean,
): Promise<'create' | 'update'> {
  const byCode = await table.findUnique({ where: { code: row.code } });
  const byId = await table.findUnique({ where: { id: row.id } });
  if (byCode && byCode.id !== row.id) {
    throw new DemoSeedRefused(
      `${what} ${row.code} exists with another id (${byCode.id}); refusing`,
    );
  }
  if (byId && byId.code !== row.code) {
    throw new DemoSeedRefused(`${what} id ${row.id} holds ${byId.code}, not ${row.code}; refusing`);
  }
  if (byId && !(await marked(byId))) {
    throw new DemoSeedRefused(`${what} ${row.code} exists and is not marked demo; refusing`);
  }
  return byId ? 'update' : 'create';
}

/** Read everything the seed would touch, refuse on the first foreign row, and count. */
export async function planDemoSeed(db: Db, fx: DemoFixtures): Promise<DemoSeedPlan> {
  assertDemoOwner(fx.subscriber, 'The fixture set');
  const plan: DemoSeedPlan = { create: {}, update: {} };
  for (const t of TABLES) {
    plan.create[t] = 0;
    plan.update[t] = 0;
  }
  const count = (t: (typeof TABLES)[number], how: 'create' | 'update') => (plan[how][t] += 1);

  for (const s of fx.services) {
    count('service', await checkCatalogue(db.service, 'Service', s, (e) => isMarked(e.metadata)));
  }
  for (const p of fx.products) {
    count('product', await checkCatalogue(db.product, 'Product', p, (e) => isMarked(e.metadata)));
  }
  for (const p of fx.prices) {
    // A price carries the mark of its product: the demo's prices hang only off demo products.
    const productId = fx.products.find((x) => x.code === p.productCode)?.id;
    count(
      'price',
      await checkCatalogue(
        db.price,
        'Price',
        p,
        (e) => isMarked(e.metadata) && e.productId === productId,
      ),
    );
  }

  const owned = async (
    t: 'subscription' | 'order' | 'entitlement' | 'creditBalance' | 'creditUsage',
    id: string,
  ) => {
    const existing = await db[t].findUnique({ where: { id } });
    if (existing) assertDemoOwner(existing.userId, `${t} ${id}`);
    count(t, existing ? 'update' : 'create');
  };
  for (const s of fx.subscriptions) await owned('subscription', s.id);
  for (const o of fx.orders) {
    await owned('order', o.id);
    const invoice = await db.invoice.findUnique({ where: { id: o.invoiceId } });
    if (invoice && invoice.orderId !== o.id) {
      throw new DemoSeedRefused(
        `invoice ${o.invoiceId} belongs to order ${invoice.orderId}; refusing`,
      );
    }
    // One invoice per order (unique order_id): another invoice on a demo order is not the seed's.
    const other = await db.invoice.findUnique({ where: { orderId: o.id } });
    if (other && other.id !== o.invoiceId) {
      throw new DemoSeedRefused(`order ${o.id} already has invoice ${other.id}; refusing`);
    }
    count('invoice', invoice ? 'update' : 'create');
  }
  for (const e of fx.entitlements) await owned('entitlement', e.id);
  for (const b of fx.balances) {
    await owned('creditBalance', b.id);
    const serviceId = fx.services.find((s) => s.code === b.serviceCode)?.id;
    const same = await db.creditBalance.findUnique({
      where: { userId_serviceId: { userId: fx.subscriber, serviceId } },
    });
    if (same && same.id !== b.id) {
      throw new DemoSeedRefused(
        `the demo tenant already holds balance ${same.id} for ${b.serviceCode}; refusing`,
      );
    }
  }
  for (const u of fx.usages) await owned('creditUsage', u.id);
  return plan;
}

/** Write the fixtures, in one transaction, after `planDemoSeed` passed inside it. */
export async function applyDemoSeed(db: Db, fx: DemoFixtures): Promise<DemoSeedPlan> {
  return db.$transaction(
    async (tx: Db) => {
      const plan = await planDemoSeed(tx, fx);
      const serviceId = new Map(fx.services.map((s) => [s.code, s.id]));
      const product = new Map(fx.products.map((p) => [p.code, p]));
      const price = new Map(fx.prices.map((p) => [p.code, p]));

      for (const s of fx.services) {
        const data = {
          code: s.code,
          name: s.name,
          isActive: false,
          webhookUrl: null,
          metadata: { ...DEMO_MARK, displayName: s.displayName },
        };
        await tx.service.upsert({
          where: { id: s.id },
          // A key nobody holds: the service is inactive and never called.
          create: { id: s.id, ...data, apiKey: `demo_${randomBytes(24).toString('hex')}` },
          update: data,
        });
      }
      for (const p of fx.products) {
        const data = {
          code: p.code,
          name: p.name,
          serviceId: serviceId.get(p.serviceCode),
          moduleScope: p.moduleScope,
          type: p.type,
          isActive: false,
          metadata: p.metadata,
        };
        await tx.product.upsert({
          where: { id: p.id },
          create: { id: p.id, ...data },
          update: data,
        });
      }
      for (const p of fx.prices) {
        const data = {
          code: p.code,
          productId: product.get(p.productCode)!.id,
          currency: p.currency,
          amount: p.amount,
          interval: p.interval,
          trialDays: p.trialDays,
          graceDays: 0,
          isActive: false,
          metadata: { ...DEMO_MARK },
        };
        await tx.price.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
      }
      for (const s of fx.subscriptions) {
        const data = {
          userId: fx.subscriber,
          priceId: price.get(s.priceCode)!.id,
          status: s.status,
          currentPeriodStart: s.currentPeriodStart,
          currentPeriodEnd: s.currentPeriodEnd,
          cancelAtPeriodEnd: s.cancelAtPeriodEnd,
          // No rail and no provider id: nothing can ever ask a provider about it.
          rail: null,
          providerSubscriptionId: null,
          pendingPriceId: null,
          renewalOrderId: null,
          createdAt: s.createdAt,
        };
        await tx.subscription.upsert({
          where: { id: s.id },
          create: { id: s.id, ...data },
          update: data,
        });
      }
      for (const o of fx.orders) {
        const p = price.get(o.priceCode)!;
        const prod = product.get(p.productCode)!;
        const data = {
          userId: fx.subscriber,
          priceId: p.id,
          mode: o.mode,
          status: o.status,
          amount: o.amount,
          currency: o.currency,
          metadata: { ...DEMO_MARK, note: o.note },
          snapshot: {
            priceCode: p.code,
            priceAmount: p.amount,
            currency: p.currency,
            interval: p.interval,
            trialDays: p.trialDays,
            productCode: prod.code,
            productName: prod.name,
            productType: prod.type,
            serviceId: serviceId.get(prod.serviceCode) ?? null,
            capturedAt: o.createdAt.toISOString(),
          },
          createdAt: o.createdAt,
        };
        await tx.order.upsert({ where: { id: o.id }, create: { id: o.id, ...data }, update: data });
        const invoice = {
          orderId: o.id,
          status: o.invoiceStatus,
          amount: o.amount,
          currency: o.currency,
          providerReceiptUrl: null,
          createdAt: o.createdAt,
        };
        await tx.invoice.upsert({
          where: { id: o.invoiceId },
          create: { id: o.invoiceId, ...invoice },
          update: invoice,
        });
      }
      for (const e of fx.entitlements) {
        const data = {
          userId: fx.subscriber,
          key: e.key,
          status: 'active',
          source: 'subscription',
          sourceId: e.subscriptionId,
          startsAt: e.startsAt,
          expiresAt: e.expiresAt,
          value: { ...DEMO_MARK },
        };
        await tx.entitlement.upsert({
          where: { id: e.id },
          create: { id: e.id, ...data },
          update: data,
        });
      }
      for (const b of fx.balances) {
        const data = {
          userId: fx.subscriber,
          serviceId: serviceId.get(b.serviceCode),
          balance: b.balance,
          totalGranted: b.totalGranted,
          totalUsed: b.totalUsed,
          resetsAt: b.resetsAt,
        };
        await tx.creditBalance.upsert({
          where: { id: b.id },
          create: { id: b.id, ...data },
          update: data,
        });
      }
      for (const u of fx.usages) {
        const data = {
          creditBalanceId: u.balanceId,
          userId: fx.subscriber,
          amount: u.amount,
          type: u.type,
          description: u.description,
          featureCode: u.featureCode,
          units: u.units,
          orderId: u.orderId,
          metadata: { ...DEMO_MARK },
          createdAt: u.createdAt,
        };
        await tx.creditUsage.upsert({
          where: { id: u.id },
          create: { id: u.id, ...data },
          update: data,
        });
      }
      return plan;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/** `--apply` with DEMO_TENANT_SEED=1 writes; anything else is a dry run. */
export function seedMode(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): 'apply' | 'dry-run' {
  return argv.includes('--apply') && env.DEMO_TENANT_SEED === '1' ? 'apply' : 'dry-run';
}
