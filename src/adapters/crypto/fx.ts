import { Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../common/services/prisma.service';
import { STABLECOIN_CURRENCIES } from './chains';

/** A rate this old is refreshed before it is used. */
const REFRESH_AFTER_MS = 3 * 60 * 60 * 1000;
/**
 * A rate the source published longer ago than this is not used at all. Both
 * sources publish daily and the central bank skips weekends and holidays, so
 * three days is the widest gap a healthy source leaves.
 */
const MAX_PUBLISHED_AGE_MS = 4 * 24 * 60 * 60 * 1000;
/** After a failed refresh, don't try again on every checkout for this long. */
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

export type FxSource = 'par' | 'fixed' | 'open.er-api.com' | 'cbr.ru';

/** How much of a currency one dollar buys, and where that came from. */
export interface UsdQuote {
  currency: string;
  perUsd: Decimal;
  source: FxSource;
  publishedAt: Date | null;
}

export interface FxSettings {
  /** Admin-set rates (units per USD) that take precedence over any source. */
  fixedRates?: Record<string, string | number>;
}

interface FetchedRates {
  source: FxSource;
  publishedAt: Date | null;
  /** Units per USD. */
  rates: Map<string, Decimal>;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return (await response.json()) as T;
}

/** open.er-api.com: 160+ currencies against USD, refreshed daily, no key. */
export async function fetchOpenErApi(): Promise<FetchedRates> {
  const body = await getJson<{
    result: string;
    time_last_update_unix?: number;
    rates?: Record<string, number>;
  }>('https://open.er-api.com/v6/latest/USD');
  if (body.result !== 'success' || !body.rates) throw new Error('open.er-api.com: no rates');
  const rates = new Map<string, Decimal>();
  for (const [currency, value] of Object.entries(body.rates)) {
    if (/^[A-Z]{3}$/.test(currency) && Number.isFinite(value) && value > 0) {
      rates.set(currency, new Decimal(String(value)));
    }
  }
  return {
    source: 'open.er-api.com',
    publishedAt: body.time_last_update_unix ? new Date(body.time_last_update_unix * 1000) : null,
    rates,
  };
}

/**
 * The Central Bank of Russia's daily rates, via cbr-xml-daily.ru. Quoted in
 * roubles per `Nominal` units, so every other currency comes out as a cross
 * rate through the rouble. The fallback: it covers the rouble — the currency
 * this service most needs converted — when the primary source is down.
 */
export async function fetchCbr(): Promise<FetchedRates> {
  const body = await getJson<{
    Date?: string;
    Valute?: Record<string, { CharCode: string; Nominal: number; Value: number }>;
  }>('https://www.cbr-xml-daily.ru/daily_json.js');
  const usd = body.Valute?.USD;
  if (!usd || !(usd.Value > 0)) throw new Error('cbr.ru: no dollar rate');

  const rubPerUsd = new Decimal(String(usd.Value)).div(usd.Nominal || 1);
  const rates = new Map<string, Decimal>([['RUB', rubPerUsd]]);
  for (const valute of Object.values(body.Valute ?? {})) {
    if (!/^[A-Z]{3}$/.test(valute.CharCode) || !(valute.Value > 0)) continue;
    // One unit of X is worth Value/Nominal roubles; one dollar buys
    // rubPerUsd / (rubles per X) units of X.
    const rubPerUnit = new Decimal(String(valute.Value)).div(valute.Nominal || 1);
    rates.set(valute.CharCode, rubPerUsd.div(rubPerUnit));
  }
  rates.set('USD', new Decimal(1));
  return { source: 'cbr.ru', publishedAt: body.Date ? new Date(body.Date) : null, rates };
}

/**
 * Exchange rates for pricing crypto invoices.
 *
 * A stablecoin is a dollar, so a price in any other currency has to be turned
 * into dollars at the moment the invoice is opened, and that rate is then
 * fixed for the invoice. Rates are kept in the database and refreshed at most
 * every few hours — from open.er-api.com, falling back to the Central Bank of
 * Russia — and an admin can pin a rate per currency, which always wins.
 *
 * When no usable rate exists — the sources are down and what is stored is
 * days old — the answer is "no quote", and crypto is simply not offered for
 * that price. Charging at a stale rate is how a shop sells at a loss, or a
 * customer overpays, without anyone noticing.
 */
export class FxRates {
  private readonly logger = new Logger(FxRates.name);
  private inflight: Promise<{ source: FxSource; count: number }> | null = null;
  private lastFailureAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: Array<() => Promise<FetchedRates>> = [fetchOpenErApi, fetchCbr],
  ) {}

  async quote(currencyInput: string, settings: FxSettings = {}): Promise<UsdQuote | null> {
    const currency = String(currencyInput).toUpperCase();
    if (STABLECOIN_CURRENCIES.has(currency)) {
      return { currency, perUsd: new Decimal(1), source: 'par', publishedAt: null };
    }

    const fixed = settings.fixedRates?.[currency];
    if (fixed !== undefined && fixed !== null && `${fixed}` !== '') {
      const perUsd = new Decimal(String(fixed));
      if (perUsd.gt(0)) return { currency, perUsd, source: 'fixed', publishedAt: null };
    }

    let row = await this.prisma.fxRate.findUnique({ where: { currency } });
    if (!row || Date.now() - row.fetchedAt.getTime() > REFRESH_AFTER_MS) {
      await this.refresh().catch(() => undefined);
      row = await this.prisma.fxRate.findUnique({ where: { currency } });
    }
    if (!row) return null;

    const published = row.publishedAt ?? row.fetchedAt;
    if (Date.now() - published.getTime() > MAX_PUBLISHED_AGE_MS) {
      this.logger.warn(`FX rate for ${currency} is from ${published.toISOString()}; not using it`);
      return null;
    }
    return {
      currency,
      perUsd: new Decimal(row.perUsd.toString()),
      source: row.source as FxSource,
      publishedAt: row.publishedAt,
    };
  }

  /**
   * Fetch fresh rates, from the first source that answers. Concurrent callers
   * share one fetch, and after a failure the sources are left alone for a few
   * minutes rather than hit by every checkout.
   */
  async refresh(opts: { force?: boolean } = {}): Promise<{ source: FxSource; count: number }> {
    if (!opts.force && Date.now() - this.lastFailureAt < RETRY_AFTER_FAILURE_MS) {
      throw new Error('Exchange rate sources failed recently; not retrying yet');
    }
    this.inflight ??= (async () => {
      const errors: string[] = [];
      for (const source of this.sources) {
        try {
          const fetched = await source();
          await this.store(fetched);
          this.lastFailureAt = 0;
          return { source: fetched.source, count: fetched.rates.size };
        } catch (error: any) {
          errors.push(error.message);
        }
      }
      this.lastFailureAt = Date.now();
      throw new Error(`No exchange rate source answered: ${errors.join('; ')}`);
    })().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async store(fetched: FetchedRates): Promise<void> {
    const fetchedAt = new Date();
    await this.prisma.$transaction(
      [...fetched.rates].map(([currency, perUsd]) =>
        this.prisma.fxRate.upsert({
          where: { currency },
          create: {
            currency,
            perUsd,
            source: fetched.source,
            publishedAt: fetched.publishedAt,
            fetchedAt,
          },
          update: { perUsd, source: fetched.source, publishedAt: fetched.publishedAt, fetchedAt },
        }),
      ),
    );
  }

  /**
   * The dollar amount to invoice for a price: converted at the quote, plus the
   * shop's markup for a conversion. A dollar price is never marked up.
   */
  static toUsd(amount: string | number, quote: UsdQuote, markupPercent: number): Decimal {
    const usd = new Decimal(String(amount)).div(quote.perUsd);
    return quote.source === 'par' ? usd : usd.mul(new Decimal(100).plus(markupPercent)).div(100);
  }
}
