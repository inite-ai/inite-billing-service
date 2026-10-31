import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../common/services/prisma.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { Connector } from '../common/connectors/connector.interface';
import { toMoney } from '../common/money';
import { merchantSalesInOpenCap, openDailyCap } from './open-product';
import { meetsRailMinimum } from './rail-minimums';

/** Open orders that count against the day's cap: with a provider, or paid. */
const COUNTED = ['open', 'paid'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OpenAuditRow {
  serviceId: string;
  clientId?: string | null;
  productCode: string;
  orderId?: string | null;
  userId: string;
  outcome: 'opened' | 'refused';
  reason?: string | null;
  amount?: Decimal | null;
  currency?: string | null;
  quantity?: number | null;
  title?: string | null;
  ref?: string | null;
  entitlementKey?: string | null;
}

/**
 * The rules an open-product order is held to beyond its own bounds: which
 * rails can take its amount, the selling service's daily volume, and the
 * audit trail. Fixed-price orders never come through here.
 */
@Injectable()
export class OpenSalePolicy {
  private readonly logger = new Logger(OpenSalePolicy.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: PaymentOrchestratorService,
  ) {}

  /**
   * The active rails that can take `amount` in `currency`: the currency rule
   * the checkout page already applies, plus each provider's minimum. A rail
   * whose minimum is above the amount is left out rather than failing at the
   * provider after the buyer picked it.
   */
  async eligibleRails(currency: string, amount: Decimal): Promise<string[]> {
    const cur = currency.toUpperCase();
    const providers = await this.prisma.paymentProvider.findMany({
      where: { isActive: true },
      select: { code: true, currencies: true, config: true, supportedModes: true },
    });
    const out: string[] = [];
    for (const provider of providers) {
      const capabilities = this.capabilities(provider.code);
      const converted =
        !!capabilities?.convertsTo?.length &&
        provider.currencies.map((c) => c.toUpperCase()).includes(cur);
      if (
        capabilities?.currencies?.length &&
        !capabilities.currencies.includes(cur) &&
        !converted
      ) {
        continue;
      }
      if (capabilities && !capabilities.supportedModes.includes('PAYMENT')) continue;
      if (!meetsRailMinimum(amount, capabilities, provider.config, cur)) continue;
      out.push(provider.code);
    }
    return out;
  }

  /** Whether one rail can take this amount (its minimum only; currency is checked elsewhere). */
  async railTakes(rail: string, currency: string, amount: Decimal): Promise<boolean> {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { code: rail },
      select: { config: true },
    });
    return meetsRailMinimum(amount, this.capabilities(rail), provider?.config, currency);
  }

  /**
   * Refuse when this sale would take the service's open volume in the
   * currency over its daily cap. Counted: open-product orders of the service
   * created in the last 24 hours that a buyer has started paying or paid —
   * not sessions merely opened, so a flood of abandoned sessions cannot use
   * up a service's day. Checked when the session is opened and again when a
   * payment starts; two payments starting in the same instant can pass
   * together, so the cap bounds the volume to within one sale of it.
   *
   * A merchant's sale (`merchant: true`) goes to the merchant's own account.
   * Unless `MERCHANT_SALES_IN_OPEN_CAP` is on it is not held to the cap, and
   * merchants' orders are left out of what the cap counts.
   */
  async assertWithinCap(
    service: { id: string; metadata: unknown },
    currency: string,
    amount: Decimal,
    excludeOrderId?: string,
    opts: { merchant?: boolean } = {},
  ): Promise<void> {
    const merchantsCount = merchantSalesInOpenCap();
    if (opts.merchant && !merchantsCount) return;
    const cap = openDailyCap(service.metadata, currency);
    if (!cap) {
      throw new BadRequestException(
        `Open sales in ${currency} have no daily cap set for this service, so none are taken`,
      );
    }
    const sum = await this.prisma.order.aggregate({
      _sum: { amount: true },
      where: {
        currency,
        status: { in: [...COUNTED] },
        createdAt: { gte: new Date(Date.now() - DAY_MS) },
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
        price: { product: { serviceId: service.id, type: 'open' } },
        ...(merchantsCount ? {} : { merchantId: null }),
      },
    });
    const used = toMoney(sum._sum.amount ?? 0);
    if (used.plus(amount).gt(cap)) {
      throw new BadRequestException(
        `This sale would take today's open sales over the service's cap of ${cap.toFixed(2)} ${currency}`,
      );
    }
  }

  /** Write one audit row; never fails the sale it records. */
  async audit(row: OpenAuditRow): Promise<void> {
    try {
      await this.prisma.openSaleAudit.create({
        data: {
          serviceId: row.serviceId,
          clientId: row.clientId ?? null,
          productCode: row.productCode.slice(0, 100),
          orderId: row.orderId ?? null,
          userId: row.userId,
          outcome: row.outcome,
          reason: row.reason ? row.reason.slice(0, 255) : null,
          amount: row.amount ?? null,
          currency: row.currency ?? null,
          quantity: row.quantity ?? null,
          title: row.title ?? null,
          ref: row.ref ?? null,
          entitlementKey: row.entitlementKey ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`Open sale audit not written: ${(e as Error).message}`);
    }
  }

  private capabilities(rail: string) {
    try {
      return (this.orchestrator.getAdapter(rail) as Connector)?.capabilities?.();
    } catch {
      return undefined;
    }
  }
}
