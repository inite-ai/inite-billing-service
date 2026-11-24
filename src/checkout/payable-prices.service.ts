import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { Connector } from '../common/connectors/connector.interface';
import { RAILS } from '../common/connectors/rail';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { railRefuses } from './payable';

export interface UnpayablePrice {
  code: string;
  productCode: string;
  currency: string;
  amount: string;
  interval: string | null;
  mode: 'PAYMENT' | 'SUBSCRIPTION';
  /** `nobody`: no rail at all. `crypto_only`: no rail that charges the listed currency. */
  state: 'nobody' | 'crypto_only';
  reasons: Record<string, string>;
}

/** Active prices on sale that a buyer cannot pay, or can pay only in crypto. */
@Injectable()
export class PayablePricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: PaymentOrchestratorService,
  ) {}

  async unpayable(): Promise<{ checked: number; prices: UnpayablePrice[] }> {
    const [providers, prices] = await Promise.all([
      this.prisma.paymentProvider.findMany({
        where: { isActive: true },
        select: { code: true, currencies: true, config: true },
      }),
      this.prisma.price.findMany({
        where: { isActive: true, product: { isActive: true, type: { not: 'open' } } },
        include: { product: true },
        orderBy: { code: 'asc' },
      }),
    ]);

    const rails: Array<{ provider: (typeof providers)[number]; connector: Connector | null }> =
      providers.map((provider) => {
        let connector: Connector | null = null;
        try {
          connector = this.orchestrator.getAdapter(provider.code) as Connector;
        } catch {
          connector = null;
        }
        return { provider, connector };
      });

    // Listing a rail's methods may read an exchange rate: once per currency.
    const methods = new Map<string, boolean>();
    const hasMethods = async (connector: Connector, rail: string, currency: string) => {
      const key = `${rail}:${currency}`;
      if (!methods.has(key)) {
        const list = connector.listMethods
          ? await connector.listMethods({ currency }).catch(() => [])
          : [];
        methods.set(key, list.length > 0);
      }
      return methods.get(key)!;
    };

    const out: UnpayablePrice[] = [];
    for (const price of prices) {
      if (Number(price.amount) <= 0) continue;
      const currency = price.currency.toUpperCase();
      // A plan is opened as a subscription unless it has no period.
      const mode =
        price.product.type === 'subscription' && price.interval ? 'SUBSCRIPTION' : 'PAYMENT';
      const reasons: Record<string, string> = {};
      const takes: string[] = [];
      for (const { provider, connector } of rails) {
        const caps = connector?.capabilities?.();
        if (!connector || caps?.isClientSide) {
          reasons[provider.code] = connector ? 'app_store_only' : 'no_adapter';
          continue;
        }
        const ticked = provider.currencies.map((c) => c.toUpperCase()).includes(currency);
        const converted = !!caps?.convertsTo?.length && ticked;
        if (caps?.currencies?.length && !caps.currencies.includes(currency) && !converted) {
          reasons[provider.code] = 'currency';
          continue;
        }
        const refused = railRefuses(provider, {
          mode,
          currency,
          productType: price.product.type,
          priceMetadata: price.metadata,
          productMetadata: price.product.metadata,
        });
        if (refused) {
          reasons[provider.code] = refused;
          continue;
        }
        if (caps?.selectableMethods && !(await hasMethods(connector, provider.code, currency))) {
          reasons[provider.code] = 'no_method';
          continue;
        }
        takes.push(provider.code);
      }
      if (takes.some((code) => code !== RAILS.CRYPTO)) continue;
      out.push({
        code: price.code,
        productCode: price.product.code,
        currency,
        amount: price.amount.toString(),
        interval: price.interval,
        mode,
        state: takes.length ? 'crypto_only' : 'nobody',
        reasons,
      });
    }
    return { checked: prices.length, prices: out };
  }
}
