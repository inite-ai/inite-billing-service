import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CheckoutService } from '../src/checkout/checkout.service';
import { CheckoutLinkOrJwtGuard } from '../src/checkout/checkout-link.guard';
import {
  CHECKOUT_LINK_HEADER,
  checkoutLinkMatches,
  hashCheckoutLink,
} from '../src/checkout/checkout-link';

/**
 * A store that has already identified its buyer opens a checkout for them; the
 * hosted page then made them sign in to billing on another domain, and a
 * session there that disagreed with the store's ended on "session not found".
 * The checkout link now carries a token that opens its own order — read, pay,
 * check the payment, try a promo code — without a billing session, and the
 * order stays with the buyer the store named.
 */
describe('checkout: paying through the link', () => {
  const OWNER = 'did:key:zOwner000000000000000000000000000000000000';
  const OTHER = 'did:key:zOther000000000000000000000000000000000000';
  const TOKEN = 'link-token-0123456789';

  const makeOrder = (over: Record<string, any> = {}) => ({
    id: 'ord-1',
    userId: OWNER,
    priceId: 'price-1',
    status: 'created',
    amount: '15.0000',
    currency: 'USD',
    mode: 'PAYMENT',
    metadata: { successUrl: 'https://store.test/ok', linkTokenHash: hashCheckoutLink(TOKEN) },
    price: {
      id: 'price-1',
      code: 'book-usd',
      interval: null,
      product: {
        id: 'prod-1',
        serviceId: 'svc-store',
        name: 'Book',
        code: 'b',
        type: 'one_time',
        metadata: {},
      },
    },
    ...over,
  });

  const build = (order: any) => {
    const prisma: any = {
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(async ({ data }: any) => ({ id: 'ord-new', ...data })),
      },
      paymentProvider: { findMany: jest.fn().mockResolvedValue([]) },
      paymentIntent: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const catalog = {
      getPriceByCode: jest.fn().mockResolvedValue({
        id: 'price-1',
        code: 'book-usd',
        amount: '15.0000',
        currency: 'USD',
        productId: 'prod-1',
        product: {
          code: 'b',
          name: 'Book',
          type: 'one_time',
          isActive: true,
          serviceId: 'svc-store',
        },
      }),
    };
    const promo = { validatePromoCode: jest.fn().mockResolvedValue({ isValid: false }) };
    const funnel = { track: jest.fn() };
    const config = {
      get: (k: string) => (k === 'FRONTEND_URL' ? 'https://billing.test' : undefined),
    };
    const service = new CheckoutService(
      prisma,
      catalog as any,
      {} as any,
      {} as any,
      promo as any,
      funnel as any,
      config as any,
    );
    return { service, prisma, promo };
  };

  it('puts the token in the link fragment and keeps only its hash', async () => {
    const { service, prisma } = build(makeOrder());
    const res = await service.createSession(OWNER, {
      priceCode: 'book-usd',
      mode: 'PAYMENT',
      locale: 'ru',
    } as any);

    const url = new URL(res.checkoutUrl);
    expect(url.pathname).toBe('/checkout/ord-new');
    expect(url.searchParams.get('locale')).toBe('ru');
    const token = new URLSearchParams(url.hash.slice(1)).get('t')!;
    expect(token.length).toBeGreaterThanOrEqual(43);

    const metadata = prisma.order.create.mock.calls[0][0].data.metadata;
    expect(checkoutLinkMatches(metadata, token)).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain(token);
  });

  it('a store cannot plant its own hash through metadata', async () => {
    const { service, prisma } = build(makeOrder());
    await service.createSession(OWNER, {
      priceCode: 'book-usd',
      mode: 'PAYMENT',
      metadata: { linkTokenHash: hashCheckoutLink('chosen') },
    } as any);
    const metadata = prisma.order.create.mock.calls[0][0].data.metadata;
    expect(checkoutLinkMatches(metadata, 'chosen')).toBe(false);
  });

  it('opens the order without a session, and does not hand it to anyone', async () => {
    const { service, prisma } = build(makeOrder());
    const session = await service.getSession('ord-1', undefined, undefined, TOKEN);
    expect(session.sessionId).toBe('ord-1');
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('opens a guest order the same way, leaving it with the guest', async () => {
    const { service, prisma } = build(makeOrder({ userId: 'mikefluff:0123abcd' }));
    await expect(service.getSession('ord-1', undefined, undefined, TOKEN)).resolves.toBeDefined();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('a wrong token reads as a missing order', async () => {
    const { service } = build(makeOrder());
    await expect(service.getSession('ord-1', undefined, undefined, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.paySession('ord-1', undefined, {}, undefined, 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.refreshPayment('ord-1', undefined, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('an order made before links has none to match', async () => {
    const { service } = build(makeOrder({ metadata: {} }));
    await expect(service.getSession('ord-1', undefined, undefined, TOKEN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('pays as the order’s own buyer', async () => {
    // Already paid: the first check past access, so reaching it means the link let us in.
    const { service, prisma } = build(makeOrder({ status: 'paid' }));
    await expect(
      service.paySession('ord-1', undefined, {}, undefined, TOKEN),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('without a token or a user, paying and checking need a sign-in', async () => {
    const { service } = build(makeOrder());
    await expect(service.paySession('ord-1', undefined, {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.refreshPayment('ord-1', undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('checks the payment through the link', async () => {
    const { service } = build(makeOrder());
    await expect(service.refreshPayment('ord-1', undefined, TOKEN)).resolves.toMatchObject({
      sessionId: 'ord-1',
    });
  });

  it('validates a promo code for the order’s buyer and price', async () => {
    const { service, promo } = build(makeOrder());
    await service.validateSessionPromo('ord-1', 'SAVE', undefined, TOKEN);
    expect(promo.validatePromoCode).toHaveBeenCalledWith('SAVE', 'price-1', OWNER);
  });

  it('a signed-in user validates promo codes on their own orders only', async () => {
    const { service } = build(makeOrder());
    await expect(service.validateSessionPromo('ord-1', 'SAVE', OTHER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe('guard', () => {
    const ctx = (headers: Record<string, string>) => {
      const request: any = { headers };
      return {
        request,
        context: { switchToHttp: () => ({ getRequest: () => request }) } as any,
      };
    };

    it('lets a token through and hands it on', async () => {
      const { request, context } = ctx({ [CHECKOUT_LINK_HEADER]: TOKEN });
      const jwt = { canActivate: jest.fn() };
      expect(await new CheckoutLinkOrJwtGuard(jwt as any).canActivate(context)).toBe(true);
      expect(jwt.canActivate).not.toHaveBeenCalled();
      expect(request.checkoutLinkToken).toBe(TOKEN);
    });

    it('hands a request without a token to the session guard', async () => {
      const { request, context } = ctx({});
      const jwt = { canActivate: jest.fn().mockReturnValue(true) };
      expect(await new CheckoutLinkOrJwtGuard(jwt as any).canActivate(context)).toBe(true);
      expect(jwt.canActivate).toHaveBeenCalledWith(context);
      expect(request.checkoutLinkToken).toBeUndefined();
    });
  });
});
