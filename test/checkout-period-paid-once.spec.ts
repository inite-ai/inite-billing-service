import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from '../src/checkout/checkout.service';

/**
 * #191 made a one-time order for a priced period expire at its end — a year
 * paid once. But checkout refused PAYMENT for any subscription product, and
 * inite.ai's annual licences are yearly prices of subscription products, so
 * every one of them was answered 400 before an order existed. PAYMENT is now
 * allowed when the price has a period; without one it is still refused.
 */
describe('checkout: a period paid once', () => {
  const build = (price: any) => {
    const prisma: any = {
      order: {
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'order-1', ...data })),
        update: jest.fn(),
      },
      paymentProvider: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CheckoutService(
      prisma,
      { getPriceByCode: jest.fn().mockResolvedValue(price) } as any,
      {} as any,
      { getAffiliateByCode: jest.fn(), trackReferral: jest.fn() } as any,
      {} as any,
      { track: jest.fn() } as any,
      { get: () => undefined } as any,
    );
    return { service, prisma };
  };

  const subscription = {
    id: 'prod-1',
    code: 'inite-visibility-growth',
    isActive: true,
    type: 'subscription',
    serviceId: 'svc-ai',
  };

  it('opens a one-time order for a yearly price of a subscription product', async () => {
    const { service, prisma } = build({
      id: 'p-y',
      code: 'inite-visibility-growth-yearly',
      amount: '790.0000',
      currency: 'USD',
      interval: 'year',
      product: subscription,
    });
    const session = await service.createSession('did:key:a', {
      priceCode: 'inite-visibility-growth-yearly',
      mode: 'PAYMENT',
    } as any);
    expect(session.sessionId).toBe('order-1');
    expect(prisma.order.create.mock.calls[0][0].data).toMatchObject({
      mode: 'PAYMENT',
      priceId: 'p-y',
    });
  });

  it('still refuses PAYMENT for a subscription price with no period', async () => {
    const { service, prisma } = build({
      id: 'p-t',
      code: 'trial',
      amount: '0',
      currency: 'USD',
      interval: null,
      product: subscription,
    });
    await expect(
      service.createSession('did:key:a', { priceCode: 'trial', mode: 'PAYMENT' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});
