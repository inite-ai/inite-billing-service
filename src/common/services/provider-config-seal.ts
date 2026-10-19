import type { Prisma } from '@prisma/client';
import { isSealed, openKey, sealKey } from '../key-seal';

/**
 * A rail's `config` is its live credentials — the Stripe secret key, webhook
 * signing secrets, the Google service-account private key, payout tokens. It
 * is sealed whole at rest (key-seal.ts), stored as `{ "sealed": "sealed:v1:…" }`,
 * and opened on every read, here, in one place: the dozen adapters and
 * services that read a provider's config see the plain object as before.
 *
 * A config written before sealing is a plain object and reads as one; boot
 * seals it (key-seal-backfill.ts).
 */

const SEALED_MODELS = new Set(['PaymentProvider', 'PayoutProvider']);
const WRITE_ACTIONS = new Set(['create', 'update', 'upsert', 'createMany', 'updateMany']);

export function sealConfig(config: unknown, model: string): unknown {
  if (config === undefined || config === null || isSealedConfig(config)) return config;
  // Prisma.JsonNull / DbNull and other sentinels pass through untouched.
  if (typeof config === 'object' && !Array.isArray(config)) {
    const proto = Object.getPrototypeOf(config);
    if (proto !== Object.prototype && proto !== null) return config;
  }
  return { sealed: sealKey(JSON.stringify(config), model) };
}

export function openConfig(config: unknown, model: string): unknown {
  if (!isSealedConfig(config)) return config;
  return JSON.parse(openKey((config as { sealed: string }).sealed, model));
}

export function isSealedConfig(config: unknown): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const keys = Object.keys(config);
  const sealed = (config as Record<string, unknown>).sealed;
  return keys.length === 1 && typeof sealed === 'string' && isSealed(sealed);
}

function sealData(data: any, model: string) {
  if (!data || typeof data !== 'object') return;
  for (const row of Array.isArray(data) ? data : [data]) {
    if (row && 'config' in row) row.config = sealConfig(row.config, model);
  }
}

function openResult(result: any, model: string): any {
  if (Array.isArray(result)) return result.map((row) => openResult(row, model));
  if (result && typeof result === 'object' && 'config' in result) {
    return { ...result, config: openConfig(result.config, model) };
  }
  return result;
}

/** The Prisma middleware that seals provider configs on write and opens them on read. */
export const providerConfigSeal: Prisma.Middleware = async (params, next) => {
  const model = params.model;
  if (!model || !SEALED_MODELS.has(model)) return next(params);
  if (WRITE_ACTIONS.has(params.action) && params.args) {
    sealData(params.args.data, model);
    sealData(params.args.create, model);
    sealData(params.args.update, model);
  }
  return openResult(await next(params), model);
};
