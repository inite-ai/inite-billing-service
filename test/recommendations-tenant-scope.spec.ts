import { NotFoundException } from '@nestjs/common';
import { RecommendationsService } from '../src/recommendations/recommendations.service';
import { RecommendationsController } from '../src/recommendations/recommendations.controller';

/**
 * Next-best-offer was assembled from the whole platform.
 *
 * A module asking for a user's recommendations got answers drawn from every
 * service's catalogue and ranked on everything that user had ever bought
 * anywhere — so it learned its neighbours' products, their prices, and this
 * customer's history with them. The user's own dashboard still sees across
 * services; that is what it is for.
 */
describe('recommendation tenant scoping', () => {
  const buildService = () => {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
      entitlement: { findMany: jest.fn().mockResolvedValue([]) },
      funnelEvent: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const config = { get: () => undefined } as any;
    const anthropicConfig = {} as any;
    return { prisma, service: new RecommendationsService(prisma, config, anthropicConfig) };
  };

  const whereOf = (mock: jest.Mock) => mock.mock.calls[0][0].where;

  it('confines the catalogue and the signals to the calling service', async () => {
    const { prisma, service } = buildService();

    await service.getNextBestOffers('user-1', { serviceId: 'svc-a' });

    expect(whereOf(prisma.product.findMany)).toEqual({ isActive: true, serviceId: 'svc-a' });
    expect(whereOf(prisma.order.findMany)).toMatchObject({
      price: { product: { serviceId: 'svc-a' } },
    });
    expect(whereOf(prisma.subscription.findMany)).toMatchObject({
      price: { product: { serviceId: 'svc-a' } },
    });
    expect(whereOf(prisma.funnelEvent.findMany)).toMatchObject({ serviceId: 'svc-a' });
  });

  it('leaves the user’s own dashboard unrestricted', async () => {
    const { prisma, service } = buildService();

    await service.getNextBestOffers('user-1', {});

    expect(whereOf(prisma.product.findMany)).toEqual({ isActive: true });
    expect(whereOf(prisma.order.findMany)).toEqual({ userId: 'user-1', status: 'paid' });
  });

  describe('controller', () => {
    const build = (order: any) => {
      const recommendations = { getNextBestOffers: jest.fn().mockResolvedValue([]) };
      const prisma: any = { order: { findUnique: jest.fn().mockResolvedValue(order) } };
      return {
        recommendations,
        controller: new RecommendationsController(recommendations as any, prisma),
      };
    };

    const session = (serviceId: string | null) => ({
      id: 'sess-1',
      userId: 'user-1',
      price: { productId: 'prod-1', product: { serviceId } },
    });

    it('refuses a service a checkout session belonging to another service', async () => {
      const { controller } = build(session('svc-a'));
      await expect(
        controller.forCheckout(
          { userId: 'service:svc-b', isService: true, serviceId: 'svc-b', roles: [] } as any,
          'sess-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('passes the caller’s service down when a module asks for a user', async () => {
      const { controller, recommendations } = build(null);
      await controller.forUser(
        { userId: 'service:svc-a', isService: true, serviceId: 'svc-a', roles: [] } as any,
        'user-1',
      );
      expect(recommendations.getNextBestOffers).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ serviceId: 'svc-a' }),
      );
    });

    it('passes no service for a user asking about themselves', async () => {
      const { controller, recommendations } = build(null);
      await controller.forUser({ userId: 'user-1', roles: [] } as any, 'user-1');
      expect(recommendations.getNextBestOffers).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ serviceId: undefined }),
      );
    });
  });
});
