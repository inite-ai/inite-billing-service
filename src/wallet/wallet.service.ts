import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Wallet, WalletTopup, WalletWithdrawal } from '@prisma/client';
import { formatUnits, getAddress, isAddress, parseUnits } from 'viem';
import { PrismaService } from '../common/services/prisma.service';
import { loadCryptoSettings } from '../adapters/crypto/crypto-config';
import { RelayerKeys } from '../adapters/crypto/x402/relayer-key';
import { USDC_ABI, baseClient } from '../adapters/crypto/x402/relayer';
import {
  Authorization,
  DecodedPayment,
  X402Error,
  X402_CHAIN,
  X402_NETWORK,
  typedDataPayload,
  usdcAddress,
} from '../adapters/crypto/x402/protocol';
import { Settlements } from '../adapters/crypto/x402/settlements';
import { HODLE_WALLET_TOPUP_PREFIX, HodleAdapter } from '../adapters/hodle/hodle.adapter';
import { PasskeyAttestation, TurnkeyRequestError, TurnkeyWallets } from './turnkey-wallets';
import { SelfAgentError, checkKeyStamp } from './self-agent';

const USDC_DECIMALS = 6;
/** How long the person has to approve a withdrawal with their passkey. */
const WITHDRAWAL_WINDOW_SECONDS = 15 * 60;
/** Withdrawals cost us network fees; a person gets this many a day. */
const WITHDRAWALS_PER_DAY = 10;
const MIN_WITHDRAWAL = parseUnits('0.01', USDC_DECIMALS);
/** PIX top-ups, in reais. */
const PIX_MIN = 5;
const PIX_MAX = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SIGN_RAW_PAYLOAD_PATH = '/public/v1/submit/sign_raw_payload';

const TOPUP_STATUS: Record<string, string> = {
  PENDING: 'pending',
  FIAT_PAID: 'paid',
  PROCESSING: 'paid',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
  FAILED: 'failed',
  REFUNDED: 'refunded',
};

/**
 * INITE wallets: a person's own USDC on Base.
 *
 * Each wallet is a Turnkey sub-organization whose only root user is the
 * person's passkey. Billing opens it (its API user may create
 * sub-organizations and nothing else) and keeps the address; everything that
 * moves money out of it is a request the person's passkey stamps in the
 * browser. Top-ups arrive straight at the address — a transfer from anywhere,
 * or a PIX that Hodle converts and delivers there. Withdrawals are USDC
 * transfer authorizations the person signs, which our relayer puts on chain
 * so the wallet needs no ETH for fees.
 *
 * Billing never holds the money and has no key that can spend it.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly keys: RelayerKeys;
  private readonly settlements: Settlements;
  private readonly turnkey: TurnkeyWallets;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hodle: HodleAdapter,
  ) {
    this.keys = new RelayerKeys(prisma);
    this.settlements = new Settlements(prisma);
    this.turnkey = new TurnkeyWallets();
  }

  /** The person's wallet with its balance and recent activity, or what can be done without one. */
  async overview(ownerDid: string) {
    const wallet = await this.find(ownerDid);
    const [canOpen, canWithdraw, pix] = await Promise.all([
      this.turnkeyAccess().then(Boolean),
      this.settlements.relayer().then(Boolean),
      this.pixAvailable(),
    ]);
    if (!wallet) return { wallet: null, canOpen, canWithdraw, topups: { pix } };

    const [balanceRaw, topups, withdrawals] = await Promise.all([
      this.balance(wallet.address as `0x${string}`).catch(() => null),
      this.prisma.walletTopup.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.walletWithdrawal.findMany({
        where: { walletId: wallet.id, status: { notIn: ['prepared', 'expired'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      wallet: {
        address: wallet.address,
        network: X402_NETWORK,
        asset: 'USDC',
        balance: balanceRaw === null ? null : formatUnits(balanceRaw, USDC_DECIMALS),
        credentialId: wallet.credentialId,
        createdAt: wallet.createdAt,
      },
      canOpen,
      canWithdraw,
      topups: { pix },
      history: [...topups.map(describeTopup), ...withdrawals.map(describeWithdrawal)].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
    };
  }

  /**
   * Open the person's wallet with the passkey their browser just made. One
   * wallet per person: asking again returns the one they have.
   */
  async open(ownerDid: string, passkey: PasskeyAttestation) {
    const existing = await this.find(ownerDid);
    if (existing) return this.overview(ownerDid);
    const access = await this.turnkeyAccess();
    if (!access) throw new ServiceUnavailableException('INITE wallets are not available yet');

    let opened;
    try {
      opened = await this.turnkey.open(access.organizationId, access.key, {
        // Turnkey sees an opaque id, not who the person is.
        name: `inite-wallet-${randomUUID()}`,
        passkey,
      });
    } catch (error: any) {
      this.logger.warn(`Could not open a wallet: ${error?.message}`);
      throw new BadRequestException('The wallet could not be created with this passkey');
    }
    try {
      await this.prisma.wallet.create({
        data: {
          ownerDid,
          subOrganizationId: opened.subOrganizationId,
          turnkeyWalletId: opened.turnkeyWalletId,
          address: opened.address,
          credentialId: passkey.credentialId,
        },
      });
    } catch (error: any) {
      // Opened twice at once: the other request's wallet stands. This
      // sub-organization stays empty in Turnkey.
      if (error?.code !== 'P2002') throw error;
      this.logger.warn(`Second wallet opened for one person; ${opened.subOrganizationId} unused`);
    }
    this.logger.log(`INITE wallet opened: ${opened.address}`);
    return this.overview(ownerDid);
  }

  /** A PIX in reais that Hodle delivers to the wallet as USDC. */
  async topUpByPix(ownerDid: string, amount: string) {
    const wallet = await this.require(ownerDid);
    if (!(await this.pixAvailable())) {
      throw new ServiceUnavailableException('PIX top-ups are not available right now');
    }
    const reais = Number(amount);
    if (!/^\d{1,5}(\.\d{1,2})?$/.test(amount) || reais < PIX_MIN || reais > PIX_MAX) {
      throw new BadRequestException(`A PIX top-up is R$${PIX_MIN}–R$${PIX_MAX}`);
    }
    const value = Math.round(reais * 100);
    const externalId = `${HODLE_WALLET_TOPUP_PREFIX}${randomUUID()}`;
    const deposit = await this.hodle.depositToAddress({
      value,
      address: wallet.address,
      externalId,
    });
    const topup = await this.prisma.walletTopup.create({
      data: {
        walletId: wallet.id,
        rail: 'HODLE',
        externalId: deposit.externalId,
        value,
        currency: 'BRL',
        qrCode: deposit.qrCode,
      },
    });
    return { ...describeTopup(topup), qrCode: deposit.qrCode, fee: deposit.fee };
  }

  /** A top-up as it stands now, asking the rail while it is open. */
  async topUp(ownerDid: string, id: string) {
    const wallet = await this.require(ownerDid);
    let topup = await this.prisma.walletTopup.findFirst({ where: { id, walletId: wallet.id } });
    if (!topup) throw new NotFoundException('No such top-up');
    if (['pending', 'paid'].includes(topup.status)) {
      const raw = await this.hodle.depositStatus(topup.externalId).catch(() => '');
      const status = TOPUP_STATUS[raw];
      if (status && status !== topup.status) {
        topup = await this.prisma.walletTopup.update({ where: { id }, data: { status } });
      }
    }
    return {
      ...describeTopup(topup),
      qrCode: topup.status === 'pending' ? topup.qrCode : null,
    };
  }

  /**
   * Get a withdrawal ready for the person's passkey: the USDC transfer
   * authorization, and the exact Turnkey request that signs it, which their
   * browser stamps. Nothing moves until they do.
   */
  async prepareWithdrawal(ownerDid: string, input: { to: string; amount: string }) {
    const wallet = await this.require(ownerDid);
    if (!(await this.settlements.relayer())) {
      throw new ServiceUnavailableException('Withdrawals are not available right now');
    }
    const to = recipient(input.to, wallet.address);
    const value = amountRaw(input.amount);

    const balance = await this.balance(wallet.address as `0x${string}`);
    if (balance < value) throw new BadRequestException('The wallet does not hold that much USDC');
    const today = await this.prisma.walletWithdrawal.count({
      where: {
        walletId: wallet.id,
        status: { notIn: ['prepared', 'expired'] },
        createdAt: { gte: new Date(Date.now() - DAY_MS) },
      },
    });
    if (today >= WITHDRAWALS_PER_DAY) {
      throw new BadRequestException(`At most ${WITHDRAWALS_PER_DAY} withdrawals a day`);
    }

    // One withdrawal waits for the passkey at a time.
    await this.prisma.walletWithdrawal.updateMany({
      where: { walletId: wallet.id, status: 'prepared' },
      data: { status: 'expired' },
    });

    const now = Math.floor(Date.now() / 1000);
    const authorization: Authorization = {
      from: wallet.address as `0x${string}`,
      to,
      value,
      validAfter: 0n,
      validBefore: BigInt(now + WITHDRAWAL_WINDOW_SECONDS),
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
    const withdrawal = await this.prisma.walletWithdrawal.create({
      data: {
        walletId: wallet.id,
        to,
        valueRaw: value.toString(),
        nonce: authorization.nonce,
        validAfter: new Date(0),
        validBefore: new Date(Number(authorization.validBefore) * 1000),
        request,
      },
    });
    return {
      ...describeWithdrawal(withdrawal),
      /** Stamp exactly this string with the wallet passkey. */
      request,
      credentialId: wallet.credentialId,
    };
  }

  /**
   * The person approved the withdrawal: `stamp` is their passkey's stamp of
   * the prepared request. Turnkey signs the authorization in their wallet;
   * the relayer puts it on chain.
   */
  async confirmWithdrawal(ownerDid: string, id: string, stamp: string) {
    const wallet = await this.require(ownerDid);
    const withdrawal = await this.prisma.walletWithdrawal.findFirst({
      where: { id, walletId: wallet.id },
    });
    if (!withdrawal) throw new NotFoundException('No such withdrawal');
    if (withdrawal.status !== 'prepared') {
      throw new ConflictException(`This withdrawal is ${withdrawal.status}`);
    }
    if (withdrawal.validBefore.getTime() < Date.now() + 30_000) {
      await this.setStatus(withdrawal.id, 'expired');
      throw new ConflictException('This withdrawal expired; start it again');
    }
    // A person's wallet takes their passkey's stamp; an agent's own wallet,
    // the stamp of the agent's key.
    if (wallet.ownerKey) {
      try {
        checkKeyStamp(stamp, wallet.ownerKey);
      } catch (error) {
        if (error instanceof SelfAgentError) throw new BadRequestException(error.message);
        throw error;
      }
    } else {
      checkStamp(stamp);
    }
    const relayer = await this.settlements.relayer();
    if (!relayer) throw new ServiceUnavailableException('Withdrawals are not available right now');

    // Taken on once: a second confirmation finds it no longer prepared.
    const taken = await this.prisma.walletWithdrawal.updateMany({
      where: { id: withdrawal.id, status: 'prepared' },
      data: { status: 'signing' },
    });
    if (taken.count === 0) throw new ConflictException('This withdrawal is already under way');

    let signature: `0x${string}`;
    try {
      const result = wallet.ownerKey
        ? await this.turnkey.submitKeyStamped(SIGN_RAW_PAYLOAD_PATH, withdrawal.request, stamp)
        : await this.turnkey.submitStamped(SIGN_RAW_PAYLOAD_PATH, withdrawal.request, stamp);
      signature = joinSignature(result.signRawPayloadResult);
    } catch (error: any) {
      await this.setStatus(withdrawal.id, 'failed', error?.message);
      if (error instanceof TurnkeyRequestError && error.status < 500) {
        throw new BadRequestException('The passkey did not approve this withdrawal');
      }
      throw new ServiceUnavailableException('The wallet could not sign; try again');
    }

    const payment: DecodedPayment = {
      version: 2,
      scheme: 'exact',
      network: X402_NETWORK,
      asset: usdcAddress(),
      authorization: {
        from: wallet.address as `0x${string}`,
        to: withdrawal.to as `0x${string}`,
        value: BigInt(withdrawal.valueRaw),
        validAfter: BigInt(Math.floor(withdrawal.validAfter.getTime() / 1000)),
        validBefore: BigInt(Math.floor(withdrawal.validBefore.getTime() / 1000)),
        nonce: withdrawal.nonce as `0x${string}`,
      },
      signature,
    };

    let hash: `0x${string}`;
    let claimId: string;
    try {
      await relayer.verify(payment);
      const claim = await this.settlements.claim(payment, { withdrawalId: withdrawal.id });
      if (!claim.claimed) throw new ConflictException('This withdrawal is already under way');
      claimId = claim.row.id;
      hash = await this.settlements.submit(relayer, payment, claimId);
    } catch (error: any) {
      await this.setStatus(withdrawal.id, 'failed', error?.message);
      if (error instanceof X402Error) throw new BadRequestException(error.message);
      if (error instanceof ConflictException) throw error;
      this.logger.error(`Withdrawal ${withdrawal.id} could not be sent: ${error?.message}`);
      throw new ServiceUnavailableException('The withdrawal could not be sent');
    }
    await this.prisma.walletWithdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'submitted', txHash: hash },
    });
    this.logger.log(`Withdrawal ${withdrawal.id} from ${wallet.address}: tx ${hash}`);

    const mined = await this.settlements.confirm(relayer, hash, claimId);
    const done = await this.prisma.walletWithdrawal.update({
      where: { id: withdrawal.id },
      data: mined === null ? {} : { status: mined ? 'mined' : 'reverted' },
    });
    return describeWithdrawal(done);
  }

  private find(ownerDid: string): Promise<Wallet | null> {
    return this.prisma.wallet.findUnique({ where: { ownerDid } });
  }

  private async require(ownerDid: string): Promise<Wallet> {
    const wallet = await this.find(ownerDid);
    if (!wallet) throw new NotFoundException('No INITE wallet yet');
    return wallet;
  }

  private setStatus(id: string, status: string, error?: string) {
    return this.prisma.walletWithdrawal
      .update({ where: { id }, data: { status, ...(error ? { error } : {}) } })
      .catch(() => undefined);
  }

  /** Billing's Turnkey organization and key, when the admin has set them up. */
  private async turnkeyAccess() {
    const settings = await loadCryptoSettings(this.prisma);
    const organizationId = settings?.x402.organizationId;
    if (!organizationId) return null;
    const key = await this.keys.current();
    return key ? { organizationId, key } : null;
  }

  private async pixAvailable(): Promise<boolean> {
    const provider = await this.prisma.paymentProvider.findUnique({ where: { code: 'HODLE' } });
    return !!provider?.isActive;
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

/** A recipient that can receive USDC: an address, not the wallet itself, not the token contract. */
function recipient(input: string, own: string): `0x${string}` {
  const text = String(input ?? '').trim();
  if (!isAddress(text, { strict: false })) {
    throw new BadRequestException('The recipient is not a Base address (0x…)');
  }
  const to = getAddress(text);
  if (BigInt(to) === 0n || to === getAddress(usdcAddress())) {
    throw new BadRequestException('USDC sent to this address would be lost');
  }
  if (to === getAddress(own)) throw new BadRequestException('This is the wallet’s own address');
  return to;
}

function amountRaw(input: string): bigint {
  const text = String(input ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(text)) {
    throw new BadRequestException('The amount is in USDC, up to six decimals');
  }
  const value = parseUnits(text, USDC_DECIMALS);
  if (value < MIN_WITHDRAWAL) throw new BadRequestException('The least to withdraw is 0.01 USDC');
  return value;
}

/** A passkey stamp as Turnkey's WebauthnStamper makes it: JSON with four base64url fields. */
function checkStamp(stamp: string): void {
  let parsed: any;
  try {
    parsed = typeof stamp === 'string' && stamp.length < 8_192 ? JSON.parse(stamp) : null;
  } catch {
    parsed = null;
  }
  const fields = ['credentialId', 'authenticatorData', 'clientDataJson', 'signature'];
  if (!parsed || !fields.every((f) => typeof parsed[f] === 'string' && parsed[f].length > 0)) {
    throw new BadRequestException('A passkey stamp is required');
  }
}

/** Turnkey's r, s and v (yParity) as one 65-byte signature. */
export function joinSignature(result: { r?: string; s?: string; v?: string } | undefined) {
  const hex = (x: string | undefined) => (x ?? '').replace(/^0x/, '').padStart(64, '0');
  if (!result?.r || !result?.s || result.v === undefined) {
    throw new Error('Turnkey returned no signature');
  }
  const v = Number.parseInt(result.v, 16);
  const recovery = v === 0 || v === 27 ? '1b' : '1c';
  return `0x${hex(result.r)}${hex(result.s)}${recovery}` as `0x${string}`;
}

function describeTopup(topup: WalletTopup) {
  return {
    kind: 'topup' as const,
    id: topup.id,
    rail: topup.rail,
    amount: (topup.value / 100).toFixed(2),
    currency: topup.currency,
    status: topup.status,
    createdAt: topup.createdAt,
  };
}

function describeWithdrawal(withdrawal: WalletWithdrawal) {
  return {
    kind: 'withdrawal' as const,
    id: withdrawal.id,
    to: withdrawal.to,
    amount: formatUnits(BigInt(withdrawal.valueRaw), USDC_DECIMALS),
    currency: 'USDC',
    status: withdrawal.status,
    txHash: withdrawal.txHash,
    expiresAt: withdrawal.validBefore,
    createdAt: withdrawal.createdAt,
  };
}
