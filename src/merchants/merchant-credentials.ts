import { BadRequestException } from '@nestjs/common';
import { openKey, sealKey } from '../common/key-seal';
import { RAILS } from '../common/connectors/rail';
import { CHAIN_IDS, isChainId, isValidAddress } from '../adapters/crypto/chains';

/**
 * The rails a merchant can bring its own account to. PIX, x402 and the INITE
 * wallet, the app stores and INITE's own lava.top/Hodle accounts are not here:
 * on those the money would pass through an account INITE holds.
 */
export const MERCHANT_RAILS = [RAILS.STRIPE, RAILS.LAVA, RAILS.YOOKASSA, RAILS.CRYPTO] as const;
export type MerchantRail = (typeof MERCHANT_RAILS)[number];

export function isMerchantRail(value: string): value is MerchantRail {
  return (MERCHANT_RAILS as readonly string[]).includes(value);
}

/** Where a provider sends a connection's notifications. */
export function merchantWebhookPath(connectionId: string): string {
  return `/v1/webhooks/merchant/${connectionId}`;
}

/** The webhook rail a connection's events are stored under: never a real rail's. */
export const MERCHANT_WEBHOOK_RAIL_PREFIX = 'MERCHANT:';

export function merchantWebhookRail(connectionId: string): string {
  return `${MERCHANT_WEBHOOK_RAIL_PREFIX}${connectionId}`;
}

export function connectionIdOfWebhookRail(rail: string): string | null {
  return rail.startsWith(MERCHANT_WEBHOOK_RAIL_PREFIX)
    ? rail.slice(MERCHANT_WEBHOOK_RAIL_PREFIX.length)
    : null;
}

/** The seal is bound to the connection's id: a blob copied to another row does not open. */
const aad = (connectionId: string) => `merchant-connection:${connectionId}`;

export function sealCredentials(connectionId: string, credentials: Record<string, unknown>) {
  return sealKey(JSON.stringify(credentials), aad(connectionId));
}

export function openCredentials(connectionId: string, sealed: string): Record<string, any> {
  return JSON.parse(openKey(sealed, aad(connectionId)));
}

function text(body: Record<string, unknown>, field: string, pattern: RegExp, required = true) {
  const value = body[field];
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequestException(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string' || !pattern.test(value.trim())) {
    // The value itself is never echoed: it may be a secret.
    throw new BadRequestException(`${field} is not in the expected format`);
  }
  return value.trim();
}

const last4 = (secret: string) => secret.slice(-4);

/**
 * The credentials a rail takes, checked for shape, and the hints that may be
 * shown for them. Unknown fields are dropped, never stored.
 */
export function parseCredentials(
  rail: MerchantRail,
  body: Record<string, unknown>,
): { credentials: Record<string, unknown>; hints: Record<string, unknown> } {
  switch (rail) {
    case RAILS.STRIPE: {
      if (body.connectAccountId !== undefined) {
        throw new BadRequestException('Stripe Connect is not available yet; send a secretKey');
      }
      const secretKey = text(body, 'secretKey', /^(sk|rk)_(live|test)_[A-Za-z0-9]{16,255}$/)!;
      const webhookSecret = text(body, 'webhookSecret', /^whsec_[A-Za-z0-9+/=]{16,255}$/, false);
      return {
        credentials: { secretKey, ...(webhookSecret ? { webhookSecret } : {}) },
        hints: {
          keyType: secretKey.startsWith('rk_') ? 'restricted' : 'secret',
          mode: secretKey.includes('_live_') ? 'live' : 'test',
          last4: last4(secretKey),
          webhookSecret: !!webhookSecret,
        },
      };
    }
    case RAILS.LAVA: {
      const apiKey = text(body, 'apiKey', /^[A-Za-z0-9._-]{16,255}$/)!;
      const webhookSecret = text(body, 'webhookSecret', /^\S{12,255}$/)!;
      const defaultOfferId = text(body, 'defaultOfferId', /^[A-Za-z0-9-]{8,64}$/)!;
      return {
        credentials: { apiKey, webhookSecret, defaultOfferId },
        hints: { last4: last4(apiKey), defaultOfferId, webhookSecret: true },
      };
    }
    case RAILS.YOOKASSA: {
      const shopId = text(body, 'shopId', /^\d{3,12}$/)!;
      const secretKey = text(body, 'secretKey', /^(live|test)_[A-Za-z0-9_-]{16,255}$/)!;
      return {
        credentials: { shopId, secretKey },
        hints: {
          shopId,
          mode: secretKey.startsWith('live_') ? 'live' : 'test',
          last4: last4(secretKey),
        },
      };
    }
    case RAILS.CRYPTO: {
      const raw = body.addresses;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new BadRequestException('addresses is required: { "<network>": "<address>" }');
      }
      const addresses: Record<string, string> = {};
      for (const [chain, address] of Object.entries(raw as Record<string, unknown>)) {
        if (!isChainId(chain)) {
          throw new BadRequestException(
            `Unknown network ${chain.slice(0, 20)}; one of ${CHAIN_IDS.join(', ')}`,
          );
        }
        if (typeof address !== 'string' || !isValidAddress(chain, address)) {
          throw new BadRequestException(`The ${chain} address is not an address on ${chain}`);
        }
        addresses[chain] = address.trim();
      }
      if (Object.keys(addresses).length === 0) {
        throw new BadRequestException('At least one address is required');
      }
      // A public address is not a secret: the hint is the address.
      return { credentials: { addresses }, hints: { addresses } };
    }
  }
}

/** Every secret string in a credentials object, to strip from any message. */
export function secretsOf(credentials: Record<string, unknown> | null | undefined): string[] {
  if (!credentials) return [];
  return ['secretKey', 'webhookSecret', 'apiKey']
    .map((k) => credentials[k])
    .filter((v): v is string => typeof v === 'string' && v.length >= 8);
}

const KEY_LIKE = /\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_]{8,}|\b(?:live|test)_[A-Za-z0-9_-]{16,}/g;

/** A provider's error, safe to store and show: no secret of ours, nothing key-shaped. */
export function redact(message: string, secrets: string[]): string {
  let out = String(message ?? '');
  for (const secret of secrets) out = out.split(secret).join('[redacted]');
  return out.replace(KEY_LIKE, '[redacted]').slice(0, 500);
}
