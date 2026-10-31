import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/services/prisma.service';
import { DistributedLockService } from '../common/locks/distributed-lock.service';
import { billingBaseUrl } from '../auth/token-contract';
import { moneyToNumber, toMoney } from '../common/money';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { RAILS } from '../common/connectors/rail';
import { MerchantRailsService } from './merchant-rails.service';
import {
  MerchantRail,
  merchantWebhookPath,
  openCredentials,
  parseCredentials,
  redact,
  sealCredentials,
  secretsOf,
} from './merchant-credentials';

/** Who is acting: a service (its auth client) or a billing admin. */
export interface MerchantActor {
  serviceId: string | null;
  actor: string;
}

const AMOUNT_RE = /^\d{1,15}(?:\.\d{1,4})?$/;

/**
 * Rails with no refund API: lava.top refunds only from its dashboard, and a
 * crypto refund is the merchant sending coins back from its own wallet.
 * Billing records such a refund when the service says it was made.
 */
export const RECORD_ONLY_REFUNDS: ReadonlySet<string> = new Set([RAILS.LAVA, RAILS.CRYPTO]);

/**
 * Merchants a service sells for and their own provider accounts. Every read
 * and write is scoped to the calling service: another service's merchant does
 * not exist (404). Credentials go in sealed and never come out: responses,
 * logs and the audit log carry hints only.
 */
@Injectable()
export class MerchantsService {
  private readonly logger = new Logger(MerchantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly rails: MerchantRailsService,
    private readonly orchestrator: PaymentOrchestratorService,
    private readonly lock: DistributedLockService,
  ) {}

  private webhookUrl(connection: { id: string; rail: string }): string | null {
    // Crypto payments are seen on the chain; there is nothing to send them.
    if (connection.rail === RAILS.CRYPTO) return null;
    return `${billingBaseUrl(this.config)}${merchantWebhookPath(connection.id)}`;
  }

  connectionView(c: any) {
    return {
      id: c.id,
      rail: c.rail,
      status: c.status,
      hints: c.hints ?? {},
      webhookUrl: this.webhookUrl(c),
      verifiedAt: c.verifiedAt ?? null,
      lastError: c.lastError ?? null,
      // null: the merchant's own fee applies. Recorded, never deducted.
      platformFeeBps: c.platformFeeBps ?? null,
      // No refund API on the rail: a refund is made in the provider's own
      // dashboard (lava.top) or wallet (crypto) and only recorded here.
      refunds: RECORD_ONLY_REFUNDS.has(c.rail) ? 'record-only' : 'provider',
    };
  }

  private view(m: any) {
    return {
      id: m.id,
      orgId: m.orgId,
      displayName: m.displayName,
      ...(m.externalRef ? { externalRef: m.externalRef } : {}),
      platformFeeBps: m.platformFeeBps,
      // Not decided by the owner: no fee is taken from any sale today.
      platformFeeApplied: false,
      connections: (m.connections ?? []).map((c: any) => this.connectionView(c)),
    };
  }

  private async audit(
    merchantId: string,
    who: MerchantActor,
    action: string,
    detail: Record<string, unknown> = {},
    connectionId?: string,
  ): Promise<void> {
    await this.prisma.merchantAuditLog.create({
      data: {
        merchantId,
        connectionId: connectionId ?? null,
        serviceId: who.serviceId,
        actor: who.actor.slice(0, 255),
        action,
        detail: detail as any,
      },
    });
  }

  /** The merchant, if it is this service's; 404 otherwise. */
  async owned(serviceId: string, merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      include: { connections: { orderBy: { createdAt: 'asc' } } },
    });
    if (!merchant || merchant.serviceId !== serviceId) {
      throw new NotFoundException('Merchant not found');
    }
    return merchant;
  }

  async create(
    who: MerchantActor & { serviceId: string },
    input: { orgId: string; displayName: string; externalRef?: string },
  ) {
    const existing = await this.prisma.merchant.findUnique({
      where: { serviceId_orgId: { serviceId: who.serviceId, orgId: input.orgId } },
      include: { connections: true },
    });
    if (existing) return this.view(existing);
    try {
      const merchant = await this.prisma.merchant.create({
        data: {
          serviceId: who.serviceId,
          orgId: input.orgId,
          displayName: input.displayName,
          externalRef: input.externalRef ?? null,
        },
        include: { connections: true },
      });
      await this.audit(merchant.id, who, 'merchant.created', { orgId: input.orgId });
      return this.view(merchant);
    } catch (error: any) {
      // Two creates at once: the other one won, and it is the same merchant.
      if (error?.code !== 'P2002') throw error;
      const winner = await this.prisma.merchant.findUnique({
        where: { serviceId_orgId: { serviceId: who.serviceId, orgId: input.orgId } },
        include: { connections: true },
      });
      return this.view(winner);
    }
  }

  async get(serviceId: string, merchantId: string) {
    return this.view(await this.owned(serviceId, merchantId));
  }

  async getByOrg(serviceId: string, orgId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { serviceId_orgId: { serviceId, orgId } },
      include: { connections: { orderBy: { createdAt: 'asc' } } },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    return this.view(merchant);
  }

  /** Store (or replace) a connection's credentials, sealed; it is pending until verified. */
  async putConnection(
    who: MerchantActor & { serviceId: string },
    merchantId: string,
    rail: MerchantRail,
    body: Record<string, unknown>,
  ) {
    await this.owned(who.serviceId, merchantId);
    const { credentials, hints } = parseCredentials(rail, body);
    const existing = await this.prisma.merchantConnection.findUnique({
      where: { merchantId_rail: { merchantId, rail } },
    });
    const id = existing?.id ?? randomUUID();
    const data = {
      status: 'pending' as const,
      sealedCredentials: sealCredentials(id, credentials),
      hints: hints as any,
      verifiedAt: null,
      lastError: null,
    };
    const connection = existing
      ? await this.prisma.merchantConnection.update({ where: { id }, data })
      : await this.prisma.merchantConnection.create({ data: { id, merchantId, rail, ...data } });
    await this.audit(merchantId, who, 'connection.saved', { rail, hints }, id);
    const { verifiedAt: _v, lastError: _l, ...view } = this.connectionView(connection);
    return view;
  }

  /** Prove the account is the merchant's by calling the provider with its credentials. */
  async verify(who: MerchantActor & { serviceId: string }, merchantId: string, rail: MerchantRail) {
    await this.owned(who.serviceId, merchantId);
    const connection = await this.prisma.merchantConnection.findUnique({
      where: { merchantId_rail: { merchantId, rail } },
    });
    if (!connection || connection.status === 'disconnected' || !connection.sealedCredentials) {
      throw new NotFoundException(`No ${rail} account is connected`);
    }
    const credentials = openCredentials(connection.id, connection.sealedCredentials);
    let status: 'verified' | 'failed';
    let lastError: string | null = null;
    let hints = (connection.hints as Record<string, unknown>) ?? {};
    try {
      // Bound as if verified: the call below is the proof.
      const connector = this.rails.bind({ ...connection, status: 'verified' });
      if (!connector.verifyAccount) throw new Error(`${rail} accounts cannot be verified`);
      const result = await connector.verifyAccount();
      hints = { ...hints, ...result.hints };
      status = 'verified';
    } catch (error: any) {
      status = 'failed';
      lastError = redact(error?.message ?? 'Verification failed', secretsOf(credentials));
      this.logger.warn(`Merchant connection ${connection.id} (${rail}) not verified: ${lastError}`);
    }
    // Conditional on the credentials verified being the ones still stored.
    const { count } = await this.prisma.merchantConnection.updateMany({
      where: { id: connection.id, sealedCredentials: connection.sealedCredentials },
      data: {
        status,
        lastError,
        hints: hints as any,
        verifiedAt: status === 'verified' ? new Date() : null,
      },
    });
    if (count !== 1) throw new ConflictException('The credentials changed while being verified');
    await this.audit(merchantId, who, `connection.${status}`, { rail, lastError }, connection.id);
    return this.connectionView(
      await this.prisma.merchantConnection.findUnique({ where: { id: connection.id } }),
    );
  }

  /** Stop using the account and wipe what was sealed for it. */
  async disconnect(
    who: MerchantActor & { serviceId: string },
    merchantId: string,
    rail: MerchantRail,
  ) {
    await this.owned(who.serviceId, merchantId);
    const connection = await this.prisma.merchantConnection.findUnique({
      where: { merchantId_rail: { merchantId, rail } },
    });
    if (!connection) throw new NotFoundException(`No ${rail} account is connected`);
    const updated = await this.prisma.merchantConnection.update({
      where: { id: connection.id },
      data: { status: 'disconnected', sealedCredentials: null, verifiedAt: null },
    });
    await this.audit(merchantId, who, 'connection.disconnected', { rail }, connection.id);
    return this.connectionView(updated);
  }

  /** Set INITE's fee for a merchant: a billing admin only. Shown, deducted by no rail today. */
  async setPlatformFee(who: MerchantActor, merchantId: string, platformFeeBps: number) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    const updated = await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { platformFeeBps },
      include: { connections: true },
    });
    await this.audit(merchantId, who, 'merchant.fee_set', {
      from: merchant.platformFeeBps,
      to: platformFeeBps,
    });
    return this.view(updated);
  }

  /** INITE's fee on one account (null: the merchant's own). A billing admin only; never deducted. */
  async setConnectionPlatformFee(
    who: MerchantActor,
    merchantId: string,
    rail: MerchantRail,
    platformFeeBps: number | null,
  ) {
    const connection = await this.prisma.merchantConnection.findUnique({
      where: { merchantId_rail: { merchantId, rail } },
    });
    if (!connection) throw new NotFoundException(`No ${rail} account is connected`);
    const updated = await this.prisma.merchantConnection.update({
      where: { id: connection.id },
      data: { platformFeeBps },
    });
    await this.audit(
      merchantId,
      who,
      'connection.fee_set',
      { rail, from: connection.platformFeeBps ?? null, to: platformFeeBps },
      connection.id,
    );
    return this.connectionView(updated);
  }

  /**
   * Refund a merchant's order through the merchant's own account, the one it
   * was paid on. A full refund settles the order as refunded through the
   * orchestrator; a partial one leaves it paid. Serialised per order so two
   * requests cannot refund twice.
   */
  async refund(
    who: MerchantActor & { serviceId: string },
    merchantId: string,
    orderId: string,
    input: { amount?: string; reason?: string },
  ) {
    await this.owned(who.serviceId, merchantId);
    let result: Record<string, unknown> | null = null;
    const ran = await this.lock.runWithLock(`merchant-refund:${orderId}`, 120_000, async () => {
      result = await this.refundLocked(who, merchantId, orderId, input);
    });
    if (!ran || !result) throw new ConflictException('A refund of this order is in progress');
    return result;
  }

  private async refundLocked(
    who: MerchantActor & { serviceId: string },
    merchantId: string,
    orderId: string,
    input: { amount?: string; reason?: string },
  ): Promise<Record<string, unknown>> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { paymentIntents: { where: { status: 'paid' }, orderBy: { createdAt: 'desc' } } },
    });
    if (!order || order.merchantId !== merchantId) throw new NotFoundException('Order not found');
    if (order.status !== 'paid') {
      throw new BadRequestException(`The order is ${order.status}, not paid`);
    }
    const intent = order.paymentIntents[0];
    if (!intent?.providerIntentId) throw new BadRequestException('The order has no paid payment');

    const total = toMoney(order.amount);
    const previous = await this.prisma.merchantAuditLog.findMany({
      where: {
        merchantId,
        action: 'order.refunded',
        detail: { path: ['orderId'], equals: orderId },
      },
      select: { detail: true },
    });
    const already = previous.reduce(
      (sum, row) => sum.plus(toMoney(String((row.detail as any)?.amount ?? '0'))),
      toMoney(0),
    );
    const left = total.minus(already);
    if (input.amount !== undefined && !AMOUNT_RE.test(input.amount)) {
      throw new BadRequestException('amount is a decimal string, e.g. "10.50"');
    }
    const amount = input.amount !== undefined ? toMoney(input.amount) : left;
    if (amount.lte(0) || amount.gt(left)) {
      throw new BadRequestException(`A refund is more than 0 and at most ${left.toFixed(2)}`);
    }

    const connectionId = order.merchantConnectionId ?? undefined;
    const recordOnly = RECORD_ONLY_REFUNDS.has(intent.rail);
    let refund: { refunded: boolean; providerRefundId?: string | null } = { refunded: true };
    if (!recordOnly) {
      const { connector, connection } = await this.rails.connectorFor(merchantId, intent.rail);
      if (!connector.capabilities?.().supportsRefund || !connector.refund) {
        throw new UnprocessableEntityException(`${intent.rail} accounts cannot refund`);
      }
      try {
        refund = await connector.refund({
          providerIntentId: intent.providerIntentId,
          amount: moneyToNumber(amount),
          currency: order.currency,
          idempotencyKey: `refund:${order.id}:${already.toFixed(4)}`,
        });
      } catch (error: any) {
        refund = { refunded: false };
        const secrets = connection.sealedCredentials
          ? secretsOf(openCredentials(connection.id, connection.sealedCredentials))
          : [];
        const why = redact(String(error?.message ?? 'error'), secrets);
        this.logger.warn(`Merchant refund of ${orderId} on ${intent.rail} failed: ${why}`);
      }
      if (!refund.refunded) {
        await this.audit(
          merchantId,
          who,
          'order.refund_failed',
          { orderId, amount: amount.toFixed(4), currency: order.currency, rail: intent.rail },
          connectionId,
        );
        throw new BadRequestException('The provider did not accept the refund');
      }
    }

    const full = amount.eq(left);
    await this.audit(
      merchantId,
      who,
      'order.refunded',
      {
        orderId,
        amount: amount.toFixed(4),
        currency: order.currency,
        full,
        providerRefundId: refund.providerRefundId ?? null,
        reason: input.reason?.slice(0, 255) ?? null,
        rail: intent.rail,
        // Made by the merchant in the provider's dashboard or wallet; recorded only.
        recordedOnly: recordOnly,
      },
      connectionId,
    );
    if (full) await this.orchestrator.applyStateTransition(intent.id, 'refunded');
    return {
      orderId,
      status: full ? 'refunded' : 'paid',
      refunded: amount.toFixed(2),
      refundedTotal: already.plus(amount).toFixed(2),
      currency: order.currency,
      providerRefundId: refund.providerRefundId ?? null,
      recordedOnly: recordOnly,
      ...(recordOnly
        ? {
            note: `${intent.rail} has no refund API: billing recorded the refund; the money is returned by the merchant in ${intent.rail === RAILS.LAVA ? 'the lava.top dashboard' : 'its own wallet'}`,
          }
        : {}),
    };
  }
}
