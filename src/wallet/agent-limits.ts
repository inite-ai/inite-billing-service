import { BadRequestException } from '@nestjs/common';
import { parseUnits } from 'viem';
import { CHAINS } from '../adapters/crypto/chains';
import { usdcAddress } from '../adapters/crypto/x402/protocol';

/** What an agent may spend, in US dollars (USDC is one dollar each). */
export interface AgentLimits {
  perPayment: string;
  daily: string;
  monthly: string;
  /** Only these site origins, when set. */
  merchants?: string[];
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = { perPayment: '10', daily: '20', monthly: '50' };
const MAX = { perPayment: 1_000, daily: 2_000, monthly: 10_000 };
const AMOUNT = /^\d{1,7}(\.\d{1,2})?$/;

export const WALLET_SCOPE = 'wallet:pay';
export const WALLET_GRANT_TYPE = 'inite_wallet';

/** USDC base units of a dollar amount. */
export const usdc = (dollars: string) => parseUnits(dollars, 6);

/**
 * Limits as INITE Auth's grant states them (`authorization_details` of type
 * `inite_wallet`), or the defaults when the token only has the scope.
 */
export function limitsFromGrant(details: Array<Record<string, unknown>> | undefined): AgentLimits {
  const grant = details?.find((d) => d?.type === WALLET_GRANT_TYPE);
  const limits = (grant?.limits ?? {}) as Record<string, unknown>;
  const pick = (value: unknown, fallback: string) =>
    typeof value === 'string' && AMOUNT.test(value) ? value : fallback;
  const merchants = Array.isArray(grant?.merchants)
    ? (grant!.merchants as unknown[]).filter((m): m is string => typeof m === 'string')
    : undefined;
  return {
    perPayment: pick(limits.per_payment, DEFAULT_AGENT_LIMITS.perPayment),
    daily: pick(limits.daily, DEFAULT_AGENT_LIMITS.daily),
    monthly: pick(limits.monthly, DEFAULT_AGENT_LIMITS.monthly),
    ...(merchants?.length ? { merchants } : {}),
  };
}

/** Limits the person sets on approval: dollars and cents, each under its maximum, payment ≤ day ≤ month. */
export function checkLimits(input: Partial<AgentLimits>): AgentLimits {
  const field = (key: keyof typeof MAX) => {
    const value = String(input[key] ?? '').trim();
    if (!AMOUNT.test(value) || Number(value) <= 0 || Number(value) > MAX[key]) {
      throw new BadRequestException(`${key} must be more than 0 and at most ${MAX[key]} dollars`);
    }
    return String(Number(value));
  };
  const limits: AgentLimits = {
    perPayment: field('perPayment'),
    daily: field('daily'),
    monthly: field('monthly'),
  };
  if (
    Number(limits.perPayment) > Number(limits.daily) ||
    Number(limits.daily) > Number(limits.monthly)
  ) {
    throw new BadRequestException('Limits must satisfy per payment ≤ daily ≤ monthly');
  }
  if (input.merchants?.length) {
    limits.merchants = input.merchants.map((m) => {
      const url = new URL(m);
      if (url.protocol !== 'https:') throw new BadRequestException(`${m} must be https`);
      return url.origin;
    });
  }
  return limits;
}

/**
 * The Turnkey policy on an agent's user in the person's wallet: sign USDC
 * `TransferWithAuthorization` on Base, for at most the per-payment limit, and
 * nothing else. Enforced by Turnkey, so even billing cannot make the agent's
 * key sign a larger payment, a transaction or any other message.
 */
export function agentPolicy(input: { turnkeyUserId: string; perPayment: string; name: string }) {
  return {
    policyName: `INITE agent: ${input.name}`.slice(0, 100),
    effect: 'EFFECT_ALLOW',
    consensus: `approvers.any(user, user.id == '${input.turnkeyUserId}')`,
    condition: [
      "activity.type == 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2'",
      "activity.params.encoding == 'PAYLOAD_ENCODING_EIP712'",
      "eth.eip_712.domain.name == 'USD Coin'",
      `eth.eip_712.domain.chain_id == ${CHAINS.BASE.evm!.chainId}`,
      `eth.eip_712.domain.verifying_contract == '${usdcAddress().toLowerCase()}'`,
      "eth.eip_712.primary_type == 'TransferWithAuthorization'",
      `eth.eip_712.message['value'] <= ${usdc(input.perPayment)}`,
    ].join(' && '),
    notes: 'Made by INITE billing when the wallet owner approved this agent with their passkey.',
  };
}

/** The most one INITE checkout payment may be, whatever a site's limit says. */
export const CHECKOUT_MAX_PAYMENT = String(MAX.perPayment);

/**
 * The Turnkey policy on a wallet's "INITE checkout" user: sign USDC
 * `TransferWithAuthorization` on Base to INITE billing's receiving wallet, and
 * nothing else. Sites the person allowed are charged through it; whatever a
 * site or billing does, this key can pay only INITE checkout invoices.
 */
export function checkoutPolicy(input: { turnkeyUserId: string; receiver: string }) {
  return {
    policyName: 'INITE checkout: pay INITE invoices',
    effect: 'EFFECT_ALLOW',
    consensus: `approvers.any(user, user.id == '${input.turnkeyUserId}')`,
    condition: [
      "activity.type == 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2'",
      "activity.params.encoding == 'PAYLOAD_ENCODING_EIP712'",
      "eth.eip_712.domain.name == 'USD Coin'",
      `eth.eip_712.domain.chain_id == ${CHAINS.BASE.evm!.chainId}`,
      `eth.eip_712.domain.verifying_contract == '${usdcAddress().toLowerCase()}'`,
      "eth.eip_712.primary_type == 'TransferWithAuthorization'",
      `eth.eip_712.message['to'] == '${input.receiver.toLowerCase()}'`,
      `eth.eip_712.message['value'] <= ${usdc(CHECKOUT_MAX_PAYMENT)}`,
    ].join(' && '),
    notes:
      'Made by INITE billing when the wallet owner allowed sites to charge it, with their passkey.',
  };
}
