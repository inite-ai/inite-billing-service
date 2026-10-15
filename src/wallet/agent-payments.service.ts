import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Wallet, WalletAgent } from '@prisma/client';
import { formatUnits, parseUnits } from 'viem';
import { PrismaService } from '../common/services/prisma.service';
import { loadCryptoSettings } from '../adapters/crypto/crypto-config';
import { USDC_ABI, baseClient } from '../adapters/crypto/x402/relayer';
import {
  Authorization,
  X402_CHAIN,
  typedDataPayload,
  usdcAddress,
} from '../adapters/crypto/x402/protocol';
import { AgentLimits, usdc } from './agent-limits';
import { AgentContext, WalletAgentsService, dayAgo, startOfMonth } from './wallet-agents.service';
import { TurnkeyWallets } from './turnkey-wallets';
import { joinSignature } from './wallet.service';
import {
  PaymentTerms,
  X402ClientError,
  callSeller,
  checkSellerUrl,
  paymentHeader,
  readTerms,
  settledTransaction,
} from './x402-client';

const SIGN_RAW_PAYLOAD_PATH = '/public/v1/submit/sign_raw_payload';
/** Headers an agent may not set on the request billing makes for it. */
const BLOCKED_HEADERS = /^(host|cookie|authorization|proxy-|x-payment|payment-|content-length)/i;

export interface PayInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** The most the agent agrees to pay, in USDC. */
  maxAmount: string;
}

/** Thrown with an answer for the agent: why nothing was paid. */
export class PaymentRefused extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/**
 * An agent paying from the person's wallet on any site that takes x402.
 *
 * Billing makes the request; on 402 it reads the terms, checks them against
 * what the agent agreed to and the limits the person set, signs a USDC
 * transfer authorization with the agent's own Turnkey key (whose policy caps
 * one payment by itself) and repeats the request with it. The seller puts the
 * authorization on chain. Every payment is logged, and counts towards the day
 * and month while it can still be used.
 */
@Injectable()
export class AgentPaymentsService {
  private readonly logger = new Logger(AgentPaymentsService.name);
  private readonly turnkey = new TurnkeyWallets();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: WalletAgentsService,
  ) {}

  /** Balance, limits and what is left of them. */
  async balance(context: AgentContext) {
    const { wallet, agent } = await this.agents.enter(context);
    const described = await this.agents.describe(agent);
    const balance = await this.usdcBalance(wallet.address as `0x${string}`).catch(() => null);
    const limits = described.limits;
    return {
      address: wallet.address,
      network: 'Base (eip155:8453)',
      asset: 'USDC',
      balance: balance === null ? null : formatUnits(balance, 6),
      status: agent.status,
      ...(agent.status === 'pending'
        ? { approve: `The wallet owner approves this agent at ${this.agents.accountUrl()}` }
        : {}),
      limits,
      spent: described.spent,
      ...(limits
        ? {
            left: {
              today: left(limits.daily, described.spent.today),
              month: left(limits.monthly, described.spent.month),
            },
          }
        : {}),
    };
  }

  /** The agent's recent payments. */
  async history(context: AgentContext) {
    const { agent } = await this.agents.enter(context);
    const rows = await this.prisma.walletAgentPayment.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((row) => ({
      url: row.url,
      amount: formatUnits(BigInt(row.valueRaw), 6),
      payTo: row.payTo,
      status: row.status,
      transaction: row.txHash,
      at: row.createdAt,
    }));
  }

  async pay(context: AgentContext, input: PayInput) {
    const { wallet, agent } = await this.agents.enter(context);
    if (agent.status !== 'active') {
      throw new PaymentRefused(
        'needs_approval',
        `The wallet owner has not approved this agent yet. They do it at ${this.agents.accountUrl()}; try again after.`,
      );
    }
    const limits = agent.limits as unknown as AgentLimits;
    let max: bigint;
    try {
      max = parseUnits(String(input.maxAmount ?? ''), 6);
    } catch {
      throw new PaymentRefused('invalid_max_amount', 'maxAmount is a USDC amount, e.g. "2.50"');
    }
    const url = await checkSellerUrl(input.url).catch((e: Error) => {
      throw new PaymentRefused('invalid_url', e.message);
    });
    if (limits.merchants?.length && !limits.merchants.includes(url.origin)) {
      throw new PaymentRefused(
        'merchant_not_allowed',
        `${url.origin} is not among the sites this agent may pay`,
      );
    }

    const request = {
      method: (input.method ?? 'GET').toUpperCase(),
      headers: Object.fromEntries(
        Object.entries(input.headers ?? {}).filter(([name]) => !BLOCKED_HEADERS.test(name)),
      ),
      body: input.body,
    };
    const first = await callSeller(url, request).catch((e: Error) => {
      throw new PaymentRefused('site_unreachable', `The site did not answer: ${e.message}`);
    });
    if (first.status !== 402) return { paid: null, response: answer(first) };

    let terms: PaymentTerms;
    try {
      terms = readTerms(first);
    } catch (e) {
      if (e instanceof X402ClientError) throw new PaymentRefused('unsupported_terms', e.message);
      throw e;
    }
    const amount = formatUnits(terms.amount, 6);
    if (terms.amount > max) {
      throw new PaymentRefused(
        'over_max_amount',
        `The site asks ${amount} USDC, more than maxAmount`,
        { amount },
      );
    }
    if (terms.amount > usdc(limits.perPayment)) {
      throw new PaymentRefused(
        'over_payment_limit',
        `${amount} USDC is over this agent's limit of ${limits.perPayment} per payment`,
        { amount },
      );
    }
    const balance = await this.usdcBalance(wallet.address as `0x${string}`);
    if (balance < terms.amount) {
      throw new PaymentRefused(
        'insufficient_funds',
        `The wallet holds ${formatUnits(balance, 6)} USDC; the site asks ${amount}. The owner can top it up at ${this.agents.accountUrl()}`,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const authorization: Authorization = {
      from: wallet.address as `0x${string}`,
      to: terms.payTo,
      value: terms.amount,
      validAfter: BigInt(now - 60),
      validBefore: BigInt(now + terms.maxTimeoutSeconds),
      nonce: `0x${randomBytes(32).toString('hex')}`,
    };
    await this.reconcile(wallet, agent);
    const payment = await this.reserve(agent, limits, { url, terms, authorization });

    let signature: `0x${string}`;
    try {
      signature = await this.sign(wallet, agent, authorization);
    } catch (error: any) {
      await this.mark(payment.id, { status: 'failed', error: String(error?.message ?? error) });
      this.logger.warn(`Agent ${agent.agentDid} could not sign: ${error?.message}`);
      throw new PaymentRefused('signing_failed', 'The wallet refused to sign this payment');
    }

    const second = await callSeller(url, {
      ...request,
      headers: { ...request.headers, ...paymentHeader(terms, authorization, signature) },
    }).catch((e: Error) => ({ status: 0, headers: {}, body: e.message, truncated: false }));
    const ok = second.status >= 200 && second.status < 300;
    const transaction = settledTransaction(second);
    await this.mark(payment.id, {
      status: ok ? 'paid' : 'refused',
      httpStatus: second.status,
      txHash: transaction,
    });
    await this.prisma.walletAgent.update({
      where: { id: agent.id },
      data: { lastUsedAt: new Date() },
    });
    this.logger.log(
      `Agent ${agent.agentDid} paid ${amount} USDC to ${url.origin}: ${second.status}`,
    );

    return {
      paid: ok ? { amount, currency: 'USDC', payTo: terms.payTo, transaction } : null,
      ...(ok
        ? {}
        : {
            note: 'The site did not accept the payment. The signed authorization stays counted against the limits until it expires unless the site uses it.',
          }),
      response: answer(second),
    };
  }

  /**
   * Record the payment before it is signed, under a per-agent lock, so two
   * payments at once cannot both fit the same room in the day and month limits.
   */
  private async reserve(
    agent: WalletAgent,
    limits: AgentLimits,
    input: { url: URL; terms: PaymentTerms; authorization: Authorization },
  ) {
    const amount = input.terms.amount;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agent.id}))`;
      const [today, month] = await Promise.all([
        this.agents.spentSince(agent.id, dayAgo()),
        this.agents.spentSince(agent.id, startOfMonth()),
      ]);
      if (today + amount > usdc(limits.daily)) {
        throw new PaymentRefused(
          'over_daily_limit',
          `This would pass the agent's limit of ${limits.daily} a day (${formatUnits(today, 6)} spent)`,
        );
      }
      if (month + amount > usdc(limits.monthly)) {
        throw new PaymentRefused(
          'over_monthly_limit',
          `This would pass the agent's limit of ${limits.monthly} a month (${formatUnits(month, 6)} spent)`,
        );
      }
      return tx.walletAgentPayment.create({
        data: {
          agentId: agent.id,
          url: input.url.toString().slice(0, 2000),
          merchant: input.url.origin,
          payTo: input.terms.payTo,
          valueRaw: amount.toString(),
          nonce: input.authorization.nonce,
          validBefore: new Date(Number(input.authorization.validBefore) * 1000),
          description: input.terms.description?.slice(0, 500),
        },
      });
    });
  }

  /**
   * Payments a seller refused whose authorization has expired: settle them
   * from the chain. Used after all (the seller put it on chain late) → paid;
   * otherwise expired, and no longer counted.
   */
  private async reconcile(wallet: Wallet, agent: WalletAgent) {
    const lapsed = await this.prisma.walletAgentPayment.findMany({
      where: { agentId: agent.id, status: 'refused', validBefore: { lte: new Date() } },
      take: 10,
    });
    if (lapsed.length === 0) return;
    const settings = await loadCryptoSettings(this.prisma);
    const client = baseClient(settings?.rpcUrls[X402_CHAIN]);
    for (const row of lapsed) {
      const used = await client
        .readContract({
          address: usdcAddress(),
          abi: USDC_ABI,
          functionName: 'authorizationState',
          args: [wallet.address as `0x${string}`, row.nonce as `0x${string}`],
        })
        .catch(() => null);
      if (used !== null) await this.mark(row.id, { status: used ? 'paid' : 'expired' });
    }
  }

  /** The agent's own key signs, in the person's wallet, under the agent's Turnkey policy. */
  async sign(wallet: Wallet, agent: WalletAgent, authorization: Authorization) {
    if (!agent.apiPublicKey || !agent.apiPrivateKey) throw new Error('The agent has no key');
    const body = JSON.stringify({
      type: 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2',
      timestampMs: String(Date.now()),
      organizationId: wallet.subOrganizationId,
      parameters: {
        signWith: wallet.address,
        payload: typedDataPayload(authorization),
        encoding: 'PAYLOAD_ENCODING_EIP712',
        hashFunction: 'HASH_FUNCTION_NO_OP',
      },
    });
    const result = await this.turnkey.submitWithKey(SIGN_RAW_PAYLOAD_PATH, body, {
      publicKey: agent.apiPublicKey,
      privateKey: agent.apiPrivateKey,
    });
    return joinSignature(result.signRawPayloadResult);
  }

  private mark(id: string, data: Record<string, unknown>) {
    return this.prisma.walletAgentPayment.update({ where: { id }, data }).catch(() => undefined);
  }

  async usdcBalance(address: `0x${string}`): Promise<bigint> {
    const settings = await loadCryptoSettings(this.prisma);
    return baseClient(settings?.rpcUrls[X402_CHAIN]).readContract({
      address: usdcAddress(),
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [address],
    });
  }
}

function left(limit: string, spent: string): string {
  const rest = usdc(limit) - parseUnits(spent, 6);
  return formatUnits(rest > 0n ? rest : 0n, 6);
}

/** The seller's answer as the agent sees it. */
function answer(response: {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated?: boolean;
}) {
  return {
    status: response.status,
    contentType: response.headers['content-type'] ?? null,
    body: response.body,
    ...(response.truncated ? { truncated: true } : {}),
  };
}
