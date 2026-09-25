import { PrismaService } from '../../common/services/prisma.service';
import { CHAIN_IDS, ChainId, isValidAddress } from './chains';

export const CRYPTO_PROVIDER_CODE = 'CRYPTO';

export const DEFAULT_EXPIRY_MINUTES = 60;
/**
 * How long after an invoice's deadline a payment is still recognised.
 *
 * The deadline is for the customer's sake — a price shown for a limited time.
 * Money that arrives an hour late is still the customer's money, and a
 * blockchain transfer cannot be declined; turning it away would only move the
 * problem to a support ticket. So the amount stays reserved, and a transfer to
 * it still settles the order, for this long after the timer runs out.
 */
export const DEFAULT_LATE_GRACE_HOURS = 24;

export interface CryptoSettings {
  isActive: boolean;
  wallets: Partial<Record<ChainId, string>>;
  expiryMinutes: number;
  lateGraceHours: number;
  etherscanApiKey?: string;
  trongridApiKey?: string;
  toncenterApiKey?: string;
  solanaRpcUrl?: string;
  /** Shared secret for an external indexer posting to /webhooks/crypto. Optional. */
  webhookSecret?: string;
}

function positive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Read the rail's settings from `PaymentProvider.config`.
 *
 * A wallet that does not parse as an address on its chain is dropped rather
 * than used: an invoice pointing at it would take money nobody can spend.
 * Older configs kept a per-chain `rpcUrl` under `chains.<id>`; Solana's is
 * still honoured from there.
 */
export function parseCryptoSettings(
  provider: { isActive: boolean; config: unknown } | null,
): CryptoSettings | null {
  if (!provider) return null;
  const config = (provider.config as Record<string, any>) || {};
  const wallets: Partial<Record<ChainId, string>> = {};
  for (const chain of CHAIN_IDS) {
    const address = text(config.wallets?.[chain]);
    if (address && isValidAddress(chain, address)) wallets[chain] = address;
  }

  return {
    isActive: provider.isActive,
    wallets,
    expiryMinutes: positive(config.expiryMinutes, DEFAULT_EXPIRY_MINUTES),
    lateGraceHours: positive(config.lateGraceHours, DEFAULT_LATE_GRACE_HOURS),
    etherscanApiKey: text(config.etherscanApiKey),
    trongridApiKey: text(config.trongridApiKey),
    toncenterApiKey: text(config.toncenterApiKey),
    solanaRpcUrl: text(config.solanaRpcUrl) ?? text(config.chains?.SOL?.rpcUrl),
    webhookSecret: text(config.webhookSecret),
  };
}

export async function loadCryptoSettings(prisma: PrismaService): Promise<CryptoSettings | null> {
  const provider = await prisma.paymentProvider.findUnique({
    where: { code: CRYPTO_PROVIDER_CODE },
  });
  return parseCryptoSettings(provider);
}

/**
 * Whether the watcher can see payments on a chain with these settings.
 * Etherscan refuses keyless calls; the others work without a key, slower.
 */
export function watchable(settings: CryptoSettings, chain: ChainId): boolean {
  if (!settings.wallets[chain]) return false;
  if (chain === 'ETH') return !!settings.etherscanApiKey;
  return true;
}

/**
 * Whether a chain can be offered at checkout: it has a wallet, and something
 * will notice a payment to it — the watcher, or an external indexer.
 * Offering a chain nobody watches would take the customer's money and leave
 * their order open.
 */
export function payable(settings: CryptoSettings, chain: ChainId): boolean {
  if (!settings.wallets[chain]) return false;
  return watchable(settings, chain) || !!settings.webhookSecret;
}
