import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { cleanupTestData } from './helpers/cleanup.helper';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { checkItem, itemKey, itemTemplate } from '../src/catalog/item-entitlements';

/**
 * One price for any chapter: the site names the chapter at checkout, billing
 * checks it against the product's patterns, keeps it on the order, grants
 * exactly that chapter's key on payment and takes it back on refund. A buyer
 * opening the checkout themselves cannot name a chapter.
 */
describe('Products sold per item', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const BUYER = 'did:key:z6MkChapterReader';
  const KEY = 'chapters-key-0123456789';

  const product = {
    metadata: {
      entitlementTemplate: 'shop:chapter:{book}:{chapter}',
      itemParams: { book: '^[a-z0-9-]{1,60}$', chapter: '[A-Za-z0-9_-]{1,40}' },
    },
  };

  it('reads the template and checks items strictly', () => {
    const t = itemTemplate(product)!;
    expect(itemKey(t, checkItem(t, { book: 'celestial-code', chapter: 'ch-3' }))).toBe(
      'shop:chapter:celestial-code:ch-3',
    );
    expect(() => checkItem(t, { book: 'celestial-code' })).toThrow(/chapter/);
    expect(() => checkItem(t, { book: 'x', chapter: 'a', extra: 'z' })).toThrow(/unknown/);
    // Patterns match the whole value, even when the admin left out ^ or $.
    expect(() => checkItem(t, { book: 'ok', chapter: 'a:b' })).toThrow();
    expect(() => checkItem(t, { book: 'ok', chapter: 'x'.repeat(41) })).toThrow();
    expect(itemTemplate({ metadata: {} })).toBeNull();
    expect(() => itemTemplate({ metadata: { entitlementTemplate: 'a:{b}' } })).toThrow(
      /itemParams/,
    );
  });

  describe('end to end', () => {
    let orchestrator: any;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [TestAppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      );
      await app.init();
      prisma = app.get(PrismaService);
      orchestrator = app.get(PaymentOrchestratorService);
      await cleanupTestData(prisma);
      const service = await prisma.service.create({
        data: { code: 'chapters', name: 'Chapters', apiKey: KEY },
      });
      const p = await prisma.product.create({
        data: {
          code: 'shop-chapter',
          name: 'A chapter',
          moduleScope: 'chapters',
          type: 'one_time',
          isActive: true,
          serviceId: service.id,
          metadata: product.metadata,
        },
      });
      await prisma.price.create({
        data: {
          productId: p.id,
          code: 'shop-chapter-usd',
          currency: 'USD',
          amount: 0.5,
          isActive: true,
        },
      });
    });

    afterAll(async () => {
      await cleanupTestData(prisma);
      await prisma.service.deleteMany({ where: { code: 'chapters' } });
      await app.close();
      await prisma.$disconnect();
    });

    const open = (metadata: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/v1/checkout/sessions')
        .set('x-api-key', KEY)
        .send({ priceCode: 'shop-chapter-usd', mode: 'PAYMENT', userId: BUYER, metadata });

    it('refuses a missing or wrong item, and a buyer naming one', async () => {
      await open({}).expect(400);
      await open({ item: { book: 'celestial-code', chapter: '../etc' } }).expect(400);
      const token = jwt.sign({ sub: BUYER }, 'test-jwt-secret', {
        algorithm: 'HS256',
        expiresIn: 300,
      });
      await request(app.getHttpServer())
        .post('/v1/checkout/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          priceCode: 'shop-chapter-usd',
          mode: 'PAYMENT',
          metadata: { item: { book: 'celestial-code', chapter: 'ch-3' } },
        })
        .expect(400);
    });

    it('grants exactly the chapter bought, and takes it back on refund', async () => {
      const session = await open({ item: { book: 'celestial-code', chapter: 'ch-3' } }).expect(201);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: session.body.sessionId } });
      expect((order.metadata as any).item).toEqual({ book: 'celestial-code', chapter: 'ch-3' });
      expect((order.snapshot as any).item).toEqual({ book: 'celestial-code', chapter: 'ch-3' });

      await prisma.$transaction((tx) => orchestrator.handleOrderPaid(order.id, tx));
      const granted = await prisma.entitlement.findMany({ where: { userId: BUYER } });
      expect(granted.map((e) => [e.key, e.status])).toEqual([
        ['shop:chapter:celestial-code:ch-3', 'active'],
      ]);

      await prisma.$transaction((tx) => orchestrator.handleOrderRefunded(order.id, tx));
      const after = await prisma.entitlement.findMany({ where: { userId: BUYER } });
      expect(after.map((e) => e.status)).toEqual(['revoked']);
    });
  });
});
