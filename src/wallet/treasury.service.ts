import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Treasury } from '@prisma/client';
import { formatUnits, getAddress, isAddress, parseUnits } from 'viem';
import { PrismaService } from '../common/services/prisma.service';
import { loadCryptoSettings } from '../adapters/crypto/crypto-config';
import { RelayerKeys, newTurnkeyApiKey } from '../adapters/crypto/x402/relayer-key';
import { USDC_ABI, baseClient } from '../adapters/crypto/x402/relayer';
import {
  Authorization,
  DecodedPayment,
  X402_CHAIN,
  X402_NETWORK,
  typedDataPayload,
  usdcAddress,
} from '../adapters/crypto/x402/protocol';
import { Settlements } from '../adapters/crypto/x402/settlements';
import { CheckoutService } from '../checkout/checkout.service';
import { CheckoutMode } from '../common/dto/checkout.dto';
import { agentPolicy } from './agent-limits';
import { TurnkeyWallets } from './turnkey-wallets';
import { joinSignature } from './wallet.service';

const SIGN_RAW_PAYLOAD_PATH = '/public/v1/submit/sign_raw_payload';
const DAY_MS = 24 * 60 * 60 * 1000;
/** The product a card top-up is an order for; one price per amount. */
export const TOPUP_PRODUCT = 'inite-wallet-topup';
export const TOPUP_AMOUNTS = ['10', '25', '50', '100'] as const;
const topupPrice = (amount: string) => `${TOPUP_PRODUCT}-usd-${amount}`;

/**
 * Card top-ups of INITE wallets, paid out of INITE's treasury.
 *
 * A card can't put USDC on an address: the card rails (lava.top, Stripe) pay
 * INITE. So a top-up is an ordinary order for "INITE wallet top-up, $N"; once
 * it is paid, billing sends N USDC from the treasury to the wallet.
 *
 * The treasury is a Turnkey sub-organization made here with a root key that
 * is used for setup and never stored. Setup adds one signer whose policy lets
 * it sign USDC TransferWithAuthorization on Base of at most `perTransfer` and
 * nothing else; billing keeps only that signer's key. Turnkey can't count a
 * day, so billing holds payouts past `dailyLimit` (status "held") for an
 * admin to look at. The treasury holds what the owner sends it, no more.
 */
@Injectable()
export class TreasuryService {
  private readonly logger = new Logger(TreasuryService.name);
  private readonly turnkey = new TurnkeyWallets();
  private readonly keys: RelayerKeys;
  private readonly settlements: Settlements;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly checkout: CheckoutService,
  ) {
    this.keys = new RelayerKeys(prisma);
    this.settlements = new Settlements(prisma);
  }

  current(): Promise<Treasury | null> {
    return this.prisma.treasury.findFirst({ where: { retiredAt: null } });
  }

  async status() {
    const t = await this.current();
    if (!t) return { treasury: null };
    const [balance, sent, recent] = await Promise.all([
      this.balance(t.address as `0x${string}`).catch(() => null),
      this.sentSince(t.id, new Date(Date.now() - DAY_MS)),
      this.prisma.treasuryPayout.findMany({
        where: { treasuryId: t.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      treasury: {
        address: t.address,
        network: X402_NETWORK,
        balance: balance === null ? null : formatUnits(balance, 6),
        perTransfer: t.perTransfer,
        dailyLimit: t.dailyLimit,
        sentLast24h: formatUnits(sent, 6),
        fund: `Send USDC on Base to ${t.address}. Card top-ups are paid out of it.`,
      },
      payouts: recent.map((p) => ({
        orderId: p.orderId,
        to: p.to,
        amount: formatUnits(BigInt(p.valueRaw), 6),
        status: p.status,
        txHash: p.txHash,
        error: p.error,
        at: p.createdAt,
      })),
    };
  }

  /** Make the treasury (once) and the top-up product with its prices. */
  async setUp(input: { perTransfer?: string; dailyLimit?: string } = {}) {
    await this.ensureProduct();
    if (await this.current()) return this.status();
    const settings = await loadCryptoSettings(this.prisma);
    const organizationId = settings?.x402.organizationId;
    const billingKey = await this.keys.current();
    if (!organizationId || !billingKey) {
      throw new ServiceUnavailableException('Set up Turnkey in admin → Crypto first');
    }
    const perTransfer = amount(input.perTransfer ?? '500');
    const dailyLimit = amount(input.dailyLimit ?? '500');

    // A root key for setup only: it never leaves this function.
    const root = newTurnkeyApiKey();
    const signer = newTurnkeyApiKey();
    const opened = await this.turnkey.open(organizationId, billingKey, {
      name: `inite-treasury-${randomUUID()}`,
      ownerKey: root.publicKey,
    });
    const users = await this.turnkey.submitWithKey(
      '/public/v1/submit/create_users',
      JSON.stringify({
        type: 'ACTIVITY_TYPE_CREATE_USERS_V4',
        timestampMs: String(Date.now()),
        organizationId: opened.subOrganizationId,
        parameters: {
          users: [
            {
              userName: 'INITE billing treasury signer',
              apiKeys: [
                {
                  apiKeyName: 'INITE billing',
                  publicKey: signer.publicKey,
                  curveType: 'API_KEY_CURVE_P256',
                },
              ],
              authenticators: [],
              oauthProviders: [],
              userTags: [],
            },
          ],
        },
      }),
      root,
    );
    const turnkeyUserId: string | undefined = (users.createUsersResult ?? users.createUsersResultV4)
      ?.userIds?.[0];
    if (!turnkeyUserId) throw new ServiceUnavailableException('Turnkey made no signer');
    const policy = agentPolicy({ turnkeyUserId, perPayment: perTransfer, name: 'treasury' });
    await this.turnkey.submitWithKey(
      '/public/v1/submit/create_policy',
      JSON.stringify({
        type: 'ACTIVITY_TYPE_CREATE_POLICY_V3',
        timestampMs: String(Date.now()),
        organizationId: opened.subOrganizationId,
        parameters: {
          ...policy,
          policyName: 'INITE treasury: USDC on Base only',
          notes: `Card top-ups of INITE wallets. At most ${perTransfer} USDC a transfer. The root key was discarded after setup.`,
        },
      }),
      root,
    );
    await this.prisma.treasury.create({
      data: {
        subOrganizationId: opened.subOrganizationId,
        address: opened.address,
        turnkeyUserId,
        signerPublicKey: signer.publicKey,
        signerPrivateKey: signer.privateKey,
        perTransfer,
        dailyLimit,
      },
    });
    this.logger.log(`Treasury set up: ${opened.address}`);
    return this.status();
  }

  /** The product "INITE wallet top-up", one USD price per amount; grants nothing. */
  async ensureProduct() {
    const product = await this.prisma.product.upsert({
      where: { code: TOPUP_PRODUCT },
      create: {
        code: TOPUP_PRODUCT,
        name: 'INITE wallet top-up',
        moduleScope: 'wallet',
        type: 'one_time',
        isActive: true,
        metadata: {
          walletTopup: true,
          entitlements: [],
          i18n: {
            ru: { name: 'Пополнение кошелька INITE' },
            pt: { name: 'Recarga da carteira INITE' },
            es: { name: 'Recarga de la billetera INITE' },
          },
        },
      },
      update: {},
    });
    for (const a of TOPUP_AMOUNTS) {
      await this.prisma.price.upsert({
        where: { code: topupPrice(a) },
        create: {
          productId: product.id,
          code: topupPrice(a),
          currency: 'USD',
          amount: Number(a),
          isActive: true,
        },
        update: {},
      });
    }
  }

  /** A person on the fund page pays $N by card for this wallet: the order to pay. */
  async startCardTopup(address: string, amountUsd: string, locale?: string) {
    if (!(TOPUP_AMOUNTS as readonly string[]).includes(amountUsd)) {
      throw new BadRequestException(`A card top-up is ${TOPUP_AMOUNTS.join(', ')} USD`);
    }
    if (!(await this.current())) {
      throw new ServiceUnavailableException('Card top-ups are not available yet');
    }
    if (!isAddress(address, { strict: false })) throw new NotFoundException('Not an INITE wallet');
    const wallet = await this.prisma.wallet.findUnique({ where: { address: getAddress(address) } });
    if (!wallet) throw new NotFoundException('Not an INITE wallet');
    const back = `${(this.config.get<string>('FRONTEND_URL') || 'https://billing.inite.ai').replace(/\/$/, '')}/fund/${wallet.address}`;
    const session = await this.checkout.createSession(wallet.ownerDid, {
      priceCode: topupPrice(amountUsd),
      mode: CheckoutMode.PAYMENT,
      successUrl: back,
      errorUrl: back,
      metadata: { walletTopup: { address: wallet.address } },
      ...(locale ? { locale } : {}),
    } as any);
    return { checkoutUrl: session.checkoutUrl, sessionId: session.sessionId };
  }

  /**
   * Paid card top-ups get their USDC; runs every minute and on demand.
   *
   * Exactly once, whatever crashes or runs twice:
   * - one payout row per order (unique order_id), made under a per-treasury
   *   lock that also counts the daily limit, so two runs can't both pass it;
   * - each attempt's EIP-3009 nonce and expiry are saved before signing;
   * - an attempt that failed or got stuck is retried only when the chain says
   *   its nonce was never used and its authorization has expired: from then
   *   on it can never be executed, so a new attempt can't double the payout.
   *   A used nonce means it was paid: marked mined.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async payOut(): Promise<void> {
    const t = await this.current();
    if (!t) return;
    await this.reconcile(t);
    // Payouts made but never attempted (no relayer at the time).
    for (const p of await this.prisma.treasuryPayout.findMany({
      where: { treasuryId: t.id, status: 'signing', nonce: null },
      take: 20,
    })) {
      await this.attempt(t, p.id);
    }
    const paid = await this.prisma.order.findMany({
      where: {
        status: 'paid',
        price: { product: { code: TOPUP_PRODUCT } },
        createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) },
        // Orders that have no payout yet.
        NOT: {
          id: {
            in: (await this.prisma.treasuryPayout.findMany({ select: { orderId: true } })).map(
              (p) => p.orderId,
            ),
          },
        },
      },
      include: { price: true },
      take: 20,
    });
    for (const order of paid) {
      const to = (order.metadata as any)?.walletTopup?.address;
      if (!to || !isAddress(to, { strict: false })) continue;
      const payout = await this.open(
        t,
        order.id,
        getAddress(to),
        parseUnits(String(order.price.amount), 6),
      );
      if (payout?.status === 'signing') await this.attempt(t, payout.id);
    }
  }

  /**
   * Pay money back to a person's INITE wallet for an order that is not a
   * top-up — a stake released or cancelled (src/commitments). The same rules
   * as a top-up: one payout per order whatever runs twice, the per-transfer
   * policy in Turnkey, the daily limit (over it the payout is held for an
   * admin). Returns null when there is no treasury yet; the caller retries.
   */
  async payOrderToWallet(orderId: string, address: string, amountUsd: string) {
    const t = await this.current();
    if (!t) return null;
    if (!isAddress(address, { strict: false })) throw new BadRequestException('Not an address');
    const existing = await this.prisma.treasuryPayout.findUnique({ where: { orderId } });
    if (existing) return existing;
    const payout = await this.open(t, orderId, getAddress(address), parseUnits(amountUsd, 6));
    if (payout?.status === 'signing') await this.attempt(t, payout.id);
    return this.prisma.treasuryPayout.findUnique({ where: { orderId } });
  }

  /** The payout row for an order, made once, under the treasury lock (daily limit). */
  private async open(t: Treasury, orderId: string, to: `0x${string}`, value: bigint) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${t.id}))`;
        const existing = await tx.treasuryPayout.findUnique({ where: { orderId } });
        if (existing) return null;
        const sent = await this.sentSince(t.id, new Date(Date.now() - DAY_MS), tx);
        const over =
          value > parseUnits(t.perTransfer, 6) || sent + value > parseUnits(t.dailyLimit, 6);
        return tx.treasuryPayout.create({
          data: {
            treasuryId: t.id,
            orderId,
            to,
            valueRaw: value.toString(),
            status: over ? 'held' : 'signing',
            ...(over ? { error: 'Over the treasury limit; an admin sends it by hand' } : {}),
          },
        });
      });
    } catch (error: any) {
      if (error?.code === 'P2002') return null;
      throw error;
    }
  }

  /** One attempt: a fresh nonce saved first, then sign, relay, record. */
  private async attempt(t: Treasury, payoutId: string): Promise<void> {
    const relayer = await this.settlements.relayer();
    if (!relayer) return; // stays "signing" with no nonce: tried next minute
    const now = Math.floor(Date.now() / 1000);
    const nonce = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
    const validBefore = now + 600;
    // Take the attempt: only a payout with no live attempt gets a nonce.
    const taken = await this.prisma.treasuryPayout.updateMany({
      where: { id: payoutId, status: 'signing', nonce: null },
      data: { nonce, validBefore: new Date(validBefore * 1000), attempts: { increment: 1 } },
    });
    if (taken.count === 0) return;
    const payout = await this.prisma.treasuryPayout.findUniqueOrThrow({ where: { id: payoutId } });
    const mark = (data: Record<string, unknown>) =>
      this.prisma.treasuryPayout.update({ where: { id: payoutId }, data });
    const authorization: Authorization = {
      from: t.address as `0x${string}`,
      to: payout.to as `0x${string}`,
      value: BigInt(payout.valueRaw),
      validAfter: 0n,
      validBefore: BigInt(validBefore),
      nonce,
    };
    let hash: `0x${string}` | null = null;
    let claimId: string | null = null;
    try {
      const result = await this.turnkey.submitWithKey(
        SIGN_RAW_PAYLOAD_PATH,
        JSON.stringify({
          type: 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2',
          timestampMs: String(Date.now()),
          organizationId: t.subOrganizationId,
          parameters: {
            signWith: t.address,
            payload: typedDataPayload(authorization),
            encoding: 'PAYLOAD_ENCODING_EIP712',
            hashFunction: 'HASH_FUNCTION_NO_OP',
          },
        }),
        { publicKey: t.signerPublicKey, privateKey: t.signerPrivateKey },
      );
      const payment: DecodedPayment = {
        version: 2,
        scheme: 'exact',
        network: X402_NETWORK,
        asset: usdcAddress(),
        authorization,
        signature: joinSignature(result.signRawPayloadResult),
      };
      await relayer.verify(payment);
      const claim = await this.settlements.claim(payment, {
        orderId: payout.orderId,
        invoiceId: `treasury:${payout.id}:${payout.attempts}`,
      });
      if (!claim.claimed) throw new ConflictException('This authorization is already under way');
      claimId = claim.row.id;
      hash = await this.settlements.submit(relayer, payment, claimId);
      await mark({ status: 'submitted', txHash: hash, error: null });
    } catch (error: any) {
      // Never overwrite a submitted attempt: the reconcile reads the chain.
      if (!hash)
        await mark({ status: 'failed', error: String(error?.message ?? error).slice(0, 500) });
      this.logger.warn(`Top-up payout ${payoutId} attempt failed: ${error?.message}`);
      return;
    }
    try {
      const mined = await this.settlements.confirm(relayer, hash, claimId!);
      if (mined !== null)
        await mark(mined ? { status: 'mined' } : { error: 'Transaction reverted' });
      this.logger.log(
        `Top-up ${payout.orderId}: ${formatUnits(BigInt(payout.valueRaw), 6)} USDC to ${payout.to}, tx ${hash}`,
      );
    } catch (error: any) {
      this.logger.warn(
        `Top-up payout ${payoutId} sent (${hash}), not confirmed yet: ${error?.message}`,
      );
    }
  }

  /**
   * Settle attempts that are not known to be done, from the chain: a used
   * nonce is paid; an unused one whose authorization expired can never be
   * used, so the payout gets a fresh attempt.
   */
  private async reconcile(t: Treasury): Promise<void> {
    const open = await this.prisma.treasuryPayout.findMany({
      where: {
        treasuryId: t.id,
        status: { in: ['signing', 'submitted', 'failed'] },
        nonce: { not: null },
      },
      take: 20,
    });
    if (open.length === 0) return;
    const settings = await loadCryptoSettings(this.prisma);
    const client = baseClient(settings?.rpcUrls[X402_CHAIN]);
    for (const p of open) {
      const used = await client
        .readContract({
          address: usdcAddress(),
          abi: USDC_ABI,
          functionName: 'authorizationState',
          args: [t.address as `0x${string}`, p.nonce as `0x${string}`],
        })
        .catch(() => null);
      if (used === null) continue; // can't tell: leave it
      if (used) {
        await this.prisma.treasuryPayout.update({
          where: { id: p.id },
          data: { status: 'mined', error: null },
        });
        continue;
      }
      // Unused, and past its expiry (with a margin for block time): dead for good.
      if (p.validBefore && p.validBefore.getTime() < Date.now() - 120_000) {
        if (p.attempts >= 5) {
          await this.prisma.treasuryPayout.update({
            where: { id: p.id },
            data: {
              status: 'held',
              error: `Not paid after ${p.attempts} attempts; an admin looks at it`,
            },
          });
          continue;
        }
        const reset = await this.prisma.treasuryPayout.updateMany({
          where: { id: p.id, nonce: p.nonce },
          data: { status: 'signing', nonce: null, validBefore: null, txHash: null },
        });
        if (reset.count === 1) await this.attempt(t, p.id);
      }
    }
  }

  private async sentSince(treasuryId: string, since: Date, db: any = this.prisma): Promise<bigint> {
    const rows = await db.treasuryPayout.findMany({
      where: {
        treasuryId,
        createdAt: { gte: since },
        status: { in: ['signing', 'submitted', 'mined', 'failed'] },
      },
      select: { valueRaw: true },
    });
    return rows.reduce((sum: bigint, r: { valueRaw: string }) => sum + BigInt(r.valueRaw), 0n);
  }

  private async balance(address: `0x${string}`): Promise<bigint> {
    const settings = await loadCryptoSettings(this.prisma);
    return baseClient(settings?.rpcUrls[X402_CHAIN]).readContract({
      address: usdcAddress(),
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [address],
    });
  }
}

function amount(raw: string): string {
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) {
    throw new BadRequestException('Limits are USDC amounts, e.g. "500"');
  }
  return raw;
}
