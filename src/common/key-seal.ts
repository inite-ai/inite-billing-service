import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Private keys at rest: sealed with AES-256-GCM under KEY_SEAL_SECRET, so a
 * database dump, a backup or a read replica holds nothing that can sign.
 *
 * Billing keeps two kinds of private key — the relayer's Turnkey API key and
 * the keys it holds for agents' wallets — and each one is what moves money.
 * The sealed form is `sealed:v1:<iv>:<tag>:<ciphertext>` (base64url), bound to
 * the key's public half, so a sealed private key copied onto another row does
 * not open there.
 *
 * A row written before sealing holds the bare hex key; `openKey` still reads
 * it, and `sealLegacyKeys` (run at boot) seals every such row once.
 */

const PREFIX = 'sealed:v1:';
const TEST_SECRET = createHash('sha256').update('inite-billing-test-key-seal').digest();

function secret(): Buffer {
  const raw = process.env.KEY_SEAL_SECRET;
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error('KEY_SEAL_SECRET must be 32 bytes, base64-encoded');
    }
    return key;
  }
  if (process.env.NODE_ENV === 'test') return TEST_SECRET;
  throw new Error(
    'KEY_SEAL_SECRET is not set: billing will not keep or use a private key it cannot seal',
  );
}

/** Is a seal secret available? Without one, nothing is sealed or opened. */
export function canSeal(): boolean {
  try {
    secret();
    return true;
  } catch {
    return false;
  }
}

export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/** Seal a private key, bound to its public half. */
export function sealKey(privateKey: string, publicKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret(), iv);
  cipher.setAAD(Buffer.from(publicKey));
  const body = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  return (
    PREFIX + [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join(':')
  );
}

/** The private key a row holds, sealed or (written before sealing) bare. */
export function openKey(stored: string, publicKey: string): string {
  if (!isSealed(stored)) return stored;
  const [iv, tag, body] = stored
    .slice(PREFIX.length)
    .split(':')
    .map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !body) throw new Error('A sealed key is malformed');
  const decipher = createDecipheriv('aes-256-gcm', secret(), iv);
  decipher.setAAD(Buffer.from(publicKey));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

interface KeyRows {
  x402RelayerKey: {
    findMany(args: object): Promise<{ id: string; publicKey: string; privateKey: string }[]>;
    updateMany(args: object): Promise<{ count: number }>;
  };
  wallet: {
    findMany(
      args: object,
    ): Promise<{ id: string; ownerKey: string | null; ownerPrivateKey: string | null }[]>;
    updateMany(args: object): Promise<{ count: number }>;
  };
}

/**
 * Seal every private key still stored bare. Each row is rewritten only if it
 * still holds the bare key it was read with, so replicas booting together
 * cannot seal one twice. Returns how many rows were sealed.
 */
export async function sealLegacyKeys(prisma: KeyRows): Promise<number> {
  let sealed = 0;
  const relayers = await prisma.x402RelayerKey.findMany({
    where: { NOT: { privateKey: { startsWith: PREFIX } } },
    select: { id: true, publicKey: true, privateKey: true },
  });
  for (const row of relayers) {
    const { count } = await prisma.x402RelayerKey.updateMany({
      where: { id: row.id, privateKey: row.privateKey },
      data: { privateKey: sealKey(row.privateKey, row.publicKey) },
    });
    sealed += count;
  }
  const wallets = await prisma.wallet.findMany({
    where: { ownerPrivateKey: { not: null }, NOT: { ownerPrivateKey: { startsWith: PREFIX } } },
    select: { id: true, ownerKey: true, ownerPrivateKey: true },
  });
  for (const row of wallets) {
    if (!row.ownerKey || !row.ownerPrivateKey) continue;
    const { count } = await prisma.wallet.updateMany({
      where: { id: row.id, ownerPrivateKey: row.ownerPrivateKey },
      data: { ownerPrivateKey: sealKey(row.ownerPrivateKey, row.ownerKey) },
    });
    sealed += count;
  }
  return sealed;
}

interface ConfigRows {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
  paymentProvider: { update(args: object): Promise<unknown> };
  payoutProvider: { update(args: object): Promise<unknown> };
}

/**
 * Seal every rail config still stored as a plain object. The raw read sees
 * what is on disk; the write goes through PrismaService, whose middleware
 * (provider-config-seal.ts) seals it. Returns how many configs were sealed.
 */
export async function sealLegacyConfigs(prisma: ConfigRows): Promise<number> {
  let sealed = 0;
  for (const [table, model] of [
    ['payment_providers', 'paymentProvider'],
    ['payout_providers', 'payoutProvider'],
  ] as const) {
    const rows = await prisma.$queryRawUnsafe<{ id: string; config: unknown }[]>(
      `SELECT id, config FROM "billing"."${table}"
        WHERE config IS NOT NULL AND config <> '{}'::jsonb
          AND NOT (jsonb_typeof(config) = 'object' AND config ? 'sealed'
                   AND (SELECT count(*) FROM jsonb_object_keys(config)) = 1)`,
    );
    for (const row of rows) {
      await prisma[model].update({ where: { id: row.id }, data: { config: row.config } });
      sealed += 1;
    }
  }
  return sealed;
}
