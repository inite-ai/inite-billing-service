import { CryptoAdapter } from '../src/adapters/crypto/crypto.adapter';

/**
 * The crypto rail was broken end-to-end:
 *  - handleWebhook set entityId = memo, but the intent's providerIntentId is the
 *    invoice id, so the generic processor could never reconcile a confirmation;
 *  - getIntentStatus never validated the transfer, so (had the lookup worked)
 *    any transfer of any token/amount to any address would settle the invoice.
 *
 * These tests pin the fixed behavior: the webhook resolves the intent by memo
 * and persists the observed transfer; getIntentStatus then validates
 * receiver/token/amount/chain and only reports paid for a valid, confirmed
 * transfer — failing everything else closed.
 */
describe('Crypto webhook resolution + validation', () => {
  const INVOICE_ID = 'crypto_ETH_1712345678_abcd1234';
  const RECEIVER = '0xReCeIvErADDRESS0000000000000000000000AA';
  const MEMO = 'ABCD1234';

  // Invoice snapshot as persisted from createPaymentIntent metadata.
  const invoiceSnapshot = {
    chain: 'ETH',
    token: 'USDT',
    receiverAddress: RECEIVER,
    amount: '10',
    onChainAmount: '10000000', // 10 USDT @ 6 decimals
    decimals: 6,
    memo: MEMO,
    requiredConfirmations: 12,
  };

  const buildAdapter = (intent: any | null) => {
    const store: any = { updated: null };
    const prisma: any = {
      paymentIntent: {
        findMany: jest.fn().mockResolvedValue(intent ? [intent] : []),
        findFirst: jest.fn().mockImplementation(async () => store.updated ?? intent),
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          store.updated = { ...intent, ...data, snapshot: data.snapshot };
          return store.updated;
        }),
      },
    };
    return { adapter: new CryptoAdapter(prisma), prisma, store };
  };

  const intentRow = () => ({
    id: 'pi-1',
    providerIntentId: INVOICE_ID,
    snapshot: { ...invoiceSnapshot },
  });

  const transfer = (over: Record<string, any> = {}) => ({
    chain: 'ETH',
    txHash: '0xdeadbeef',
    from: '0xsender',
    to: RECEIVER,
    token: 'USDT',
    amount: '10000000',
    confirmations: 12,
    memo: MEMO,
    ...over,
  });

  it('handleWebhook resolves the intent by memo and returns its providerIntentId as entityId', async () => {
    const { adapter, prisma } = buildAdapter(intentRow());
    const parsed = await adapter.handleWebhook(transfer());
    expect(parsed.entityId).toBe(INVOICE_ID); // NOT the memo
    expect(prisma.paymentIntent.update).toHaveBeenCalledTimes(1);
    const persisted = prisma.paymentIntent.update.mock.calls[0][0].data.snapshot.observedTransfer;
    expect(persisted.txHash).toBe('0xdeadbeef');
  });

  it('a valid, confirmed transfer settles the invoice as paid', async () => {
    const { adapter } = buildAdapter(intentRow());
    await adapter.handleWebhook(transfer());
    const res = await adapter.getIntentStatus(INVOICE_ID);
    expect(res.status).toBe('paid');
  });

  it('a transfer to the WRONG receiver is rejected (failed)', async () => {
    const { adapter } = buildAdapter(intentRow());
    await adapter.handleWebhook(transfer({ to: '0xAttackerWallet' }));
    const res = await adapter.getIntentStatus(INVOICE_ID);
    expect(res.status).toBe('failed');
    expect(res.metadata?.reason).toBe('receiver_mismatch');
  });

  it('a transfer of the WRONG token is rejected', async () => {
    const { adapter } = buildAdapter(intentRow());
    await adapter.handleWebhook(transfer({ token: 'SHIB' }));
    expect((await adapter.getIntentStatus(INVOICE_ID)).status).toBe('failed');
  });

  it('an underpaying transfer (amount too low) is rejected', async () => {
    const { adapter } = buildAdapter(intentRow());
    await adapter.handleWebhook(transfer({ amount: '9000000' })); // 9 < 10 USDT
    const res = await adapter.getIntentStatus(INVOICE_ID);
    expect(res.status).toBe('failed');
    expect(res.metadata?.reason).toBe('amount_too_low');
  });

  it('a valid but under-confirmed transfer is opened, not paid', async () => {
    const { adapter } = buildAdapter(intentRow());
    await adapter.handleWebhook(transfer({ confirmations: 3 }));
    const res = await adapter.getIntentStatus(INVOICE_ID);
    expect(res.status).toBe('opened');
  });

  it('accepts a decimal token amount equal to the invoice (unit-tolerant parsing)', async () => {
    const { adapter } = buildAdapter(intentRow());
    await adapter.handleWebhook(transfer({ amount: '10.0' }));
    expect((await adapter.getIntentStatus(INVOICE_ID)).status).toBe('paid');
  });

  it('does not resolve (and cannot settle) when the memo matches no invoice', async () => {
    const { adapter, prisma } = buildAdapter(null);
    const parsed = await adapter.handleWebhook(transfer({ memo: 'ZZZZ9999' }));
    expect(parsed.entityId).not.toBe(INVOICE_ID);
    expect(prisma.paymentIntent.update).not.toHaveBeenCalled();
  });
});
