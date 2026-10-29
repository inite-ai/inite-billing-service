import { HttpException, HttpStatus } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { roundMoney, toMoney } from '../common/money';

/**
 * The stake offer, read from the product's catalogue metadata
 * (`product.metadata.commitment`). Nothing here is a business number in code:
 * every default below is only what an empty policy means, and the owner's
 * numbers (tiers $5–100, $300 cap, proof above $25) live in the catalogue.
 */
export interface CommitmentPolicy {
  tiers: string[];
  feePct: Decimal;
  creditsBonusPct: Decimal;
  creditsPerUsd: number;
  creditsServiceCode: string | null;
  maxActivePerUser: Decimal;
  verificationAbove: Decimal;
  autoReleaseDays: number;
  cancelWindowHours: number;
  disputeBackstopDays: number;
  cancelsPer30Days: number;
  minDurationHours: number;
  maxDurationDays: number;
}

/** Conflicts with the commitment's state or the person's limits answer 409. */
const CONFLICT_CODES = new Set([
  'cap_exceeded',
  'invalid_state',
  'too_early',
  'cancel_window_closed',
  'cancel_limit',
  'idempotency_key_reused',
]);

/** A refusal with a machine-readable `code` the product can show a reason for. */
export class CommitmentError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    const status = CONFLICT_CODES.has(code) ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;
    super({ statusCode: status, message, code }, status);
  }
}

const DECIMAL = /^\d{1,7}(\.\d{1,4})?$/;

function dec(raw: unknown, fallback: string, field: string): Decimal {
  const value = raw === undefined || raw === null ? fallback : String(raw);
  if (!DECIMAL.test(value)) throw new Error(`commitment policy: ${field} is not a decimal`);
  return toMoney(value);
}

function int(raw: unknown, fallback: number, field: string): number {
  const value = raw === undefined || raw === null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`commitment policy: ${field} is not a non-negative integer`);
  }
  return value;
}

/** The policy of a product, or null when the product is not a stake offer. */
export function readPolicy(metadata: unknown): CommitmentPolicy | null {
  const raw = (metadata as any)?.commitment;
  if (!raw || typeof raw !== 'object') return null;
  const tiers: unknown[] = Array.isArray(raw.tiers) ? raw.tiers : [];
  if (tiers.length === 0) throw new Error('commitment policy: no tiers');
  return {
    tiers: tiers.map((t) => {
      const s = String(t);
      if (!DECIMAL.test(s) || toMoney(s).lte(0)) throw new Error('commitment policy: bad tier');
      return s;
    }),
    feePct: dec(raw.feePct, '0', 'feePct'),
    creditsBonusPct: dec(raw.creditsBonusPct, '0', 'creditsBonusPct'),
    creditsPerUsd: int(raw.creditsPerUsd, 0, 'creditsPerUsd'),
    creditsServiceCode:
      typeof raw.creditsServiceCode === 'string' && raw.creditsServiceCode
        ? raw.creditsServiceCode
        : null,
    maxActivePerUser: dec(raw.maxActivePerUser, '0', 'maxActivePerUser'),
    verificationAbove: dec(raw.verificationAbove, '0', 'verificationAbove'),
    autoReleaseDays: int(raw.autoReleaseDays, 7, 'autoReleaseDays'),
    cancelWindowHours: int(raw.cancelWindowHours, 24, 'cancelWindowHours'),
    disputeBackstopDays: int(raw.disputeBackstopDays, 30, 'disputeBackstopDays'),
    cancelsPer30Days: int(raw.cancelsPer30Days, 2, 'cancelsPer30Days'),
    minDurationHours: int(raw.minDurationHours, 24, 'minDurationHours'),
    maxDurationDays: int(raw.maxDurationDays, 180, 'maxDurationDays'),
  };
}

export function requirePolicy(metadata: unknown, productCode: string): CommitmentPolicy {
  const policy = readPolicy(metadata);
  if (!policy) throw new CommitmentError('invalid_tier', `${productCode} is not a stake offer`);
  return policy;
}

/** The price code of a tier: `<product>-usd-<tier>`. */
export function tierPriceCode(productCode: string, tier: string): string {
  return `${productCode}-usd-${tier.replace('.', '_')}`;
}

export interface Quote {
  productCode: string;
  tier: string;
  stake: string;
  fee: string;
  total: string;
  feePct: string;
  creditsBonusPct: string;
  credits: number;
  currency: string;
}

/** Fee on top of the stake, rounded to the cent. */
export function feeFor(stake: Decimal, feePct: Decimal): Decimal {
  return roundMoney(stake.mul(feePct).div(100)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Credits a released stake turns into: stake × rate × (1 + bonus), floored. */
export function creditsFor(stake: Decimal, creditsPerUsd: number, bonusPct: Decimal): number {
  return stake
    .mul(creditsPerUsd)
    .mul(new Decimal(100).plus(bonusPct))
    .div(100)
    .toDecimalPlaces(0, Decimal.ROUND_FLOOR)
    .toNumber();
}

export function quote(productCode: string, policy: CommitmentPolicy, tier: string): Quote {
  if (!policy.tiers.includes(tier)) {
    throw new CommitmentError('invalid_tier', `A stake is one of ${policy.tiers.join(', ')} USD`);
  }
  const stake = toMoney(tier);
  const fee = feeFor(stake, policy.feePct);
  return {
    productCode,
    tier,
    stake: stake.toFixed(2),
    fee: fee.toFixed(2),
    total: stake.plus(fee).toFixed(2),
    feePct: policy.feePct.toString(),
    creditsBonusPct: policy.creditsBonusPct.toString(),
    credits: creditsFor(stake, policy.creditsPerUsd, policy.creditsBonusPct),
    currency: 'USD',
  };
}

/** The verification a stake of this size needs, or the refusal. */
export function checkVerification(
  policy: CommitmentPolicy,
  stake: Decimal,
  verification: { referee?: boolean; proof?: boolean },
): void {
  if (stake.gt(policy.verificationAbove) && !verification.referee && !verification.proof) {
    throw new CommitmentError(
      'verification_required',
      `A stake above ${policy.verificationAbove.toFixed(0)} USD needs a referee or proof`,
    );
  }
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function checkEndsAt(policy: CommitmentPolicy, endsAt: Date, now = new Date()): void {
  const ms = endsAt.getTime() - now.getTime();
  if (
    !Number.isFinite(ms) ||
    ms < policy.minDurationHours * HOUR ||
    ms > policy.maxDurationDays * DAY
  ) {
    throw new CommitmentError(
      'invalid_ends_at',
      `A promise ends between ${policy.minDurationHours} hours and ${policy.maxDurationDays} days from now`,
    );
  }
}

export const autoReleaseAt = (policy: CommitmentPolicy, endsAt: Date) =>
  new Date(endsAt.getTime() + policy.autoReleaseDays * DAY);

export const backstopAt = (policy: CommitmentPolicy, endsAt: Date) =>
  new Date(endsAt.getTime() + policy.disputeBackstopDays * DAY);
