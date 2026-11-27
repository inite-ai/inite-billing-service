import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CreditsService } from '../src/credits/credits.service';
import { OutboxService } from '../src/outbox/outbox.service';
import {
  ServiceCreditGrantsService,
  decodeCursor,
  encodeCursor,
} from '../src/credits/service-credit-grants.service';
import { ServiceCreditsController } from '../src/credits/service-credits.controller';
import { SERVICE_SCOPE_KEY, ServiceTokenGuard } from '../src/service-api/service-token.guard';

/**
 * GET /v1/service-credits/grants, against the real database.
 *
 * A service reconciles its credits ledger against this list: an event that
 * never arrived, or arrived wrong, is found by comparing the two. So the list
 * has to say exactly what the events said (the same builder, on the same row),
 * page without skipping or repeating a row, and show a service only its own.
 */
const URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5433/inite_billing_test?schema=billing';

describe('service credit grants list (integration)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const outbox = new OutboxService(prisma as any);
  const credits = new CreditsService(prisma as any, undefined, outbox);
  const list = new ServiceCreditGrantsService(prisma as any);
  const epoch = new Date(0);

  let mine: string;
  let theirs: string;
  const user = `u-${randomUUID()}`;

  const newService = async (name: string) =>
    (
      await prisma.service.create({
        data: { code: `scg-${randomUUID().slice(0, 8)}`, name, apiKey: `test-${randomUUID()}` },
      })
    ).id;

  /** Every page, following the cursor, until the last. */
  const all = async (serviceId: string, limit: number, since = epoch) => {
    const items: any[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 100; pages++) {
      const page = await list.list(serviceId, {
        since,
        limit,
        cursor: cursor ? decodeCursor(cursor) : undefined,
      });
      items.push(...page.items);
      cursor = page.nextCursor;
      if (!cursor) return items;
    }
    throw new Error('the cursor never ran out');
  };

  const order = async (serviceId: string) => {
    const code = `p-${randomUUID()}`;
    const product = await prisma.product.create({
      data: { code, name: code, moduleScope: 'x', type: 'one_time' as any, serviceId },
    });
    const price = await prisma.price.create({
      data: { productId: product.id, code, currency: 'USD', amount: 10 },
    });
    return prisma.order.create({
      data: {
        userId: user,
        priceId: price.id,
        amount: 10,
        currency: 'USD',
        status: 'paid',
        mode: 'PAYMENT',
      } as any,
    });
  };

  beforeAll(async () => {
    mine = await newService('Mine');
    theirs = await newService('Theirs');

    // Mine: a pack bought for a company, a period grant, a pack refunded, and
    // two ledger rows that announce nothing (an admin top-up, a sourceless grant).
    const o1 = await order(mine);
    await credits.grant({
      userId: user,
      serviceId: mine,
      amount: 500,
      orderId: o1.id,
      source: { source: 'pack', companyId: 'co-1' },
    });
    await credits.resetForPeriod({
      userId: user,
      serviceId: mine,
      newBalance: 50,
      resetsAt: new Date(Date.now() + 1e9),
      source: {
        source: 'subscription',
        periodStart: new Date('2026-11-01T00:00:00Z'),
        periodEnd: new Date('2026-12-01T00:00:00Z'),
        companyId: 'co-1',
      },
    });
    const o2 = await order(mine);
    await credits.grant({
      userId: user,
      serviceId: mine,
      amount: 70,
      orderId: o2.id,
      source: { source: 'pack', companyId: 'co-2' },
    });
    const refunded = await prisma.creditUsage.findFirstOrThrow({
      where: { orderId: o2.id, type: 'grant' },
    });
    await credits.revokeGrant({
      userId: user,
      serviceId: mine,
      amount: refunded.amount,
      orderId: o2.id,
      grant: { id: refunded.id, metadata: refunded.metadata },
    });
    await credits.grant({ userId: user, serviceId: mine, amount: 5 });
    await credits.adminAdjust({ userId: user, serviceId: mine, amount: 9, description: 'ops' });

    // Theirs: the same person, another service.
    await credits.grant({
      userId: user,
      serviceId: theirs,
      amount: 900,
      source: { source: 'pack', companyId: 'co-9' },
    });
  });

  afterAll(async () => {
    for (const serviceId of [mine, theirs]) {
      await prisma.outboxEvent.deleteMany({ where: { serviceId } });
      await prisma.creditBalance.deleteMany({ where: { serviceId } });
      await prisma.order.deleteMany({ where: { price: { product: { serviceId } } } });
      await prisma.price.deleteMany({ where: { product: { serviceId } } });
      await prisma.product.deleteMany({ where: { serviceId } });
      await prisma.service.delete({ where: { id: serviceId } });
    }
    await prisma.$disconnect();
  });

  it('lists exactly what the outbox announced, payload for payload, oldest first', async () => {
    const emitted = await prisma.outboxEvent.findMany({
      where: {
        serviceId: mine,
        eventType: { in: ['billing.credits.granted', 'billing.credits.revoked'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    const listed = await all(mine, 100);
    expect(emitted).toHaveLength(4);
    expect(listed.map((i) => ({ type: i.type, data: i.data }))).toEqual(
      emitted.map((e) => ({ type: e.eventType, data: e.payload })),
    );
    expect(listed.map((i) => i.data.bucket)).toEqual([
      'purchased',
      'period',
      'purchased',
      'purchased',
    ]);
    expect(listed[3]).toMatchObject({
      type: 'billing.credits.revoked',
      data: { company_id: 'co-2', amount: 70 },
    });
  });

  it("shows a service only its own grants, never another service's", async () => {
    const own = await all(mine, 100);
    const other = await all(theirs, 100);
    expect(own.map((i) => i.data.company_id)).not.toContain('co-9');
    expect(other).toHaveLength(1);
    expect(other[0].data).toMatchObject({ company_id: 'co-9', amount: 900 });
    expect(await all(randomUUID(), 100)).toEqual([]);
  });

  it('pages by a stable cursor: every row once, in order, at any page size', async () => {
    const whole = (await all(mine, 100)).map((i) => i.ledgerId);
    for (const size of [1, 2, 3]) {
      expect((await all(mine, size)).map((i) => i.ledgerId)).toEqual(whole);
    }
  });

  it('does not repeat or skip rows written in the same microsecond', async () => {
    const rows = await prisma.creditUsage.findMany({
      where: { creditBalance: { serviceId: mine }, type: { in: ['grant', 'purchase_reversal'] } },
    });
    const same = new Date('2026-11-20T10:00:00.123Z');
    await prisma.$executeRawUnsafe(
      `UPDATE billing.credit_usages SET created_at = $1::timestamptz + interval '456 microseconds' WHERE id = ANY($2::uuid[])`,
      same.toISOString(),
      rows.map((r) => r.id),
    );
    const one = await all(mine, 1);
    expect(one).toHaveLength(4);
    expect(new Set(one.map((i) => i.ledgerId)).size).toBe(4);
    expect(one[0].timestamp).toBe('2026-11-20T10:00:00.123456Z');
  });

  it('starts at `since`, inclusive', async () => {
    const at = new Date('2026-11-20T10:00:00.123Z');
    expect(await all(mine, 100, new Date(at.getTime() + 1))).toEqual([]);
    expect(await all(mine, 100, at)).toHaveLength(4);
  });

  it('refuses a cursor it did not give', () => {
    for (const bad of [
      'nope',
      encodeCursor({ at: '2026-01-01', id: randomUUID() }),
      'x'.repeat(300),
    ]) {
      expect(() => decodeCursor(bad)).toThrow(BadRequestException);
    }
    const good = { at: '2026-11-20T10:00:00.123456Z', id: randomUUID() };
    expect(decodeCursor(encodeCursor(good))).toEqual(good);
  });
});

describe('ServiceCreditsController', () => {
  it('sits behind the service-token guard with the lane scope', () => {
    expect(Reflect.getMetadata('__guards__', ServiceCreditsController)).toEqual([
      ServiceTokenGuard,
    ]);
    expect(Reflect.getMetadata(SERVICE_SCOPE_KEY, ServiceCreditsController)).toBe(
      'billing:checkout',
    );
  });

  it("scopes to the token's service, and to nothing without one", async () => {
    const grants = { list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }) };
    const controller = new ServiceCreditsController(grants as any);
    await controller.list({ serviceId: 'svc-1' } as any, { since: '2026-11-01T00:00:00Z' });
    expect(grants.list).toHaveBeenCalledWith('svc-1', {
      since: new Date('2026-11-01T00:00:00Z'),
      cursor: undefined,
      limit: undefined,
    });
    await expect(
      controller.list({ serviceId: null } as any, { since: '2026-11-01T00:00:00Z' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      controller.list({ serviceId: 'svc-1' } as any, {
        since: '2026-11-01T00:00:00Z',
        cursor: 'garbage',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
