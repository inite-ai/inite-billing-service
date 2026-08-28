import { NotFoundException } from '@nestjs/common';
import { CheckoutService } from '../src/checkout/checkout.service';

/**
 * A service API key could open a checkout for another module's product, and
 * read any checkout session in the platform — user id, product and amount
 * included. A key belongs to one service; it sells and sees that service's
 * catalogue.
 */
describe('checkout tenant scope', () => {
  const order = {
    id: 'ord-1',
    userId: 'user-1',
    status: 'created',
    amount: '20.0000',
    currency: 'USD',
    price: { id: 'price-1', product: { id: 'prod-1', serviceId: 'svc-club' } },
  };

  const build = () => {
    const prisma: any = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      paymentProvider: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new CheckoutService(
      prisma,
      { getPriceByCode: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  };

  it("hides another service's session from a service key", async () => {
    const service = build();
    await expect(service.getSession('ord-1', undefined, 'svc-health')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('shows a service its own session', async () => {
    const service = build();
    await expect(service.getSession('ord-1', undefined, 'svc-club')).resolves.toBeDefined();
  });

  it('leaves the end-user path alone', async () => {
    const service = build();
    await expect(service.getSession('ord-1', 'user-1')).resolves.toBeDefined();
  });
});
