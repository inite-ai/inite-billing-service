import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { ConnectorRegistry } from '../common/connectors/connector-registry.service';
import { Connector } from '../common/connectors/connector.interface';
import { RAILS } from '../common/connectors/rail';
import { ticked } from '../common/connectors/rail-contract';
import { toMoney } from '../common/money';
import { quoteInput, railDecision } from './rail-decision';

/** Crypto alone makes a price payable only here, or where an admin ticked it (owner, 24.11.2026). */
const CRYPTO_CURRENCIES = ['USD', 'EUR'];

/** Listing a rail's methods may read an exchange rate; the catalogue is read by every site. */
const METHODS_TTL_MS = 60_000;

export interface PayMethod {
  rail: string;
  /** The currency the buyer is charged in. */
  chargedIn: string;
}

export interface Payability {
  state: 'payable' | 'payable_converted' | 'unpayable';
  methods: PayMethod[];
  /** For a plan: charged without asking again, or approved by the buyer each time. */
  collects: 'automatic' | 'you_confirm' | null;
  /** Why each active rail does not take it. */
  reasons: Record<string, string>;
}

export interface PriceToAsk {
  code: string;
  amount: unknown;
  currency: string;
  interval?: string | null;
  metadata?: unknown;
  product: { code: string; type: string; metadata?: unknown };
}

/**
 * Which prices can be paid, by asking every active rail. Nothing of the answer
 * is stored: the providers are read on each call, so a setting saved in the admin
 * — the lava.top general offer, a ticked currency, a key — counts at once.
 */
@Injectable()
export class PayabilityService {
  private readonly listed = new Map<string, { any: boolean; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectors: ConnectorRegistry,
  ) {}

  async forPrices(prices: PriceToAsk[]): Promise<Map<string, Payability>> {
    const providers = await this.prisma.paymentProvider.findMany({
      where: { isActive: true },
      select: { code: true, currencies: true, config: true },
    });
    const rails = providers.map((provider) => ({
      provider,
      connector: (this.connectors.get(provider.code) as Connector | undefined) ?? null,
    }));

    const hasMethods = async (connector: Connector, rail: string, currency: string) => {
      const key = `${rail}:${currency}`;
      const known = this.listed.get(key);
      if (known && known.until > Date.now()) return known.any;
      const methods = connector.listMethods
        ? await connector.listMethods({ currency }).catch(() => [])
        : [];
      this.listed.set(key, { any: methods.length > 0, until: Date.now() + METHODS_TTL_MS });
      return methods.length > 0;
    };

    const out = new Map<string, Payability>();
    for (const price of prices) {
      const currency = price.currency.toUpperCase();
      const recurring = price.product.type === 'subscription' && !!price.interval;
      if (!toMoney(price.amount as any).gt(0)) {
        out.set(price.code, { state: 'payable', methods: [], collects: null, reasons: {} });
        continue;
      }
      const order = quoteInput({
        amount: price.amount,
        currency,
        mode: recurring ? 'SUBSCRIPTION' : 'PAYMENT',
        price,
      });
      const methods: PayMethod[] = [];
      const reasons: Record<string, string> = {};
      const strategies: string[] = [];
      for (const { provider, connector } of rails) {
        const capabilities = connector?.capabilities?.();
        if (!connector) reasons[provider.code] = 'no_adapter';
        else if (capabilities?.isClientSide) reasons[provider.code] = 'app_store_only';
        else {
          const quote = railDecision(connector, provider, order);
          if (quote && !quote.ok) reasons[provider.code] = quote.reason;
          else if (
            provider.code === RAILS.CRYPTO &&
            !CRYPTO_CURRENCIES.includes(currency) &&
            !ticked(provider, currency)
          ) {
            reasons[provider.code] = 'currency';
          } else if (
            capabilities?.selectableMethods &&
            !(await hasMethods(connector, provider.code, currency))
          ) {
            reasons[provider.code] = 'no_method';
          } else {
            methods.push({ rail: provider.code, chargedIn: quote?.chargedIn ?? currency });
            if (quote) strategies.push(quote.strategy);
          }
        }
      }
      out.set(price.code, {
        state: !methods.length
          ? 'unpayable'
          : methods.some((m) => m.chargedIn === currency)
            ? 'payable'
            : 'payable_converted',
        methods,
        collects:
          !recurring || !methods.length
            ? null
            : strategies.some((s) => s !== 'buyer_approved')
              ? 'automatic'
              : 'you_confirm',
        reasons,
      });
    }
    return out;
  }

  /** Every price on sale, with the answer for each. */
  async onSale() {
    const prices = await this.prisma.price.findMany({
      where: { isActive: true, product: { isActive: true, type: { not: 'open' } } },
      include: { product: true },
      orderBy: { code: 'asc' },
    });
    const answers = await this.forPrices(prices as any);
    return prices.map((price) => ({ price, answer: answers.get(price.code)! }));
  }

  /** The admin list: prices nobody can pay, and those only crypto takes. */
  async unpayable() {
    const rows = await this.onSale();
    return {
      checked: rows.length,
      prices: rows
        .filter(
          ({ answer, price }) =>
            toMoney(price.amount).gt(0) && answer.methods.every((m) => m.rail === RAILS.CRYPTO),
        )
        .map(({ price, answer }) => ({
          code: price.code,
          productCode: price.product.code,
          currency: price.currency.toUpperCase(),
          amount: price.amount.toString(),
          interval: price.interval,
          mode:
            price.product.type === 'subscription' && price.interval ? 'SUBSCRIPTION' : 'PAYMENT',
          state: answer.methods.length ? 'crypto_only' : 'nobody',
          reasons: answer.reasons,
        })),
    };
  }
}
