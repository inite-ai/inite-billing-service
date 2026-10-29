import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CommitmentStatus, Product } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../common/services/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { CreditsService } from '../credits/credits.service';
import { CheckoutService } from '../checkout/checkout.service';
import { CheckoutMode } from '../common/dto/checkout.dto';
import { toMoney } from '../common/money';
import { WalletMerchantsService } from '../wallet/wallet-merchants.service';
import { SessionLinksService } from '../service-api/session-links';
import {
  CommitmentError,
  CommitmentPolicy,
  autoReleaseAt,
  checkEndsAt,
  checkVerification,
  quote,
  requirePolicy,
  tierPriceCode,
} from './commitment-policy';
import { Actor } from './commitment-states';
import { CommitmentRefunds } from './commitment-refunds';
import { TransitionDeps, transitionCommitment } from './commitment-transition';
import { commitmentView } from './commitment-view';
import { CreateCommitmentDto } from './commitments.dto';

const HOUR = 3_600_000;
/** An unpaid stake stops counting against the cap after this long. */
const PENDING_COUNTS_MS = 2 * HOUR;

export interface ActorRef {
  actor: Actor;
  actorId?: string | null;
}

/**
 * Commitments for a product: the quote, creation (an order paid through any
 * rail), and the moves a product or an admin may make. The rules are in
 * docs/commitments.md; the state machine and ledger in commitment-states.ts.
 */
@Injectable()
export class CommitmentsService {
  private readonly logger = new Logger(CommitmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly credits: CreditsService,
    private readonly checkout: CheckoutService,
    private readonly merchants: WalletMerchantsService,
    private readonly links: SessionLinksService,
    private readonly refunds: CommitmentRefunds,
  ) {}

  private get deps(): TransitionDeps {
    return { outbox: this.outbox, credits: this.credits };
  }

  /** The stake offer a service sells, by product code. Another service's is "not found". */
  async product(
    serviceId: string,
    productCode: string,
  ): Promise<Product & { policy: CommitmentPolicy }> {
    const product = await this.prisma.product.findUnique({ where: { code: productCode } });
    if (!product || product.serviceId !== serviceId || !product.isActive) {
      throw new NotFoundException(`No stake offer ${productCode}`);
    }
    return { ...product, policy: requirePolicy(product.metadata, productCode) };
  }

  async policy(serviceId: string, productCode: string) {
    const { policy } = await this.product(serviceId, productCode);
    return {
      productCode,
      tiers: policy.tiers,
      feePct: policy.feePct.toString(),
      creditsBonusPct: policy.creditsBonusPct.toString(),
      creditsPerUsd: policy.creditsPerUsd,
      maxActivePerUser: policy.maxActivePerUser.toFixed(2),
      verificationAbove: policy.verificationAbove.toFixed(2),
      autoReleaseDays: policy.autoReleaseDays,
      cancelWindowHours: policy.cancelWindowHours,
      currency: 'USD',
    };
  }

  async quote(serviceId: string, productCode: string, tier: string) {
    const { policy } = await this.product(serviceId, productCode);
    return quote(productCode, policy, tier);
  }

  /** What a person has at stake right now, across every service. */
  async exposure(userId: string, db: any = this.prisma): Promise<Decimal> {
    const rows: Array<{ stakeAmount: Decimal }> = await db.commitment.findMany({
      where: {
        userId,
        OR: [
          { status: { in: ['held', 'disputed'] } },
          {
            status: 'pending_payment',
            createdAt: { gt: new Date(Date.now() - PENDING_COUNTS_MS) },
          },
        ],
      },
      select: { stakeAmount: true },
    });
    return rows.reduce((sum, r) => sum.plus(r.stakeAmount), new Decimal(0));
  }

  async exposureView(serviceId: string, userId: string, productCode = 'break3-stake') {
    const { policy } = await this.product(serviceId, productCode);
    return {
      userId,
      active: (await this.exposure(userId)).toFixed(2),
      max: policy.maxActivePerUser.toFixed(2),
      currency: 'USD',
    };
  }

  async create(serviceId: string, dto: CreateCommitmentDto, idempotencyKey: string) {
    const product = await this.product(serviceId, dto.productCode);
    const q = quote(product.code, product.policy, dto.tier);
    const stake = toMoney(q.stake);
    const fee = toMoney(q.fee);
    checkVerification(product.policy, stake, dto.verification);
    const endsAt = new Date(dto.endsAt);
    checkEndsAt(product.policy, endsAt);
    const charity = await this.prisma.charity.findUnique({ where: { code: dto.charityCode } });
    if (!charity || !charity.isActive) {
      throw new CommitmentError('unknown_charity', `No charity ${dto.charityCode}`);
    }
    const priceCode = tierPriceCode(product.code, dto.tier);
    const price = await this.prisma.price.findUnique({ where: { code: priceCode } });
    if (
      !price ||
      !price.isActive ||
      price.productId !== product.id ||
      !price.amount.equals(stake.plus(fee))
    ) {
      throw new CommitmentError(
        'price_out_of_sync',
        'The stake prices do not match the offer; sync them',
      );
    }

    // The same promise again: an unpaid one gets a fresh link, a void one
    // makes way, anything else is a conflict.
    const existing = await this.prisma.commitment.findUnique({
      where: { serviceId_externalRef: { serviceId, externalRef: dto.externalRef } },
      include: { charity: true },
    });
    if (existing?.status === 'pending_payment' && existing.userId === dto.userId) {
      const links = await this.links.reopen(existing.orderId, dto.locale);
      if (links) return { commitment: commitmentView(existing), quote: q, ...links };
    }
    if (existing && existing.status !== 'void') {
      throw new CommitmentError(
        'invalid_state',
        `This promise already has a ${existing.status} stake`,
      );
    }
    if (existing) {
      await this.prisma.commitment.update({
        where: { id: existing.id },
        data: { externalRef: `${existing.externalRef}#void:${existing.id}` },
      });
    }

    // Cheap refusal before an order exists; the binding check is under the lock below.
    await this.checkCap(dto.userId, stake, product.policy);
    let creditsServiceId: string | null = null;
    if (product.policy.creditsServiceCode) {
      const s = await this.prisma.service.findUnique({
        where: { code: product.policy.creditsServiceCode },
      });
      creditsServiceId = s?.id ?? null;
    }

    const session = await this.checkout.createSession(
      dto.userId,
      {
        priceCode,
        mode: CheckoutMode.PAYMENT,
        successUrl: dto.successUrl,
        errorUrl: dto.errorUrl,
        metadata: { commitment: { externalRef: dto.externalRef } },
        ...(dto.locale ? { locale: dto.locale } : {}),
      } as any,
      `commitment:${serviceId}:${idempotencyKey}`,
      undefined,
      serviceId,
    );

    const row = await this.prisma
      .$transaction(async (tx) => {
        const already = await tx.commitment.findUnique({
          where: { orderId: session.sessionId },
          include: { charity: true },
        });
        if (already) return already;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commitment:${dto.userId}`}))`;
        await this.checkCap(dto.userId, stake, product.policy, tx);
        return tx.commitment.create({
          data: {
            serviceId,
            externalRef: dto.externalRef,
            userId: dto.userId,
            orderId: session.sessionId,
            productCode: product.code,
            priceCode,
            stakeAmount: stake,
            feeAmount: fee,
            currency: 'USD',
            creditsBonusPct: product.policy.creditsBonusPct,
            creditsPerUsd: product.policy.creditsPerUsd,
            creditsServiceId,
            charityId: charity.id,
            verification: { referee: !!dto.verification.referee, proof: !!dto.verification.proof },
            endsAt,
            autoReleaseAt: autoReleaseAt(product.policy, endsAt),
          },
          include: { charity: true },
        });
      })
      .catch(async (error) => {
        // Refused under the lock: the order nobody can pay any more is closed.
        await this.prisma.order
          .updateMany({
            where: { id: session.sessionId, status: 'created' },
            data: { status: 'expired' },
          })
          .catch(() => undefined);
        throw error;
      });

    return {
      commitment: commitmentView(row),
      quote: q,
      ...(await this.links.withX402(session)),
    };
  }

  private async checkCap(
    userId: string,
    stake: Decimal,
    policy: CommitmentPolicy,
    db: any = this.prisma,
  ) {
    const active = await this.exposure(userId, db);
    if (active.plus(stake).gt(policy.maxActivePerUser)) {
      throw new CommitmentError(
        'cap_exceeded',
        `At most ${policy.maxActivePerUser.toFixed(0)} USD at stake at a time; ${active.toFixed(2)} is already`,
      );
    }
  }

  async row(serviceId: string | null, id: string) {
    const row = await this.prisma.commitment.findUnique({
      where: { id },
      include: { charity: true },
    });
    if (!row || (serviceId && row.serviceId !== serviceId))
      throw new NotFoundException('No such commitment');
    return row;
  }

  async view(serviceId: string | null, id: string) {
    const row = await this.row(serviceId, id);
    const payout = await this.prisma.treasuryPayout.findUnique({ where: { orderId: row.orderId } });
    return commitmentView(row, row.payoutState === 'none' ? null : payout);
  }

  async list(serviceId: string, filter: { externalRef?: string; userId?: string }) {
    const rows = await this.prisma.commitment.findMany({
      where: {
        serviceId,
        ...(filter.externalRef ? { externalRef: filter.externalRef } : {}),
        ...(filter.userId ? { userId: filter.userId } : {}),
      },
      include: { charity: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items: rows.map((r) => commitmentView(r)) };
  }

  async adminList(status?: string) {
    const rows = await this.prisma.commitment.findMany({
      where: status ? { status: status as CommitmentStatus } : {},
      include: { charity: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return { items: rows.map((r) => ({ ...commitmentView(r), serviceId: r.serviceId })) };
  }

  async mine(userId: string) {
    const rows = await this.prisma.commitment.findMany({
      where: { userId },
      include: { charity: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items: rows.map((r) => commitmentView(r)) };
  }

  async payFromWallet(serviceId: string, serviceCode: string, id: string, returnTo?: string) {
    const row = await this.row(serviceId, id);
    if (row.status !== 'pending_payment') {
      throw new CommitmentError('invalid_state', `This stake is ${row.status}`);
    }
    return this.merchants.pay({
      ownerDid: row.userId,
      orderId: row.orderId,
      serviceId,
      serviceCode,
      returnTo,
    });
  }

  private move(
    serviceId: string | null,
    id: string,
    to: CommitmentStatus,
    who: ActorRef,
    key: string,
    reason?: string,
    check?: Parameters<typeof transitionCommitment>[2]['check'],
    extra: Partial<Parameters<typeof transitionCommitment>[2]> = {},
  ) {
    return this.row(serviceId, id)
      .then(() =>
        this.prisma.$transaction((tx) =>
          transitionCommitment(tx, this.deps, {
            commitmentId: id,
            to,
            actor: who.actor,
            actorId: who.actorId,
            reason,
            idempotencyKey: key,
            check,
            ...extra,
          }),
        ),
      )
      .then(() => this.view(serviceId, id));
  }

  release(
    serviceId: string | null,
    id: string,
    as: 'money' | 'credits',
    who: ActorRef,
    key: string,
    reason?: string,
  ) {
    return this.move(
      serviceId,
      id,
      as === 'credits' ? 'released_credits' : 'released_money',
      who,
      key,
      reason,
    );
  }

  forfeit(serviceId: string | null, id: string, who: ActorRef, key: string, reason?: string) {
    return this.move(serviceId, id, 'forfeited', who, key, reason, (row) => {
      if (who.actor !== 'admin' && Date.now() < row.endsAt.getTime()) {
        throw new CommitmentError('too_early', 'A stake is forfeited only after the promise ends');
      }
    });
  }

  dispute(
    serviceId: string | null,
    id: string,
    by: string,
    who: ActorRef,
    key: string,
    reason: string,
  ) {
    return this.move(serviceId, id, 'disputed', who, key, `${by}: ${reason}`);
  }

  /** Cancel within the window: back on the card where the rail refunds, else to the wallet. */
  async cancel(serviceId: string | null, id: string, who: ActorRef, key: string, reason?: string) {
    const row = await this.row(serviceId, id);
    if (row.status !== 'held' && !(who.actor === 'admin' && row.status === 'disputed')) {
      if (row.status === 'refunded_on_cancel') return this.view(serviceId, id);
      throw new CommitmentError('invalid_state', `A ${row.status} stake cannot be cancelled`);
    }
    const product = await this.prisma.product.findUnique({ where: { code: row.productCode } });
    const policy = requirePolicy(product?.metadata, row.productCode);
    if (who.actor !== 'admin') {
      const until = new Date(
        (row.heldAt ?? row.createdAt).getTime() + policy.cancelWindowHours * HOUR,
      );
      if (Date.now() > until.getTime() || Date.now() >= row.endsAt.getTime()) {
        throw new CommitmentError('cancel_window_closed', 'The cancel window has closed');
      }
      const recent = await this.prisma.commitmentTransition.count({
        where: {
          toStatus: 'refunded_on_cancel',
          createdAt: { gt: new Date(Date.now() - 30 * 24 * HOUR) },
          commitment: { userId: row.userId },
        },
      });
      if (recent >= policy.cancelsPer30Days) {
        throw new CommitmentError('cancel_limit', 'Too many cancelled stakes in 30 days');
      }
    }
    const route = await this.refunds.refundOnCard(row);
    return this.move(serviceId, id, 'refunded_on_cancel', who, key, reason, undefined, {
      cancelRoute: route,
    });
  }

  /** Admin: settle a row any allowed way (disputes), with a reason. */
  override(id: string, to: CommitmentStatus, adminId: string, key: string, reason: string) {
    const who: ActorRef = { actor: 'admin', actorId: adminId };
    if (to === 'refunded_on_cancel') return this.cancel(null, id, who, key, reason);
    return this.move(null, id, to, who, key, reason);
  }
}
