import { lookup } from 'node:dns/promises';
import { lookup as lookupCallback } from 'node:dns';
import { Agent } from 'undici';
import { isIP } from 'node:net';
import { isPrivateAddress } from '../workers/ssrf-guard';
import { getAddress, isAddress } from 'viem';
import {
  Authorization,
  X402_HEADERS,
  X402_NETWORK,
  X402_NETWORK_V1,
  usdcAddress,
} from '../adapters/crypto/x402/protocol';

/** The most of a seller's answer billing reads and hands back to the agent. */
const MAX_BODY_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export class X402ClientError extends Error {}

/** What a seller asks for, in the one form billing pays: exact, USDC, Base. */
export interface PaymentTerms {
  version: 1 | 2;
  amount: bigint;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  description?: string;
  /** The seller's own entry, sent back as `accepted` (v2). */
  accepted: Record<string, unknown>;
}

export interface SellerResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

/**
 * Public internet addresses only. The one SSRF judgement billing has, so a
 * seller URL and a webhook URL cannot disagree about what is internal — the
 * copy that used to live here took `::ffff:7f00:1` (127.0.0.1 as `new URL`
 * spells it) for a public address.
 */
export function isPublicAddress(ip: string): boolean {
  return !isPrivateAddress(ip);
}

/**
 * A URL billing may call for an agent: https, a public host that does not
 * resolve into our own network. Billing makes the request from its servers,
 * so an agent must not be able to point it at anything internal.
 */
export async function checkSellerUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new X402ClientError('Not a URL');
  }
  if (url.protocol !== 'https:') throw new X402ClientError('Only https URLs can be paid');
  if (url.username || url.password) throw new X402ClientError('URLs with credentials are refused');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true, verbatim: true })
        .then((list) => list.map((a) => a.address))
        .catch(() => {
          throw new X402ClientError(`Cannot resolve ${host}`);
        });
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new X402ClientError('This address is not on the public internet');
  }
  return url;
}

/**
 * Connections to sellers check the address they actually connect to, not
 * only the one checkSellerUrl saw: a host that answers DNS with a public
 * address first and a private one next (DNS rebinding) is refused at connect.
 */
const sellerAgent = new Agent({
  connect: {
    lookup: (hostname, options, callback) =>
      lookupCallback(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error, '', 0);
        const list = (addresses as unknown as { address: string; family: number }[]) ?? [];
        const safe = list.filter((a) => isPublicAddress(a.address));
        if (safe.length === 0 || safe.length !== list.length) {
          return callback(new X402ClientError('This address is not on the public internet'), '', 0);
        }
        if ((options as { all?: boolean }).all) return callback(null, safe as any, 0);
        return callback(null, safe[0]!.address, safe[0]!.family);
      }),
  },
});

/** One request to the seller: no redirects followed, a timeout, a size cap, public addresses only. */
export async function callSeller(
  url: URL,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<SellerResponse> {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    // @ts-expect-error Node's fetch takes an undici dispatcher; DOM typings don't know it
    dispatcher: sellerAgent,
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => (headers[name.toLowerCase()] = value));
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return {
    status: response.status,
    headers,
    body: Buffer.concat(chunks).toString('utf8'),
    truncated,
  };
}

function decodeBase64Json(value: string | undefined): any {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * The terms in a 402: v2 from `PAYMENT-REQUIRED`, v1 from the JSON body. Only
 * the `exact` scheme in USDC on Base is taken; anything else is reported, not
 * paid.
 */
export function readTerms(response: SellerResponse): PaymentTerms {
  const v2 = decodeBase64Json(response.headers[X402_HEADERS.required.toLowerCase()]);
  let v1: any = null;
  if (!v2) {
    try {
      v1 = JSON.parse(response.body);
    } catch {
      v1 = null;
    }
  }
  const version: 1 | 2 = v2 ? 2 : 1;
  const accepts: any[] = (v2 ?? v1)?.accepts ?? [];
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new X402ClientError('The site asked for payment but gave no x402 terms');
  }
  const usdc = usdcAddress().toLowerCase();
  const entry = accepts.find(
    (a) =>
      a?.scheme === 'exact' &&
      (a?.network === X402_NETWORK || a?.network === X402_NETWORK_V1) &&
      String(a?.asset ?? '').toLowerCase() === usdc,
  );
  if (!entry) {
    throw new X402ClientError(
      'The site does not take USDC on Base, which is what the wallet holds',
    );
  }
  const amount = String(entry.amount ?? entry.maxAmountRequired ?? '');
  if (!/^\d{1,30}$/.test(amount) || BigInt(amount) === 0n) {
    throw new X402ClientError('The site asked for no valid amount');
  }
  if (!isAddress(String(entry.payTo ?? ''), { strict: false })) {
    throw new X402ClientError('The site named no valid recipient');
  }
  const timeout = Number(entry.maxTimeoutSeconds);
  return {
    version,
    amount: BigInt(amount),
    payTo: getAddress(entry.payTo),
    maxTimeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 3600) : 300,
    description: entry.description ?? v2?.resource?.description,
    accepted: entry,
  };
}

/** The payment header to repeat the request with. */
export function paymentHeader(
  terms: PaymentTerms,
  authorization: Authorization,
  signature: `0x${string}`,
): Record<string, string> {
  const payload = {
    signature,
    authorization: {
      from: authorization.from,
      to: authorization.to,
      value: authorization.value.toString(),
      validAfter: authorization.validAfter.toString(),
      validBefore: authorization.validBefore.toString(),
      nonce: authorization.nonce,
    },
  };
  const body =
    terms.version === 2
      ? { x402Version: 2, accepted: terms.accepted, payload }
      : { x402Version: 1, scheme: 'exact', network: X402_NETWORK_V1, payload };
  const value = Buffer.from(JSON.stringify(body)).toString('base64');
  return terms.version === 2
    ? { [X402_HEADERS.signature]: value }
    : { [X402_HEADERS.v1Payment]: value };
}

/** The seller's settlement answer, if it sent one: its transaction hash. */
export function settledTransaction(response: SellerResponse): string | null {
  const settled =
    decodeBase64Json(response.headers[X402_HEADERS.response.toLowerCase()]) ??
    decodeBase64Json(response.headers[X402_HEADERS.v1Response.toLowerCase()]);
  const tx = settled?.transaction;
  return typeof tx === 'string' && /^0x[0-9a-fA-F]{64}$/.test(tx) ? tx : null;
}
