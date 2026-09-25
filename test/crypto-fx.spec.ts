import { Decimal } from '@prisma/client/runtime/library';
import { FxRates, fetchCbr, fetchOpenErApi } from '../src/adapters/crypto/fx';

/**
 * Converting a price into stablecoins. The rate is the whole of what the
 * customer pays, so these pin where it comes from — an admin's pinned rate,
 * then the primary source, then the central bank — and when there is no rate
 * worth using at all.
 */
describe('crypto exchange rates', () => {
  const fetchMock = jest.fn();
  const answer = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
  });

  describe('sources', () => {
    it('reads open.er-api.com (units per dollar, as published)', async () => {
      fetchMock.mockReturnValue(
        answer({
          result: 'success',
          time_last_update_unix: 1790294551,
          rates: { USD: 1, RUB: 84.485696, EUR: 0.878683, bogus: 'x' },
        }),
      );
      const fetched = await fetchOpenErApi();
      expect(fetched.rates.get('RUB')?.toString()).toBe('84.485696');
      expect(fetched.rates.has('bogus')).toBe(false);
      expect(fetched.publishedAt?.getTime()).toBe(1790294551000);
    });

    it('turns the central bank’s rouble quotes into cross rates, minding the nominal', async () => {
      fetchMock.mockReturnValue(
        answer({
          Date: '2026-09-26T11:30:00+03:00',
          Valute: {
            USD: { CharCode: 'USD', Nominal: 1, Value: 84.3414 },
            KZT: { CharCode: 'KZT', Nominal: 100, Value: 19.0865 },
          },
        }),
      );
      const fetched = await fetchCbr();
      expect(fetched.rates.get('RUB')?.toString()).toBe('84.3414');
      // 100 tenge = 19.0865 ₽, so a dollar buys 84.3414 / 0.190865 ≈ 441.89 tenge.
      expect(fetched.rates.get('KZT')?.toDecimalPlaces(2).toString()).toBe('441.89');
    });
  });

  describe('quotes', () => {
    const store = () => {
      const rows = new Map<string, any>();
      const prisma: any = {
        fxRate: {
          findUnique: jest.fn(async ({ where }: any) => rows.get(where.currency) ?? null),
          upsert: jest.fn(({ where, create }: any) => {
            rows.set(where.currency, create);
            return create;
          }),
        },
        $transaction: jest.fn(async (ops: any[]) => ops),
      };
      return { prisma, rows };
    };
    const source = (source: any, rates: Record<string, string>, publishedAt = new Date()) =>
      jest.fn().mockResolvedValue({
        source,
        publishedAt,
        rates: new Map(Object.entries(rates).map(([c, r]) => [c, new Decimal(r)])),
      });

    it('treats dollar prices as dollars, without a lookup', async () => {
      const { prisma } = store();
      const quote = await new FxRates(prisma, []).quote('usd');
      expect(quote).toMatchObject({ source: 'par' });
      expect(quote!.perUsd.toString()).toBe('1');
      expect(prisma.fxRate.findUnique).not.toHaveBeenCalled();
    });

    it('uses an admin’s pinned rate over any source', async () => {
      const primary = source('open.er-api.com', { RUB: '84' });
      const { prisma } = store();
      const quote = await new FxRates(prisma, [primary]).quote('RUB', {
        fixedRates: { RUB: '95' },
      });
      expect(quote).toMatchObject({ source: 'fixed' });
      expect(quote!.perUsd.toString()).toBe('95');
      expect(primary).not.toHaveBeenCalled();
    });

    it('fetches when nothing is stored, and falls back to the central bank when the primary fails', async () => {
      const primary = jest.fn().mockRejectedValue(new Error('down'));
      const cbr = source('cbr.ru', { RUB: '84.34' });
      const { prisma } = store();
      const quote = await new FxRates(prisma, [primary, cbr]).quote('RUB');
      expect(quote).toMatchObject({ source: 'cbr.ru' });
      expect(quote!.perUsd.toString()).toBe('84.34');
    });

    it('refuses a rate the source published days ago rather than charging at it', async () => {
      const old = new Date(Date.now() - 6 * 24 * 3600_000);
      const { prisma, rows } = store();
      rows.set('RUB', {
        currency: 'RUB',
        perUsd: '70',
        source: 'cbr.ru',
        publishedAt: old,
        fetchedAt: new Date(),
      });
      await expect(new FxRates(prisma, []).quote('RUB')).resolves.toBeNull();
    });

    it('has no quote for a currency no source knows', async () => {
      const { prisma } = store();
      const fx = new FxRates(prisma, [source('open.er-api.com', { RUB: '84' })]);
      await expect(fx.quote('ZZZ')).resolves.toBeNull();
    });

    it('does not hammer the sources after they failed', async () => {
      const primary = jest.fn().mockRejectedValue(new Error('down'));
      const { prisma } = store();
      const fx = new FxRates(prisma, [primary]);
      await fx.quote('RUB');
      await fx.quote('RUB');
      expect(primary).toHaveBeenCalledTimes(1);
    });

    it('shares one fetch between concurrent checkouts', async () => {
      const primary = source('open.er-api.com', { RUB: '84', EUR: '0.9' });
      const { prisma } = store();
      const fx = new FxRates(prisma, [primary]);
      await Promise.all([fx.quote('RUB'), fx.quote('EUR'), fx.quote('RUB')]);
      expect(primary).toHaveBeenCalledTimes(1);
    });
  });

  describe('conversion', () => {
    const quote = (perUsd: string, source: any = 'open.er-api.com') => ({
      currency: 'RUB',
      perUsd: new Decimal(perUsd),
      source,
      publishedAt: null,
    });

    it('converts and adds the markup', () => {
      expect(FxRates.toUsd(9000, quote('90'), 2).toString()).toBe('102');
    });

    it('never marks up a dollar price', () => {
      expect(FxRates.toUsd(100, quote('1', 'par'), 5).toString()).toBe('100');
    });
  });
});
