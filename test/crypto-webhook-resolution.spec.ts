import { BadRequestException } from '@nestjs/common';
import { CryptoAdapter, UNMATCHED_TRANSFER_EVENT } from '../src/adapters/crypto/crypto.adapter';

/**
 * How the crypto rail decides a payment.
 *
 * A transfer attached to an invoice only settles it when it is checked against
 * that invoice — our wallet, the right chain and token, at least the amount —
 * and final. A transfer that fails the check leaves the order payable instead
 * of failing it: it is somebody's money arriving in the wrong shape, for an
 * admin to look at, and the customer can still pay correctly.
 *
 * And the event for a transfer carries its phase, so "now final" is a new
 * event rather than a duplicate of "first seen" — with one id per transaction
 * the final report was dropped and the order stayed open forever.
 */
describe('Crypto adapter: settlement decisions', () => {
  const INVOICE_ID = 'crypto_TRON_1790000000000_ab12cd34';
  const RECEIVER = 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G';

  const snapshot = {
    chain: 'TRON',
    token: 'USDT',
    receiverAddress: RECEIVER,
    amount: '10.000137',
    onChainAmount: '10000137',
    decimals: 6,
    requiredConfirmations: 19,
  };

  const observed = (o: Record<string, any> = {}) => ({
    chain: 'TRON',
    txHash: 'tx-1',
    to: RECEIVER,
    token: 'USDT',
    amount: '10000137',
    confirmations: 19,
    isFinal: true,
    ...o,
  });

  const build = (intent: any, invoice: any = { status: 'confirming' }) => {
    const prisma: any = {
      paymentIntent: {
        findFirst: jest.fn().mockResolvedValue(intent),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const adapter = new CryptoAdapter(prisma);
    const ledger = {
      findByInvoiceId: jest.fn().mockResolvedValue(invoice),
      ingest: jest.fn(),
    };
    (adapter as any).ledger = ledger;
    return { adapter, prisma, ledger };
  };

  const withTransfer = (o: Record<string, any> = {}, status = 'created') => ({
    id: 'pi-1',
    status,
    providerIntentId: INVOICE_ID,
    snapshot: { ...snapshot, observedTransfer: observed(o) },
  });

  describe('getIntentStatus', () => {
    it('settles a checked, final transfer, keeping the invoice details on the snapshot', async () => {
      const { adapter } = build(withTransfer());
      const result = await adapter.getIntentStatus(INVOICE_ID);
      expect(result.status).toBe('paid');
      expect(result.amountVerifiedByAdapter).toBe(true);
      expect(result.providerData).toMatchObject({
        receiverAddress: RECEIVER,
        onChainAmount: '10000137',
        observedTransfer: { txHash: 'tx-1', validated: true },
      });
    });

    it('leaves a payment that is seen but not yet final open', async () => {
      const { adapter } = build(withTransfer({ confirmations: 3, isFinal: false }));
      expect((await adapter.getIntentStatus(INVOICE_ID)).status).toBe('opened');
    });

    it.each([
      [
        'a transfer to another wallet',
        { to: 'TOtherWallet000000000000000000000' },
        'receiver_mismatch',
      ],
      ['another token', { token: 'USDC' }, 'token_mismatch'],
      ['another chain', { chain: 'ETH' }, 'chain_mismatch'],
      ['less than the invoice', { amount: '10000000' }, 'amount_too_low'],
    ])('does not settle — and does not fail the order over — %s', async (_label, over, reason) => {
      const { adapter } = build(withTransfer(over));
      const result = await adapter.getIntentStatus(INVOICE_ID);
      expect(result.status).toBe('created');
      expect(result.metadata?.reason).toBe(reason);
    });

    it('keeps an intent that is already open where it is when a transfer fails the check', async () => {
      const { adapter } = build(withTransfer({ amount: '1' }, 'opened'));
      expect((await adapter.getIntentStatus(INVOICE_ID)).status).toBe('opened');
    });

    it('accepts a decimal amount equal to the invoice', async () => {
      const { adapter } = build(withTransfer({ amount: '10.000137' }));
      expect((await adapter.getIntentStatus(INVOICE_ID)).status).toBe('paid');
    });

    it('trusts an admin’s attribution on the amount, not on the wallet', async () => {
      const low = build(withTransfer({ amount: '10000000', manual: true }));
      expect((await low.adapter.getIntentStatus(INVOICE_ID)).status).toBe('paid');

      const elsewhere = build(
        withTransfer({ manual: true, to: 'TOtherWallet000000000000000000000' }),
      );
      expect((await elsewhere.adapter.getIntentStatus(INVOICE_ID)).status).toBe('created');
    });

    it('matches a TON receiver whichever spelling of the address each side used', async () => {
      const ton = {
        id: 'pi-1',
        status: 'created',
        providerIntentId: INVOICE_ID,
        snapshot: {
          ...snapshot,
          chain: 'TON',
          receiverAddress: 'EQDwB8YlfqX_bYO4cGGSkIJYUcgqlij6fhuEwEAhLAppLbEV',
          requiredConfirmations: 1,
          observedTransfer: observed({
            chain: 'TON',
            to: '0:F007C6257EA5FF6D83B870619290825851C82A9628FA7E1B84C040212C0A692D',
            confirmations: 1,
          }),
        },
      };
      const { adapter } = build(ton);
      expect((await adapter.getIntentStatus(INVOICE_ID)).status).toBe('paid');
    });

    it.each(['expired', 'cancelled'])(
      'reports an invoice that was %s, with nothing received, as expired',
      async (status) => {
        const { adapter } = build({ id: 'pi-1', status: 'created', snapshot }, { status });
        expect((await adapter.getIntentStatus(INVOICE_ID)).status).toBe('expired');
      },
    );

    it('is still waiting while the invoice is open and nothing has arrived', async () => {
      const { adapter } = build(
        { id: 'pi-1', status: 'created', snapshot },
        { status: 'awaiting' },
      );
      expect((await adapter.getIntentStatus(INVOICE_ID)).status).toBe('created');
    });
  });

  describe('events', () => {
    const transferRow = (o: Record<string, any> = {}) => ({
      id: 'tr-1',
      chain: 'TRON',
      txHash: 'tx-1',
      token: 'USDT',
      fromAddress: 'TSender',
      toAddress: RECEIVER,
      amountRaw: '10000137',
      confirmations: 19,
      isFinal: true,
      invoiceId: 'inv-row-1',
      ...o,
    });
    const invoiceRow = { id: 'inv-row-1', invoiceId: INVOICE_ID };

    it('gives "seen" and "final" different event ids, so the second is not dropped as a duplicate', () => {
      const { adapter } = build(null);
      const seen = adapter.eventFor({
        transfer: transferRow({ isFinal: false, confirmations: 3 }) as any,
        invoice: invoiceRow as any,
        phase: 'seen',
        created: true,
      });
      const final = adapter.eventFor({
        transfer: transferRow() as any,
        invoice: invoiceRow as any,
        phase: 'final',
        created: false,
      });
      expect(seen.webhookId).not.toBe(final.webhookId);
      expect(seen.eventType).toBe('payment.confirming');
      expect(final.eventType).toBe('payment.paid');
      expect(final.entityId).toBe(INVOICE_ID);
    });

    it('files a transfer no invoice claims as unmatched, not as a payment', () => {
      const { adapter } = build(null);
      const event = adapter.eventFor({
        transfer: transferRow({ invoiceId: null }) as any,
        invoice: null,
        phase: null,
        created: true,
      });
      expect(event.eventType).toBe(UNMATCHED_TRANSFER_EVENT);
      expect(event.entityId).toBe('tr-1');
    });
  });

  describe('an external indexer’s webhook', () => {
    it('reads a decimal amount into smallest units and judges finality by the chain', async () => {
      const { adapter, ledger } = build(null);
      ledger.ingest.mockResolvedValue({
        transfer: { id: 'tr-1', chain: 'TRON', txHash: 'tx-1', isFinal: false, invoiceId: null },
        invoice: null,
        phase: null,
        created: true,
      });

      await adapter.handleWebhook({
        chain: 'TRON',
        txHash: 'tx-1',
        to: RECEIVER,
        token: 'usdt',
        amount: '10.000137',
        confirmations: 5,
      });

      expect(ledger.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          amountRaw: '10000137',
          token: 'USDT',
          isFinal: false,
          confirmations: 5,
        }),
        'webhook',
      );
    });

    it('attaches a matched transfer to the intent it pays', async () => {
      const { adapter, ledger, prisma } = build({ id: 'pi-1', status: 'created', snapshot });
      ledger.ingest.mockResolvedValue({
        transfer: {
          id: 'tr-1',
          chain: 'TRON',
          txHash: 'tx-1',
          token: 'USDT',
          fromAddress: 'TSender',
          toAddress: RECEIVER,
          amountRaw: '10000137',
          confirmations: 19,
          isFinal: true,
          invoiceId: 'inv-row-1',
        },
        invoice: { id: 'inv-row-1', invoiceId: INVOICE_ID },
        phase: 'final',
        created: true,
      });

      await adapter.handleWebhook({
        chain: 'TRON',
        txHash: 'tx-1',
        to: RECEIVER,
        token: 'USDT',
        amount: '10000137',
        confirmations: 19,
      });

      const written = prisma.paymentIntent.update.mock.calls[0][0].data;
      expect(written.txHash).toBe('tx-1');
      expect(written.snapshot.observedTransfer).toMatchObject({
        amount: '10000137',
        isFinal: true,
      });
      expect(written.snapshot.receiverAddress).toBe(RECEIVER);
    });

    it('refuses a token the chain does not carry, or an unreadable amount', async () => {
      const { adapter } = build(null);
      await expect(
        adapter.handleWebhook({
          chain: 'TRON',
          txHash: 'x',
          to: RECEIVER,
          token: 'USDC',
          amount: '1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        adapter.handleWebhook({
          chain: 'TRON',
          txHash: 'x',
          to: RECEIVER,
          token: 'USDT',
          amount: 'lots',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
