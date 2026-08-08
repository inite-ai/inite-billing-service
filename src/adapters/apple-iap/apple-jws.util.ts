import { X509Certificate } from 'crypto';
import { compactVerify, decodeProtectedHeader } from 'jose';
import { APPLE_ROOT_CA_G3_PEM } from './apple-root-ca';

/**
 * Verification of Apple-signed JWS (App Store Server Notifications V2
 * `signedPayload` and any StoreKit 2 signed data).
 *
 * Apple signs with ES256 and embeds the full certificate chain in the JWS
 * protected header's `x5c` field: `[leaf, intermediate(s)…, (root)]`. A valid
 * verification requires BOTH:
 *   1. the presented chain to terminate at a *pinned* Apple root (never a root
 *      supplied inside the token — that is attacker-controlled), with every link
 *      signed by the next and every certificate inside its validity window; and
 *   2. the JWS signature to verify against the leaf certificate's public key.
 *
 * Pinning Apple Root CA G3 specifically (the ECC root used for StoreKit /
 * App Store Server data) also excludes Apple developer/distribution certificates,
 * which chain to the older RSA "Apple Root CA" — so a certificate an attacker
 * legitimately holds cannot be repurposed to forge notifications.
 */

const DEFAULT_ROOTS: X509Certificate[] = [new X509Certificate(APPLE_ROOT_CA_G3_PEM)];

export interface AppleVerifyOptions {
  /** Trust anchors. Defaults to the pinned Apple Root CA G3. */
  roots?: X509Certificate[];
  /** When set, the decoded payload's bundleId must match (cross-app replay guard). */
  bundleId?: string;
  /** Reference time for validity checks (defaults to now). */
  now?: number;
}

export interface AppleVerifyResult {
  verified: boolean;
  /** The decoded JSON payload — only present when `verified` is true. */
  payload?: any;
  /** Why verification failed (for logging; never surfaced to the caller). */
  reason?: string;
}

/**
 * Verify an Apple compact JWS. Returns `{ verified: false }` (never throws) for
 * any malformed, untrusted, or badly-signed input so callers can fail closed.
 */
export async function verifyAppleSignedPayload(
  jws: unknown,
  opts: AppleVerifyOptions = {},
): Promise<AppleVerifyResult> {
  if (typeof jws !== 'string' || jws.split('.').length !== 3) {
    return { verified: false, reason: 'not a compact JWS' };
  }

  let header: { alg?: string; x5c?: unknown };
  try {
    header = decodeProtectedHeader(jws) as { alg?: string; x5c?: unknown };
  } catch {
    return { verified: false, reason: 'unparseable protected header' };
  }

  // Pin the algorithm — never let the token pick it (alg-confusion guard).
  if (header.alg !== 'ES256') {
    return { verified: false, reason: `unexpected alg: ${header.alg}` };
  }
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length < 2 || !x5c.every((c) => typeof c === 'string')) {
    // Apple always presents at least leaf + intermediate; a shorter chain (e.g. a
    // single self-signed cert) is a forgery attempt.
    return { verified: false, reason: 'missing or too-short x5c chain' };
  }

  const roots = opts.roots ?? DEFAULT_ROOTS;
  const now = opts.now ?? Date.now();

  const leaf = verifyCertChain(x5c as string[], roots, now);
  if (!leaf) {
    return { verified: false, reason: 'untrusted certificate chain' };
  }

  let payload: any;
  try {
    const result = await compactVerify(jws, leaf.publicKey, { algorithms: ['ES256'] });
    payload = JSON.parse(Buffer.from(result.payload).toString('utf8'));
  } catch {
    return { verified: false, reason: 'signature verification failed' };
  }

  if (opts.bundleId) {
    const payloadBundleId = payload?.data?.bundleId ?? payload?.bundleId;
    if (payloadBundleId && payloadBundleId !== opts.bundleId) {
      return { verified: false, reason: 'bundleId mismatch' };
    }
  }

  return { verified: true, payload };
}

/**
 * Verify the presented x5c chain and return the trusted leaf certificate, or
 * null if the chain is invalid or does not anchor to a pinned root.
 */
function verifyCertChain(
  x5c: string[],
  roots: X509Certificate[],
  now: number,
): X509Certificate | null {
  let certs: X509Certificate[];
  try {
    certs = x5c.map((b64) => new X509Certificate(Buffer.from(b64, 'base64')));
  } catch {
    return null;
  }

  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i];
    if (!withinValidity(cert, now)) return null;

    const issuer = i + 1 < certs.length ? certs[i + 1] : null;
    if (issuer) {
      // Each cert must be signed by the next one up the presented chain.
      if (!cert.verify(issuer.publicKey)) return null;
    } else {
      // Top of the presented chain: it must be signed by (or be identical to) a
      // PINNED root — this is what makes the whole chain trustworthy.
      const anchored = roots.some(
        (root) =>
          withinValidity(root, now) &&
          (Buffer.compare(cert.raw, root.raw) === 0 || cert.verify(root.publicKey)),
      );
      if (!anchored) return null;
    }
  }

  return certs[0];
}

function withinValidity(cert: X509Certificate, now: number): boolean {
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  return !Number.isNaN(from) && !Number.isNaN(to) && now >= from && now <= to;
}
