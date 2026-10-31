import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/services/prisma.service';
import { resolveFrontendUrl } from '../common/config/frontend-url';
import { DistributedLockService } from '../common/locks/distributed-lock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserContactService } from '../notifications/user-contact.service';
import { templateCopy, TemplateLocale } from '../notifications/templates';
import { WalletMerchantsService } from '../wallet/wallet-merchants.service';
import { SessionLinksService } from '../service-api/session-links';
import { RENEWAL_KEY, renewedByBilling } from '../payment-orchestrator/subscription-changes';
import { renewalLeadDays, renewalsEnabled } from './renewals-config';

const LIVE = ['trialing', 'active', 'past_due'] as const;

/**
 * Renewal of subscriptions on rails that cannot recur by themselves: PIX
 * (Hodle), crypto, and the INITE wallet, which pays as crypto (owner,
 * 30.10.2026).
 *
 * - **Wallet.** A person who allowed the service to charge their INITE
 *   wallet (`WalletMerchant`) is charged at the end of the period, within
 *   the limits they set. Only when the wallet refuses (no allowance, over
 *   the limit, not enough USDC) are they sent the link.
 * - **PIX and crypto.** `renewalLeadDays` before the period ends, billing
 *   opens the next period's order and mails its pay link.
 *
 * Paid: the orchestrator advances the period (`applyRenewalPayment`). Not
 * paid by the end of the period: the expirer moves the subscription to
 * `past_due`, the link keeps working through the price's grace days, then
 * the subscription ends and its entitlements go. Off unless
 * SUBSCRIPTION_RENEWALS_ENABLED=true; while off, such a subscription ends
 * with its period, as it always has.
 */
@Injectable()
export class SubscriptionRenewalsService {
  private readonly logger = new Logger(SubscriptionRenewalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: DistributedLockService,
    private readonly notifications: NotificationsService,
    private readonly contacts: UserContactService,
    private readonly merchants: WalletMerchantsService,
    private readonly links: SessionLinksService,
    private readonly config: ConfigService,
  ) {}

  @Cron('30 * * * *')
  async sweep(): Promise<void> {
    if (!renewalsEnabled()) return;
    await this.lock.runWithLock('subscription-renewals', 10 * 60_000, () =>
      this.runSweep(new Date()),
    );
  }

  async runSweep(now: Date): Promise<void> {
    const horizon = new Date(now.getTime() + renewalLeadDays() * 86_400_000);
    const due = await this.prisma.subscription.findMany({
      where: {
        status: { in: [...LIVE] },
        cancelAtPeriodEnd: false,
        providerSubscriptionId: null,
        rail: { not: null },
        currentPeriodEnd: { lte: horizon },
      },
      include: { price: { include: { product: { include: { service: true } } } } },
    });
    for (const sub of due) {
      if (!renewedByBilling(sub)) continue;
      try {
        await this.renewOne(sub, now);
      } catch (error: any) {
        this.logger.error(`Renewal of subscription ${sub.id} failed: ${error?.message}`);
      }
    }
  }

  private async renewOne(sub: any, now: Date): Promise<void> {
    const order = await this.renewalOrder(sub);
    if (!order || order.status !== 'created') return;

    const service = sub.price.product.service;
    const metadata = (order.metadata as Record<string, any>) ?? {};
    const periodOver = new Date(sub.currentPeriodEnd).getTime() <= now.getTime();

    if (await this.walletAllows(sub.userId, service?.id)) {
      // The wallet pays on the day the period ends, not days ahead of it.
      if (!periodOver || metadata.walletAttemptedAt) return;
      await this.patchOrder(order, { walletAttemptedAt: now.toISOString() });
      try {
        const result = await this.merchants.pay({
          ownerDid: sub.userId,
          orderId: order.id,
          serviceId: service.id,
          serviceCode: service.code,
        });
        if (result.status !== 'needs_approval') {
          this.logger.log(
            `Subscription ${sub.id} renewal charged to the wallet (${result.status})`,
          );
          return;
        }
        this.logger.log(`Wallet refused renewal of ${sub.id} (${result.reason}); sending the link`);
      } catch (error: any) {
        this.logger.warn(
          `Wallet renewal of ${sub.id} failed (${error?.message}); sending the link`,
        );
      }
      await this.sendLink(sub, order);
      return;
    }

    if (!metadata.renewalNotifiedAt) await this.sendLink(sub, order);
  }

  /** The open order for the period that ends next, made once per period. */
  private async renewalOrder(sub: any) {
    const periodEnd = new Date(sub.currentPeriodEnd).toISOString();
    if (sub.renewalOrderId) {
      const existing = await this.prisma.order.findUnique({ where: { id: sub.renewalOrderId } });
      const meta = (existing?.metadata as Record<string, any>)?.[RENEWAL_KEY];
      if (existing && meta?.periodEnd === periodEnd) return existing;
    }

    const price = sub.pendingPriceId
      ? await this.prisma.price.findUnique({
          where: { id: sub.pendingPriceId },
          include: { product: true },
        })
      : sub.price;
    if (!price?.isActive || !price.product?.isActive) {
      this.logger.warn(
        `Subscription ${sub.id}: its next price is no longer sold — no renewal opened, it ends with its grace`,
      );
      return null;
    }

    const externalId = `billing_renewal_${sub.id}_${periodEnd}`;
    let order = await this.prisma.order.findUnique({ where: { externalId } });
    if (!order) {
      const portal = this.portalUrl(sub.price.product.service?.code);
      order = await this.prisma.order
        .create({
          data: {
            userId: sub.userId,
            priceId: price.id,
            // A one-off payment to the rail; a renewal to us (subscription-changes.ts).
            mode: 'PAYMENT',
            status: 'created',
            amount: price.amount,
            currency: price.currency,
            externalId,
            snapshot: {
              priceCode: price.code,
              priceAmount: price.amount.toString(),
              currency: price.currency,
              interval: price.interval ?? null,
              productCode: price.product.code,
              productName: price.product.name,
              productType: price.product.type,
              serviceId: price.product.serviceId ?? null,
              renewal: true,
              capturedAt: new Date().toISOString(),
            },
            metadata: {
              [RENEWAL_KEY]: { subscriptionId: sub.id, periodEnd },
              successUrl: portal,
              errorUrl: portal,
            },
          },
        })
        .catch(async (error: any) => {
          // Two sweeps at once: the other one made it.
          if (error?.code === 'P2002')
            return this.prisma.order.findUnique({ where: { externalId } });
          throw error;
        });
    }
    if (order && sub.renewalOrderId !== order.id) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { renewalOrderId: order.id },
      });
    }
    return order;
  }

  private async walletAllows(userId: string, serviceId?: string): Promise<boolean> {
    if (!serviceId || !userId.startsWith('did:')) return false;
    const wallet = await this.prisma.wallet.findUnique({ where: { ownerDid: userId } });
    if (!wallet || wallet.ownerKey) return false;
    const merchant = await this.prisma.walletMerchant.findFirst({
      where: { walletId: wallet.id, serviceId, revokedAt: null },
    });
    return !!merchant;
  }

  private async sendLink(sub: any, order: any): Promise<void> {
    const links = await this.links.reopen(order.id);
    if (!links) return;
    const contact = await this.contacts.getContact(sub.userId);
    const locale: TemplateLocale = contact?.locale === 'ru' ? 'ru' : 'en';
    const product = sub.price.product;
    const copy = templateCopy('renewal_due', locale, {
      productName: product.name,
      serviceName: product.service?.name,
      amount: String(order.amount),
      currency: order.currency,
      periodEnd: new Date(sub.currentPeriodEnd).toISOString().slice(0, 10),
    });
    await this.notifications.notify({
      userId: sub.userId,
      // Transactional: the person keeps a plan they are paying for.
      type: 'dunning',
      channels: ['email', 'in_app'],
      title: copy.subject,
      body: copy.body,
      metadata: {
        ctaUrl: links.checkoutUrl,
        ctaLabel: copy.ctaLabel,
        subscriptionId: sub.id,
        orderId: order.id,
      },
    });
    await this.patchOrder(order, { renewalNotifiedAt: new Date().toISOString() });
    this.logger.log(`Renewal link sent for subscription ${sub.id} (order ${order.id})`);
  }

  private async patchOrder(order: any, patch: Record<string, unknown>): Promise<void> {
    const fresh = await this.prisma.order.findUnique({ where: { id: order.id } });
    await this.prisma.order.update({
      where: { id: order.id },
      data: { metadata: { ...((fresh?.metadata as object) ?? {}), ...patch } as any },
    });
  }

  private portalUrl(serviceCode?: string): string {
    const base = resolveFrontendUrl(this.config).replace(/\/+$/, '');
    return serviceCode
      ? `${base}/subscriptions?service=${encodeURIComponent(serviceCode)}`
      : `${base}/subscriptions`;
  }
}
