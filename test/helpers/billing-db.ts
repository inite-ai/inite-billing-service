import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PaymentOrchestratorService } from '../../src/payment-orchestrator/payment-orchestrator.service';

/** A real database and the real orchestrator; only the neighbours are stubbed. */
export function billingDb() {
  const prisma = new PrismaClient() as any;
  const events: Array<{ type: string; payload: any }> = [];
  const outbox = {
    emit: jest.fn(async (type: string, payload: any) => {
      events.push({ type, payload });
    }),
  };
  const credits = { grant: jest.fn(), resetForPeriod: jest.fn(), revokeGrant: jest.fn() };
  const orchestrator = new PaymentOrchestratorService(
    prisma,
    outbox as any,
    { processMultiLevelCommissions: jest.fn() } as any,
    { track: jest.fn() } as any,
    credits as any,
  );
  const run = randomUUID().slice(0, 8);
  const user = `user-${run}`;
  return { prisma, events, outbox, credits, orchestrator, run, user };
}

/** Moves only the clock: timers stay real, so the database driver keeps working. */
export function clockAt(iso: string): void {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

export async function makePlan(
  prisma: any,
  run: string,
  over: { amount?: string; currency?: string; interval?: string; graceDays?: number } = {},
) {
  const n = randomUUID().slice(0, 6);
  const service = await prisma.service.upsert({
    where: { code: `svc-${run}` },
    update: {},
    create: { code: `svc-${run}`, name: 'Test service', apiKey: `k-${run}` },
  });
  const product = await prisma.product.create({
    data: {
      code: `plan-${run}-${n}`,
      name: 'Plan',
      type: 'subscription',
      moduleScope: 'test',
      serviceId: service.id,
      metadata: { entitlements: [`plan.${run}.${n}`], creditsPerPeriod: 10 },
    },
  });
  return prisma.price.create({
    data: {
      productId: product.id,
      code: `price-${run}-${n}`,
      currency: over.currency ?? 'USD',
      amount: over.amount ?? '29',
      interval: over.interval ?? 'month',
      graceDays: over.graceDays ?? 3,
    },
    include: { product: true },
  });
}

export async function makeOrder(
  prisma: any,
  price: any,
  user: string,
  over: Record<string, any> = {},
) {
  return prisma.order.create({
    data: {
      userId: user,
      priceId: price.id,
      mode: 'SUBSCRIPTION',
      status: 'created',
      amount: price.amount,
      currency: price.currency,
      externalId: `ord-${randomUUID()}`,
      ...over,
    },
  });
}

export async function makeIntent(prisma: any, order: any, over: Record<string, any> = {}) {
  return prisma.paymentIntent.create({
    data: {
      orderId: order.id,
      rail: 'LAVA',
      status: 'created',
      providerIntentId: `pi-${randomUUID()}`,
      amount: order.amount,
      currency: order.currency,
      ...over,
    },
  });
}

export async function cleanBilling(prisma: any, run: string, user: string) {
  await prisma.entitlement.deleteMany({ where: { userId: user } });
  await prisma.subscription.deleteMany({ where: { userId: user } });
  await prisma.order.deleteMany({ where: { userId: user } });
  await prisma.product.deleteMany({ where: { code: { contains: run } } });
  await prisma.service.deleteMany({ where: { code: `svc-${run}` } });
  await prisma.$disconnect();
}
