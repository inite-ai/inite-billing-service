import { CreditsService } from '../src/credits/credits.service';

/**
 * A charge carries an idempotency key because the callers retry on their own.
 *
 * An HTTP client retries after a timeout; an agent retries because the model
 * decided to call the tool again. Every one of those was a second debit, and
 * nothing in the ledger distinguished it from a second genuine charge.
 */
describe('consume() idempotency', () => {
  const build = (existingCharge: any = null) => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      creditBalance: {
        findFirst: jest.fn().mockResolvedValue({ id: 'bal-1', balance: 40 }),
        update: jest.fn().mockResolvedValue({ balance: 35 }),
      },
      creditUsage: {
        findFirst: jest.fn().mockResolvedValue(existingCharge),
        create: jest.fn(),
      },
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    return { tx, service: new CreditsService(prisma, { emit: jest.fn() } as any) };
  };

  it('charges once and stamps the key', async () => {
    const { tx, service } = build(null);

    const result = await service.consume({
      userId: 'user-1',
      amount: 5,
      idempotencyKey: 'call-42',
    });

    expect(result).toMatchObject({ success: true, remainingBalance: 35 });
    expect(tx.creditBalance.update).toHaveBeenCalled();
    expect(tx.creditUsage.create.mock.calls[0][0].data.idempotencyKey).toBe('call-42');
  });

  it('does not charge again when the key has already been used', async () => {
    const { tx, service } = build({ id: 'usage-1', amount: -5 });

    const result: any = await service.consume({
      userId: 'user-1',
      amount: 5,
      idempotencyKey: 'call-42',
    });

    expect(result.success).toBe(true);
    expect(result.replayed).toBe(true);
    expect(tx.creditBalance.update).not.toHaveBeenCalled();
    expect(tx.creditUsage.create).not.toHaveBeenCalled();
  });

  it('reports the balance as it stands on a replay', async () => {
    const { tx, service } = build({ id: 'usage-1', amount: -5 });
    tx.creditBalance.findFirst.mockResolvedValue({ id: 'bal-1', balance: 12 });

    const result = await service.consume({
      userId: 'user-1',
      amount: 5,
      idempotencyKey: 'call-42',
    });

    expect(result.remainingBalance).toBe(12);
  });

  it('looks the key up per user, not globally', async () => {
    const { tx, service } = build(null);

    await service.consume({ userId: 'user-1', amount: 5, idempotencyKey: 'call-42' });

    expect(tx.creditUsage.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', idempotencyKey: 'call-42' },
    });
  });

  it('leaves a charge without a key exactly as it was', async () => {
    const { tx, service } = build(null);

    await service.consume({ userId: 'user-1', amount: 5 });

    expect(tx.creditUsage.findFirst).not.toHaveBeenCalled();
    expect(tx.creditUsage.create.mock.calls[0][0].data.idempotencyKey).toBeNull();
  });
});
