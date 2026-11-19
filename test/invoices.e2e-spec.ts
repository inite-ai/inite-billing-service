import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { InvoicingModule } from '../src/invoicing/invoicing.module';
import { InvoicingService } from '../src/invoicing/invoicing.service';
import { AdminOrdersService } from '../src/admin/services/admin-orders.service';
import { cleanupTestData } from './helpers/cleanup.helper';

/**
 * An invoice is an order on an open-amount price: paid by hand it must reach
 * the subscriber exactly as a card payment does (one `billing.payment.succeeded`,
 * one invoice row), carry the deal it was raised for, and be refunded and
 * cancelled through the same roads.
 */
describe('Invoices E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let invoicing: InvoicingService;
  let serviceId: string;
  let otherServiceId: string;

  const events = (orderId: string, type: string) =>
    prisma.outboxEvent.count({
      where: { eventType: type, payload: { path: ['order_id'], equals: orderId } },
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule, InvoicingModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    invoicing = app.get(InvoicingService);

    await cleanupTestData(prisma);
    const service = await prisma.service.create({
      data: {
        code: 'invsvc',
        name: 'Invoice service',
        apiKey: 'inv-test-key-0000000000000000',
        metadata: { openDailyCap: { BRL: '100000' } },
      },
    });
    const other = await prisma.service.create({
      data: { code: 'invother', name: 'Other service', apiKey: 'inv-test-key-1111111111111111' },
    });
    serviceId = service.id;
    otherServiceId = other.id;
    await prisma.product.create({
      data: {
        code: 'invsvc-work',
        name: 'Work',
        serviceId,
        moduleScope: 'invsvc',
        type: 'open',
        isActive: true,
        metadata: { open: { currencies: { BRL: { min: '1.00', max: '50000' } } } },
      },
    });
    await prisma.paymentProvider.createMany({
      data: [
        {
          code: 'ONE',
          name: 'ONE',
          isActive: true,
          currencies: ['BRL'],
          supportedModes: ['PAYMENT'],
          config: {},
        },
      ] as any,
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  let n = 0;
  const open = (extra: Record<string, unknown> = {}) =>
    invoicing.create(
      { serviceId, serviceCode: 'invsvc' },
      {
        productCode: 'invsvc-work',
        userId: 'invsvc:payer-0000001',
        amount: '4500.00',
        currency: 'BRL',
        description: 'Visibility Upkeep, month 2',
        ref: 'deal-1-m2',
        dueAt: '2026-12-10T00:00:00.000Z',
        successUrl: 'https://inite.ai/pt/profile',
        metadata: { dealId: 'deal-1', rung: 'upkeep', month: 2 },
        ...extra,
      } as any,
      `key-${++n}`,
    );

  it('opens an invoice for the amount named, with its link and metadata', async () => {
    const res = await open();
    expect(res.checkoutUrl).toContain(res.sessionId);
    expect(res.invoice.amount).toBe('4500');
    expect(res.rails).toContain('ONE');
    expect(res.invoice.description).toBe('Visibility Upkeep, month 2');
    expect(res.invoice.metadata).toMatchObject({ dealId: 'deal-1', month: 2 });
    expect(res.invoice.metadata).not.toHaveProperty('linkTokenHash');
  });

  it('keeps the open product bounds: an amount above them is refused', async () => {
    await expect(open({ amount: '60000.00' })).rejects.toThrow();
  });

  it('marks paid by hand once: one invoice row, one succeeded event, then a refund event', async () => {
    const { sessionId } = await open();
    const first = await invoicing.markPaid(
      { serviceId },
      sessionId,
      { method: 'pix', reference: 'E2E123' },
      'test',
    );
    const again = await invoicing.markPaid(
      { serviceId },
      sessionId,
      { method: 'pix', reference: 'E2E123' },
      'test',
    );
    expect(first.status).toBe('paid');
    expect(again.status).toBe('paid');
    expect(first.paidBy).toMatchObject({ rail: 'manual', method: 'pix', reference: 'E2E123' });
    expect(await prisma.invoice.count({ where: { orderId: sessionId } })).toBe(1);
    expect(await events(sessionId, 'billing.payment.succeeded')).toBe(1);

    await app.get(AdminOrdersService).refundOrder(sessionId);
    const refunded = await invoicing.get({ admin: true }, sessionId);
    expect(refunded.status).toBe('refunded');
    expect(await events(sessionId, 'billing.payment.refunded')).toBe(1);
  });

  it('closes a payment the payer started, so its poll cannot expire the paid order', async () => {
    const { sessionId } = await open();
    const started = await prisma.paymentIntent.create({
      data: {
        orderId: sessionId,
        rail: 'hodle',
        status: 'opened',
        providerIntentId: `p-${sessionId}`,
        amount: 4500,
        currency: 'BRL',
      },
    });
    await prisma.order.update({ where: { id: sessionId }, data: { status: 'open' } });
    await invoicing.markPaid({ serviceId }, sessionId, { method: 'bank_transfer' }, 'test');
    expect((await prisma.paymentIntent.findUnique({ where: { id: started.id } }))!.status).toBe(
      'failed',
    );
    expect((await prisma.order.findUnique({ where: { id: sessionId } }))!.status).toBe('paid');
  });

  it('cancels an unpaid invoice with one failed event, and will not be paid after', async () => {
    const { sessionId } = await open();
    const cancelled = await invoicing.cancel({ serviceId }, sessionId, 'test');
    expect(cancelled.status).toBe('expired');
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(await events(sessionId, 'billing.payment.failed')).toBe(1);
    await invoicing.cancel({ serviceId }, sessionId, 'test');
    expect(await events(sessionId, 'billing.payment.failed')).toBe(1);
    await expect(
      invoicing.markPaid({ serviceId }, sessionId, { method: 'pix' }, 'test'),
    ).rejects.toThrow(/cancelled/);
  });

  it('hides one service invoices from another', async () => {
    const { sessionId } = await open();
    await expect(invoicing.get({ serviceId: otherServiceId }, sessionId)).rejects.toThrow(
      /not found/,
    );
    await expect(
      invoicing.markPaid({ serviceId: otherServiceId }, sessionId, { method: 'pix' }, 'test'),
    ).rejects.toThrow(/not found/);
  });

  it('lists invoices for the admin', async () => {
    const list = await invoicing.list(10);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((i) => i.metadata.invoice)).toBe(true);
  });
});
