import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as request from 'supertest';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../src/auth/guards/jwt-or-service.guard';
import { MockJwtOrServiceGuard } from './mocks/auth.mock';
import { cleanupTestData } from './helpers/cleanup.helper';

/**
 * A store sold to a guest (`mikefluff:<hex>`) and recorded their email. When
 * that person signs in to billing with the same, confirmed, address, the
 * orders and the access they bought move to their account; nothing moves for
 * an unconfirmed address, someone else's address, or another buyer's order.
 */
const BUYER = 'did:key:zBuyer0000000000000000000000000000000000000';
const GUEST = 'mikefluff:0123456789abcdef0123456789abcdef';
const OTHER_GUEST = 'mikefluff:fedcba9876543210fedcba9876543210';

let signedIn = { userId: BUYER, email: 'Buyer@Example.com', emailVerified: true };

@Injectable()
class SignedInGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest().user = { ...signedIn, roles: ['user'] };
    return true;
  }
}

describe('claiming guest purchases on sign-in (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let priceId: string;

  const order = (userId: string, email: string | null, status = 'paid') =>
    prisma.order.create({
      data: {
        userId,
        priceId,
        mode: 'PAYMENT',
        status: status as any,
        amount: 99,
        currency: 'BRL',
        metadata: email ? { email, site: 'mikefluff' } : { site: 'mikefluff' },
      },
    });

  const claim = () =>
    request(app.getHttpServer())
      .post('/v1/orders/me/claim-guest-purchases')
      .set('Authorization', 'Bearer mock')
      .expect(200);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(SignedInGuard)
      .overrideGuard(JwtOrServiceGuard)
      .useClass(MockJwtOrServiceGuard)
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const product = await prisma.product.create({
      data: {
        code: 'claim-course',
        name: 'Course',
        moduleScope: 'test',
        type: 'one_time',
        isActive: true,
      },
    });
    priceId = (
      await prisma.price.create({
        data: {
          productId: product.id,
          code: 'claim-course-brl',
          currency: 'BRL',
          amount: 99,
          isActive: true,
        },
      })
    ).id;
  });

  beforeEach(() => {
    signedIn = { userId: BUYER, email: 'Buyer@Example.com', emailVerified: true };
  });

  afterEach(async () => {
    await prisma.entitlement.deleteMany({});
    await prisma.order.deleteMany({});
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await prisma.$disconnect();
    await app.close();
  });

  it('moves the guest’s orders and the access they granted to the account', async () => {
    const paid = await order(GUEST, 'buyer@example.com');
    const unpaid = await order(GUEST, ' BUYER@example.com', 'created');
    await prisma.entitlement.create({
      data: {
        userId: GUEST,
        key: 'course:parasites',
        source: 'order',
        value: { order_id: paid.id },
      },
    });

    const res = await claim();
    expect(res.body.claimed.sort()).toEqual([paid.id, unpaid.id].sort());

    const moved = await prisma.order.findUniqueOrThrow({ where: { id: paid.id } });
    expect(moved.userId).toBe(BUYER);
    expect(moved.metadata).toMatchObject({ guestUserId: GUEST, email: 'buyer@example.com' });
    const access = await prisma.entitlement.findFirstOrThrow({
      where: { key: 'course:parasites' },
    });
    expect(access.userId).toBe(BUYER);

    // Signing in again finds nothing left to move.
    expect((await claim()).body.claimed).toEqual([]);
  });

  it('claims nothing for an address the identity provider has not confirmed', async () => {
    signedIn = { ...signedIn, emailVerified: false };
    const paid = await order(GUEST, 'buyer@example.com');
    expect((await claim()).body.claimed).toEqual([]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: paid.id } })).userId).toBe(GUEST);
  });

  it('leaves other people’s orders alone', async () => {
    const someoneElse = await order(OTHER_GUEST, 'someone@example.com');
    const accountOrder = await order(
      'did:key:zSomeoneElse000000000000000000000000000000',
      'buyer@example.com',
    );
    const noEmail = await order(GUEST, null);

    expect((await claim()).body.claimed).toEqual([]);
    for (const o of [someoneElse, accountOrder, noEmail]) {
      const now = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      expect(now.userId).toBe(o.userId);
    }
  });

  it('does not move access granted by another order of the same guest', async () => {
    const mine = await order(GUEST, 'buyer@example.com');
    const theirs = await order(GUEST, 'someone@example.com');
    await prisma.entitlement.create({
      data: { userId: GUEST, key: 'course:other', source: 'order', value: { order_id: theirs.id } },
    });

    expect((await claim()).body.claimed).toEqual([mine.id]);
    const access = await prisma.entitlement.findFirstOrThrow({ where: { key: 'course:other' } });
    expect(access.userId).toBe(GUEST);
  });
});
