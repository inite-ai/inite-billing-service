import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';

/**
 * A promo code is redeemed when the checkout session is paid — before the
 * provider has said anything. An order that then fails or expires used to keep
 * that redemption forever: a campaign capped at 500 uses could be exhausted by
 * abandoned checkouts alone, and a per-user limit of one (the default) meant a
 * customer whose card was declined could never use the code again, with nothing
 * in the UI explaining why.
 *
 * A refund deliberately does not release: that sale happened, and giving the
 * code back would let it be farmed by buying and refunding.
 */
describe('promo code release on a failed order', () => {
  const build = (releasedRows: Array<{ promo_code_id: string }>) => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue(releasedRows),
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'o1',
          userId: 'user-1',
          price: { product: { serviceId: 'svc-1' } },
        }),
      },
      invoice: { updateMany: jest.fn() },
      promoCode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const outbox = { emit: jest.fn().mockResolvedValue(undefined) };
    const service = new PaymentOrchestratorService(
      {} as any,
      outbox as any,
      {} as any,
      { track: jest.fn() } as any,
      {} as any,
    );
    return { service, tx, outbox };
  };

  it('gives the redemption back', async () => {
    const { service, tx } = build([{ promo_code_id: 'promo-1' }]);

    await (service as any).handleOrderFailed('o1', tx);

    expect(tx.promoCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'promo-1', currentUsageCount: { gte: 1 } },
      data: { currentUsageCount: { decrement: 1 } },
    });
  });

  it('does nothing when the order carried no promo code', async () => {
    const { service, tx } = build([]);

    await (service as any).handleOrderFailed('o1', tx);

    expect(tx.promoCode.updateMany).not.toHaveBeenCalled();
  });

  it('will not drive a usage count below zero', async () => {
    const { service, tx } = build([{ promo_code_id: 'promo-1' }]);
    tx.promoCode.updateMany.mockResolvedValue({ count: 0 });
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await (service as any).handleOrderFailed('o1', tx);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('left as is'));
  });

  it('addresses the failure event to the service that sold the product', async () => {
    // The order lookup had no `include`, so `price.product` was always
    // undefined and every payment.failed event went out unowned — and the
    // outbox delivers by owner, so to nobody.
    const { service, tx, outbox } = build([]);

    await (service as any).handleOrderFailed('o1', tx);

    expect(outbox.emit).toHaveBeenCalledWith(
      'billing.payment.failed',
      expect.objectContaining({ order_id: 'o1' }),
      expect.objectContaining({ serviceId: 'svc-1' }),
    );
  });
});
