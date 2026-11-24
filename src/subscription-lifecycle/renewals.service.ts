import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/services/prisma.service';
import { resolveFrontendUrl } from '../common/config/frontend-url';
import { DistributedLockService } from '../common/locks/distributed-lock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserContactService } from '../notifications/user-contact.service';
import { renewalAmount, renewalCopy, renewalLocale } from './renewal-copy';
import { ReminderStep, accessEnds, reminderStep } from './renewal-reminders';
import { WalletMerchantsService } from '../wallet/wallet-merchants.service';
import { SessionLinksService } from '../service-api/session-links';
import { RENEWAL_KEY, renewedByBilling } from '../payment-orchestrator/subscription-changes';
import { renewalLeadDays, renewalsEnabled } from './renewals-config';

/** Wallet charges tried for one renewal before the person is asked to pay. */
const MAX_TRIES = 3;

const CLOSED: ReadonlySet<string> = new Set(['expired', 'failed']);

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
 * Letters: when the order opens, on the day the period ends, half way through
 * the grace days and a day before they run out, each once, in the person's
 * language. Their links all keep working until the renewal is paid or closed.
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
      // The wallet pays on the day the period ends, not days ahead of it; a
      // renewal already handed to the link stays with the link.
      if (!periodOver) return;
      if (metadata.renewalNotifiedAt) {
        await this.remind(sub, order, now);
        return;
      }
      // What the last charge did is read back, not remembered: a mark written
      // before the charge made a crash look like an attempt, and neither a
      // retry nor the link followed.
      const state = await this.merchants.chargeState(order.id, now);
      if (state === 'pending') return;
      const tries = Number(metadata.walletTries ?? (metadata.walletAttemptedAt ? MAX_TRIES : 0));
      if (tries >= MAX_TRIES) {
        await this.remind(sub, order, now);
        return;
      }
      await this.patchOrder(order, { walletTries: tries + 1 });
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
        this.logger.warn(`Wallet renewal of ${sub.id} failed: ${error?.message}`);
        // It may have left the wallet, or may be worth another try later.
        if (tries + 1 < MAX_TRIES) return;
      }
      await this.remind(sub, order, now);
      return;
    }

    await this.remind(sub, order, now);
  }

  /** The open order for the period that ends next, made once per period. */
  private async renewalOrder(sub: any) {
    const periodEnd = new Date(sub.currentPeriodEnd).toISOString();
    if (sub.renewalOrderId) {
      const existing = await this.prisma.order.findUnique({ where: { id: sub.renewalOrderId } });
      const meta = (existing?.metadata as Record<string, any>)?.[RENEWAL_KEY];
      if (existing && meta?.periodEnd === periodEnd) return this.payable(existing);
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

    // A renewal closed by a plan change is not the next one: that is a new
    // order of the same period, at the new plan's price.
    const base = `billing_renewal_${sub.id}_${periodEnd}`;
    let externalId = base;
    let order = await this.prisma.order.findUnique({ where: { externalId } });
    for (let n = 2; order && CLOSED.has(order.status) && n < 20; n++) {
      externalId = `${base}_r${n}`;
      order = await this.prisma.order.findUnique({ where: { externalId } });
    }
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

  /**
   * An expired attempt used to end the renewal it was for. Such an order, still
   * the subscription's own for this period, is put back; one a plan change
   * closed is no longer the subscription's.
   */
  private async payable(order: any) {
    if (!CLOSED.has(order.status)) return order;
    await this.prisma.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: 'created' },
    });
    return { ...order, status: 'created' };
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

  /**
   * The letter due now, once. The step is claimed on the order before it is
   * sent, in one statement, so two sweeps cannot send it twice; a letter that
   * could not be made gives its claim back.
   */
  private async remind(sub: any, order: any, now: Date): Promise<void> {
    const step = reminderStep(sub, now);
    if (!step || !(await this.claimStep(order.id, step))) return;
    try {
      await this.sendLink(sub, order, step);
    } catch (error) {
      await this.prisma.$executeRaw`
        UPDATE billing.orders SET metadata = metadata #- ARRAY['renewalReminders', ${step}::text]
         WHERE id = ${order.id}::uuid
      `;
      throw error;
    }
  }

  private async claimStep(orderId: string, step: ReminderStep): Promise<boolean> {
    const claimed = await this.prisma.$executeRaw`
      UPDATE billing.orders
         SET metadata = jsonb_set(
               jsonb_set(COALESCE(metadata, '{}'::jsonb), '{renewalReminders}',
                         COALESCE(metadata->'renewalReminders', '{}'::jsonb)),
               ARRAY['renewalReminders', ${step}::text], to_jsonb(now()))
       WHERE id = ${orderId}::uuid AND status = 'created'
         AND metadata #> ARRAY['renewalReminders', ${step}::text] IS NULL
         AND NOT (${step}::text = 'lead' AND metadata ? 'renewalNotifiedAt')
    `;
    return claimed === 1;
  }

  private async sendLink(sub: any, order: any, step: ReminderStep): Promise<void> {
    const contact = await this.contacts.getContact(sub.userId);
    const locale = renewalLocale(contact?.locale);
    const links = await this.links.reopen(order.id, locale);
    if (!links) return;
    const product = sub.price.product;
    const copy = renewalCopy(step, locale, {
      product: product.name,
      amount: renewalAmount(String(order.amount), order.currency, locale),
      periodEnd: new Date(sub.currentPeriodEnd),
      lastDay: accessEnds(sub),
      buyerConfirms: !(await this.walletAllows(sub.userId, product.service?.id)),
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
        locale,
        step,
      },
    });
    await this.patchOrder(order, { renewalNotifiedAt: new Date().toISOString() });
    this.logger.log(`Renewal letter "${step}" for subscription ${sub.id} (order ${order.id})`);
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
