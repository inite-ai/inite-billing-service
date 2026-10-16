import { selfAgentId } from './self-agent';
import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Wallet, WalletAgent, WalletMerchant } from '@prisma/client';
import { formatUnits } from 'viem';
import { PrismaService } from '../common/services/prisma.service';
import { CheckoutService } from '../checkout/checkout.service';
import {
  Authorization,
  DecodedPayment,
  X402Error,
  X402_CHAIN,
  X402_NETWORK,
  X402_TOKEN,
  usdcAddress,
} from '../adapters/crypto/x402/protocol';
import { Settlements } from '../adapters/crypto/x402/settlements';
import { CHECKOUT_MAX_PAYMENT, usdc } from './agent-limits';
import { AgentPaymentsService } from './agent-payments.service';
import { WalletAgentsService, startOfMonth } from './wallet-agents.service';

const PAID = ['paid', 'completed', 'fulfilled'];
const AMOUNT = /^\d{1,5}(\.\d{1,2})?$/;

export type NeedsReason = 'no_wallet' | 'not_approved' | 'over_limit' | 'insufficient_funds';

export type PayFromWalletResult =
  | { status: 'paid' | 'confirming'; orderId: string; txHash: string | null }
  | { status: 'needs_approval'; reason: NeedsReason; approveUrl: string };

/**
 * Sites charging a person's INITE wallet for their own checkout sessions.
 *
 * The person allows a site once, on a page in their INITE ID account: a
 * limit per payment and per month. The first time any site is allowed, the
 * wallet gets an "INITE checkout" Turnkey user whose policy can sign USDC
 * transfers to INITE billing's receiving wallet and nothing else (two passkey
 * stamps). From then on the site asks billing to pay its session; billing
 * checks the session is the site's and the person's, keeps within the site's
 * limits, signs the invoice's exact amount with the checkout user and puts it
 * on chain through the relayer. The order then completes like any crypto
 * payment.
 */
@Injectable()
export class WalletMerchantsService {
  private readonly logger = new Logger(WalletMerchantsService.name);
  private readonly settlements: Settlements;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: WalletAgentsService,
    private readonly payments: AgentPaymentsService,
    private readonly checkout: CheckoutService,
    private readonly config: ConfigService,
  ) {
    this.settlements = new Settlements(prisma);
  }

  /** The page in INITE ID where the person allows the site (and pays this session). */
  approveUrl(serviceCode: string, sessionId?: string, returnTo?: string): string {
    const base = this.config.get<string>('AUTH_SERVICE_URL') || 'https://auth.inite.ai';
    const url = new URL('/account/wallet/approve', base);
    url.searchParams.set('service', serviceCode);
    if (sessionId) url.searchParams.set('session', sessionId);
    if (returnTo && /^https:\/\//.test(returnTo)) url.searchParams.set('returnTo', returnTo);
    return url.toString();
  }

  /** Everything the approve page shows: the site, the session, the wallet and its permission. */
  async preview(ownerDid: string, serviceCode: string, sessionId?: string) {
    const service = await this.service(serviceCode);
    const wallet = await this.prisma.wallet.findUnique({ where: { ownerDid } });
    const checkoutUser = wallet
      ? await this.prisma.walletAgent.findFirst({
          where: { walletId: wallet.id, kind: 'checkout' },
        })
      : null;
    const merchant = wallet ? await this.merchant(wallet.id, service.id) : null;
    let session: Record<string, unknown> | null = null;
    if (sessionId) {
      const order = await this.order(sessionId, service.id, ownerDid).catch(() => null);
      if (order) {
        session = {
          id: order.id,
          product: order.price.product.name,
          amount: String(order.amount),
          currency: order.price.currency,
          status: PAID.includes(order.status) ? 'paid' : order.status,
        };
      }
    }
    const balance = wallet
      ? await this.payments.usdcBalance(wallet.address as `0x${string}`).catch(() => null)
      : null;
    return {
      service: { code: service.code, name: service.name },
      wallet: wallet
        ? {
            address: wallet.address,
            balance: balance === null ? null : formatUnits(balance, 6),
            credentialId: wallet.credentialId,
          }
        : null,
      checkout: checkoutUser?.status ?? 'none',
      allowed: merchant
        ? {
            perPayment: merchant.perPayment,
            monthly: merchant.monthly,
            spentThisMonth: formatUnits(await this.spentThisMonth(wallet!, service.id), 6),
          }
        : null,
      session,
      maxPerPayment: CHECKOUT_MAX_PAYMENT,
    };
  }

  /** The sites the person allowed. */
  async list(ownerDid: string) {
    const wallet = await this.agents.walletOf(ownerDid);
    const rows = await this.prisma.walletMerchant.findMany({
      where: { walletId: wallet.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const services = await this.prisma.service.findMany({
      where: { id: { in: rows.map((r) => r.serviceId) } },
      select: { id: true, code: true, name: true },
    });
    return Promise.all(
      rows.map(async (row) => {
        const service = services.find((s) => s.id === row.serviceId);
        return {
          service: service ? { code: service.code, name: service.name } : null,
          perPayment: row.perPayment,
          monthly: row.monthly,
          spentThisMonth: formatUnits(await this.spentThisMonth(wallet, row.serviceId), 6),
          since: row.createdAt,
        };
      }),
    );
  }

  /** Let a site charge the wallet, up to these limits. */
  async allow(
    ownerDid: string,
    serviceCode: string,
    input: { perPayment: string; monthly: string },
  ) {
    const wallet = await this.agents.walletOf(ownerDid);
    const service = await this.service(serviceCode);
    const perPayment = amount(input.perPayment, Number(CHECKOUT_MAX_PAYMENT), 'perPayment');
    const monthly = amount(input.monthly, 10_000, 'monthly');
    if (Number(perPayment) > Number(monthly)) {
      throw new BadRequestException('The limit per payment cannot be above the month');
    }
    await this.prisma.walletMerchant.upsert({
      where: { walletId_serviceId: { walletId: wallet.id, serviceId: service.id } },
      create: { walletId: wallet.id, serviceId: service.id, perPayment, monthly },
      update: { perPayment, monthly, revokedAt: null },
    });
    return this.preview(ownerDid, serviceCode);
  }

  async revoke(ownerDid: string, serviceCode: string) {
    const wallet = await this.agents.walletOf(ownerDid);
    const service = await this.service(serviceCode);
    await this.prisma.walletMerchant.updateMany({
      where: { walletId: wallet.id, serviceId: service.id },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  /** Start (or continue) making the wallet's "INITE checkout" user: the next request for the passkey. */
  async prepareCheckout(ownerDid: string) {
    const wallet = await this.agents.walletOf(ownerDid);
    const row = await this.agents.checkoutOf(wallet);
    if (row.status === 'active') return { step: 'done' };
    return this.agents.prepareApproval(ownerDid, row.id, {});
  }

  async confirmCheckout(ownerDid: string, stamp: string) {
    const wallet = await this.agents.walletOf(ownerDid);
    const row = await this.agents.checkoutOf(wallet);
    return this.agents.confirmApproval(ownerDid, row.id, stamp);
  }

  /** The person pays a session from the approve page. */
  async payAsPerson(ownerDid: string, serviceCode: string, sessionId: string) {
    const service = await this.service(serviceCode);
    return this.pay({ ownerDid, orderId: sessionId, serviceId: service.id, serviceCode });
  }

  /**
   * Pay a checkout session from the person's wallet, if they allowed the site
   * and it fits the site's limits. Otherwise say what the person must do.
   * Throws NotFound when the session is not this site's and this person's,
   * or when wallet payments are not available at all.
   */
  async pay(input: {
    ownerDid: string;
    orderId: string;
    serviceId: string;
    serviceCode: string;
    returnTo?: string;
  }): Promise<PayFromWalletResult> {
    const order = await this.order(input.orderId, input.serviceId, input.ownerDid);
    if (PAID.includes(order.status)) return { status: 'paid', orderId: order.id, txHash: null };
    if (order.status !== 'created') throw new ConflictException(`The order is ${order.status}`);
    const relayer = await this.settlements.relayer();
    if (!relayer) throw new NotFoundException('Paying from INITE wallets is not available');

    const needs = (reason: NeedsReason): PayFromWalletResult => ({
      status: 'needs_approval',
      reason,
      approveUrl: this.approveUrl(input.serviceCode, order.id, input.returnTo),
    });
    const wallet = await this.prisma.wallet.findUnique({ where: { ownerDid: input.ownerDid } });
    // An agent with its own wallet signs every payment itself: no site can
    // charge it, and no person approves it. It pays the session's x402Url
    // through /v1/agent-wallet; the site falls back to that (404 = not here).
    const issuer = process.env.JWT_ISSUER || 'https://auth-api.inite.ai';
    if (wallet?.ownerKey || selfAgentId(input.ownerDid, issuer)) {
      throw new NotFoundException(
        'An agent with its own wallet pays by x402 itself (/v1/agent-wallet)',
      );
    }
    if (!wallet) return needs('no_wallet');
    const checkoutUser = await this.prisma.walletAgent.findFirst({
      where: { walletId: wallet.id, kind: 'checkout', status: 'active' },
    });
    const merchant = await this.merchant(wallet.id, input.serviceId);
    if (!checkoutUser || !merchant) return needs('not_approved');

    // The session's invoice on Base: the live one, or a new one.
    const opened: Record<string, any> = await this.checkout.paySession(order.id, input.ownerDid, {
      rail: 'CRYPTO',
      cryptoChain: X402_CHAIN,
      cryptoToken: X402_TOKEN,
    });
    const invoice = opened.payment;
    if (!invoice || invoice.chain !== X402_CHAIN || invoice.token !== X402_TOKEN) {
      throw new ConflictException('This order is being paid another way');
    }
    if (invoice.txHash) return { status: 'confirming', orderId: order.id, txHash: invoice.txHash };
    const value = BigInt(invoice.amountRaw);
    if (value > usdc(merchant.perPayment)) return needs('over_limit');
    const balance = await this.payments.usdcBalance(wallet.address as `0x${string}`);
    if (balance < value) return needs('insufficient_funds');

    const now = Math.floor(Date.now() / 1000);
    const expires = Math.floor(new Date(invoice.expiresAt).getTime() / 1000);
    const authorization: Authorization = {
      from: wallet.address as `0x${string}`,
      to: invoice.address as `0x${string}`,
      value,
      validAfter: BigInt(now - 60),
      validBefore: BigInt(Math.max(now + 120, Math.min(expires, now + 3600))),
      nonce: `0x${randomBytes(32).toString('hex')}`,
    };

    const reserved = await this.reserve(wallet, checkoutUser, merchant, {
      orderId: order.id,
      authorization,
      url: `inite-checkout:${input.serviceCode}/${order.id}`,
      description: order.price.product.name,
    });
    if (!reserved) return needs('over_limit');

    let txHash: `0x${string}`;
    try {
      const signature = await this.payments.sign(wallet, checkoutUser, authorization);
      const payment: DecodedPayment = {
        version: 2,
        scheme: 'exact',
        network: X402_NETWORK,
        asset: usdcAddress(),
        authorization,
        signature,
      };
      await relayer.verify(payment);
      const claim = await this.settlements.claim(payment, {
        orderId: order.id,
        invoiceId: String(invoice.invoiceId),
      });
      if (!claim.claimed) throw new ConflictException('This payment is already under way');
      txHash = await this.settlements.submit(relayer, payment, claim.row.id);
      void this.settlements.confirm(relayer, txHash, claim.row.id).catch(() => undefined);
    } catch (error: any) {
      await this.prisma.walletAgentPayment
        .update({
          where: { id: reserved.id },
          data: { status: 'failed', error: String(error?.message ?? error) },
        })
        .catch(() => undefined);
      this.logger.warn(`Wallet payment for order ${order.id} failed: ${error?.message}`);
      if (error instanceof X402Error) throw new ConflictException(error.message);
      throw error;
    }
    await this.prisma.walletAgentPayment.update({
      where: { id: reserved.id },
      data: { status: 'paid', txHash },
    });
    this.logger.log(`Order ${order.id} paid from wallet ${wallet.address}: ${txHash}`);
    return { status: 'confirming', orderId: order.id, txHash };
  }

  /** Record the payment under a per-wallet-and-site lock, so two at once cannot both fit the month. */
  private async reserve(
    wallet: Wallet,
    checkoutUser: WalletAgent,
    merchant: WalletMerchant,
    input: { orderId: string; authorization: Authorization; url: string; description: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${wallet.id + merchant.serviceId}))`;
      const spent = await this.spentThisMonth(wallet, merchant.serviceId);
      if (spent + input.authorization.value > usdc(merchant.monthly)) return null;
      return tx.walletAgentPayment.create({
        data: {
          agentId: checkoutUser.id,
          serviceId: merchant.serviceId,
          orderId: input.orderId,
          url: input.url,
          merchant: input.url.split('/')[0]!,
          payTo: input.authorization.to,
          valueRaw: input.authorization.value.toString(),
          nonce: input.authorization.nonce,
          validBefore: new Date(Number(input.authorization.validBefore) * 1000),
          description: input.description.slice(0, 500),
        },
      });
    });
  }

  private async spentThisMonth(wallet: Wallet, serviceId: string): Promise<bigint> {
    const rows = await this.prisma.walletAgentPayment.findMany({
      where: {
        serviceId,
        agent: { walletId: wallet.id },
        createdAt: { gte: startOfMonth() },
        status: { in: ['signing', 'paid'] },
      },
      select: { valueRaw: true },
    });
    return rows.reduce((sum, row) => sum + BigInt(row.valueRaw), 0n);
  }

  private merchant(walletId: string, serviceId: string) {
    return this.prisma.walletMerchant.findFirst({
      where: { walletId, serviceId, revokedAt: null },
    });
  }

  private async service(code: string) {
    const service = await this.prisma.service.findUnique({ where: { code } });
    if (!service || !service.isActive) throw new NotFoundException('No such site');
    return service;
  }

  /** The session, if it is this site's and this person's. */
  private async order(orderId: string, serviceId: string, ownerDid: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { price: { include: { product: true } } },
    });
    if (!order || order.price.product.serviceId !== serviceId || order.userId !== ownerDid) {
      throw new NotFoundException('Checkout session not found');
    }
    return order;
  }
}

function amount(value: unknown, max: number, field: string): string {
  const text = String(value ?? '').trim();
  if (!AMOUNT.test(text) || Number(text) <= 0 || Number(text) > max) {
    throw new BadRequestException(`${field} must be more than 0 and at most ${max} dollars`);
  }
  return String(Number(text));
}
