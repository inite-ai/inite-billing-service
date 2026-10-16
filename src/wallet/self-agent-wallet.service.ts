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
import type { Wallet, WalletPayment } from '@prisma/client';
import { formatUnits, parseUnits } from 'viem';
import { PrismaService } from '../common/services/prisma.service';
import { loadCryptoSettings } from '../adapters/crypto/crypto-config';
import { RelayerKeys } from '../adapters/crypto/x402/relayer-key';
import { USDC_ABI, baseClient } from '../adapters/crypto/x402/relayer';
import {
  Authorization,
  X402_CHAIN,
  X402_NETWORK,
  typedDataPayload,
  usdcAddress,
} from '../adapters/crypto/x402/protocol';
import { TurnkeyRequestError, TurnkeyWallets } from './turnkey-wallets';
import { joinSignature } from './wallet.service';
import { SelfAgentError, checkKeyStamp, resolveAgentKey } from './self-agent';
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
const BLOCKED_HEADERS = /^(host|cookie|authorization|proxy-|x-payment|payment-|content-length)/i;
/** How long a prepared payment waits for the agent's stamp. */
const STAMP_WINDOW_SECONDS = 10 * 60;

export interface SelfAgentPayInput {
  url: string;
  maxAmount: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * The wallet of an AI agent that exists on its own (self-agent.ts).
 *
 * The agent opens it with its INITE token; the sub-organization's only root
 * user is the agent's key from its DID document. Paying is two calls: billing
 * reads the seller's x402 terms and prepares the exact Turnkey request; the
 * agent stamps it with its key and sends the stamp back; billing submits it,
 * and repeats the seller's request with the signed payment. Billing holds no
 * key to this wallet and can move nothing on its own.
 */
@Injectable()
export class SelfAgentWalletService {
  private readonly logger = new Logger(SelfAgentWalletService.name);
  private readonly turnkey = new TurnkeyWallets();
  private readonly keys: RelayerKeys;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.keys = new RelayerKeys(prisma);
  }

  /** INITE Auth's issuer: the only place agent DID documents are read from. */
  issuer(): string {
    return (this.config.get<string>('JWT_ISSUER') || 'https://auth-api.inite.ai').replace(
      /\/$/,
      '',
    );
  }

  async overview(did: string) {
    const wallet = await this.find(did);
    if (!wallet) {
      return {
        wallet: null,
        open: 'POST /v1/agent-wallet opens it: an address on Base whose only owner is your key.',
      };
    }
    const [balance, payments] = await Promise.all([
      this.balance(wallet.address as `0x${string}`).catch(() => null),
      this.prisma.walletPayment.findMany({
        where: { walletId: wallet.id, status: { notIn: ['prepared', 'expired'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      wallet: {
        address: wallet.address,
        network: X402_NETWORK,
        asset: 'USDC',
        balance: balance === null ? null : formatUnits(balance, 6),
        ownerKey: wallet.ownerKey,
        createdAt: wallet.createdAt,
      },
      fund: `Send USDC on Base to ${wallet.address}. Fees are paid by INITE; the wallet needs no ETH.`,
      payments: payments.map(describe),
    };
  }

  async open(did: string) {
    if (await this.find(did)) return this.overview(did);
    const access = await this.turnkeyAccess();
    if (!access) throw new ServiceUnavailableException('INITE wallets are not available yet');
    let ownerKey: string;
    try {
      ownerKey = await resolveAgentKey(did, this.issuer());
    } catch (error) {
      if (error instanceof SelfAgentError) throw new BadRequestException(error.message);
      throw error;
    }
    let opened;
    try {
      opened = await this.turnkey.open(access.organizationId, access.key, {
        name: `inite-agent-wallet-${randomUUID()}`,
        ownerKey,
      });
    } catch (error: any) {
      this.logger.warn(`Could not open an agent wallet: ${error?.message}`);
      throw new BadRequestException('The wallet could not be created with this key');
    }
    try {
      await this.prisma.wallet.create({
        data: {
          ownerDid: did,
          ownerKey,
          subOrganizationId: opened.subOrganizationId,
          turnkeyWalletId: opened.turnkeyWalletId,
          address: opened.address,
        },
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      this.logger.warn(`Second wallet opened for one agent; ${opened.subOrganizationId} unused`);
    }
    this.logger.log(`Agent wallet opened: ${opened.address}`);
    return this.overview(did);
  }

  /**
   * Ask the seller, read its x402 terms, and prepare the payment for the
   * agent's stamp. A seller that does not ask for payment is answered as is.
   */
  async prepare(did: string, input: SelfAgentPayInput) {
    const wallet = await this.require(did);
    let max: bigint;
    try {
      max = parseUnits(String(input.maxAmount ?? ''), 6);
    } catch {
      throw new BadRequestException('maxAmount is a USDC amount, e.g. "2.50"');
    }
    const url = await checkSellerUrl(input.url).catch((e: Error) => {
      throw new BadRequestException(e.message);
    });
    const call = {
      method: (input.method ?? 'GET').toUpperCase(),
      headers: Object.fromEntries(
        Object.entries(input.headers ?? {}).filter(([name]) => !BLOCKED_HEADERS.test(name)),
      ),
      ...(input.body !== undefined ? { body: input.body } : {}),
    };
    const first = await callSeller(url, call).catch((e: Error) => {
      throw new BadRequestException(`The site did not answer: ${e.message}`);
    });
    if (first.status !== 402) return { payment: null, response: answer(first) };

    let terms: PaymentTerms;
    try {
      terms = readTerms(first);
    } catch (e) {
      if (e instanceof X402ClientError) throw new BadRequestException(e.message);
      throw e;
    }
    const amount = formatUnits(terms.amount, 6);
    if (terms.amount > max) {
      throw new BadRequestException(`The site asks ${amount} USDC, more than maxAmount`);
    }
    const balance = await this.balance(wallet.address as `0x${string}`);
    if (balance < terms.amount) {
      throw new BadRequestException(
        `The wallet holds ${formatUnits(balance, 6)} USDC; the site asks ${amount}. Fund ${wallet.address} (USDC on Base).`,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const authorization: Authorization = {
      from: wallet.address as `0x${string}`,
      to: terms.payTo,
      value: terms.amount,
      validAfter: BigInt(now - 60),
      validBefore: BigInt(now + Math.min(terms.maxTimeoutSeconds, STAMP_WINDOW_SECONDS)),
      nonce: `0x${randomBytes(32).toString('hex')}`,
    };
    const request = JSON.stringify({
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
    // One payment waits for the stamp at a time.
    await this.prisma.walletPayment.updateMany({
      where: { walletId: wallet.id, status: 'prepared' },
      data: { status: 'expired' },
    });
    const payment = await this.prisma.walletPayment.create({
      data: {
        walletId: wallet.id,
        url: url.toString().slice(0, 2000),
        call,
        terms: {
          version: terms.version,
          accepted: terms.accepted,
          maxTimeoutSeconds: terms.maxTimeoutSeconds,
        } as any,
        payTo: terms.payTo,
        valueRaw: terms.amount.toString(),
        nonce: authorization.nonce,
        validAfter: new Date(Number(authorization.validAfter) * 1000),
        validBefore: new Date(Number(authorization.validBefore) * 1000),
        request,
      },
    });
    return {
      payment: {
        ...describe(payment),
        description: terms.description ?? null,
        /** Stamp exactly this string with your key (Turnkey ApiKeyStamper), then confirm. */
        request,
        confirm: `POST /v1/agent-wallet/payments/${payment.id}/confirm { "stamp": "<X-Stamp value>" }`,
      },
    };
  }

  /** The agent stamped the prepared request: sign in Turnkey, pay the seller. */
  async confirm(did: string, id: string, stamp: string) {
    const wallet = await this.require(did);
    const payment = await this.prisma.walletPayment.findFirst({
      where: { id, walletId: wallet.id },
    });
    if (!payment) throw new NotFoundException('No such payment');
    if (payment.status !== 'prepared')
      throw new ConflictException(`This payment is ${payment.status}`);
    if (payment.validBefore.getTime() < Date.now() + 15_000) {
      await this.mark(payment.id, { status: 'expired' });
      throw new ConflictException('This payment expired; prepare it again');
    }
    try {
      checkKeyStamp(stamp, wallet.ownerKey ?? '');
    } catch (error) {
      if (error instanceof SelfAgentError) throw new BadRequestException(error.message);
      throw error;
    }
    const taken = await this.prisma.walletPayment.updateMany({
      where: { id: payment.id, status: 'prepared' },
      data: { status: 'signing' },
    });
    if (taken.count === 0) throw new ConflictException('This payment is already under way');

    let signature: `0x${string}`;
    try {
      const result = await this.turnkey.submitKeyStamped(
        SIGN_RAW_PAYLOAD_PATH,
        payment.request,
        stamp,
      );
      signature = joinSignature(result.signRawPayloadResult);
    } catch (error: any) {
      await this.mark(payment.id, { status: 'failed', error: String(error?.message ?? error) });
      if (error instanceof TurnkeyRequestError && error.status < 500) {
        throw new BadRequestException('Turnkey did not accept the stamp for this request');
      }
      throw new ServiceUnavailableException('The wallet could not sign; try again');
    }

    const saved = payment.terms as {
      version: 1 | 2;
      accepted: Record<string, unknown>;
      maxTimeoutSeconds: number;
    };
    const terms: PaymentTerms = {
      version: saved.version,
      accepted: saved.accepted,
      amount: BigInt(payment.valueRaw),
      payTo: payment.payTo as `0x${string}`,
      maxTimeoutSeconds: saved.maxTimeoutSeconds,
    };
    const authorization: Authorization = {
      from: wallet.address as `0x${string}`,
      to: payment.payTo as `0x${string}`,
      value: BigInt(payment.valueRaw),
      validAfter: BigInt(Math.floor(payment.validAfter.getTime() / 1000)),
      validBefore: BigInt(Math.floor(payment.validBefore.getTime() / 1000)),
      nonce: payment.nonce as `0x${string}`,
    };
    const call = payment.call as { method: string; headers: Record<string, string>; body?: string };
    const url = await checkSellerUrl(payment.url).catch((e: Error) => {
      throw new BadRequestException(e.message);
    });
    const second = await callSeller(url, {
      ...call,
      headers: { ...call.headers, ...paymentHeader(terms, authorization, signature) },
    }).catch((e: Error) => ({
      status: 0,
      headers: {} as Record<string, string>,
      body: e.message,
      truncated: false,
    }));
    const ok = second.status >= 200 && second.status < 300;
    const transaction = settledTransaction(second);
    const done = await this.prisma.walletPayment.update({
      where: { id: payment.id },
      data: { status: ok ? 'paid' : 'refused', httpStatus: second.status, txHash: transaction },
    });
    this.logger.log(
      `Agent ${did} paid ${formatUnits(terms.amount, 6)} USDC to ${url.origin}: ${second.status}`,
    );
    return {
      payment: describe(done),
      ...(ok
        ? {}
        : {
            note: 'The site did not accept the payment. The signed authorization stays valid until it expires unless the site uses it.',
          }),
      response: answer(second),
    };
  }

  private find(did: string): Promise<Wallet | null> {
    return this.prisma.wallet.findUnique({ where: { ownerDid: did } });
  }

  private async require(did: string): Promise<Wallet> {
    const wallet = await this.find(did);
    if (!wallet) throw new NotFoundException('No wallet yet: POST /v1/agent-wallet opens it');
    if (!wallet.ownerKey) throw new ConflictException('This wallet belongs to a person');
    return wallet;
  }

  private mark(id: string, data: Record<string, unknown>) {
    return this.prisma.walletPayment.update({ where: { id }, data }).catch(() => undefined);
  }

  private async turnkeyAccess() {
    const settings = await loadCryptoSettings(this.prisma);
    const organizationId = settings?.x402.organizationId;
    if (!organizationId) return null;
    const key = await this.keys.current();
    return key ? { organizationId, key } : null;
  }

  async balance(address: `0x${string}`): Promise<bigint> {
    const settings = await loadCryptoSettings(this.prisma);
    return baseClient(settings?.rpcUrls[X402_CHAIN]).readContract({
      address: usdcAddress(),
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [address],
    });
  }
}

function describe(payment: WalletPayment) {
  return {
    id: payment.id,
    url: payment.url,
    amount: formatUnits(BigInt(payment.valueRaw), 6),
    currency: 'USDC',
    payTo: payment.payTo,
    status: payment.status,
    httpStatus: payment.httpStatus,
    transaction: payment.txHash,
    expiresAt: payment.validBefore,
    createdAt: payment.createdAt,
  };
}

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
