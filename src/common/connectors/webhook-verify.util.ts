import * as crypto from 'crypto';

/**
 * Constant-time string compare that does not leak length via early return.
 * When lengths differ it still performs a fixed-size digest comparison before
 * returning false, so timing is independent of where the mismatch is.
 * (Moved verbatim from webhooks.controller so connectors can verify inline.)
 */
export function safeTimingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    const hashA = crypto.createHash('sha256').update(bufA).digest();
    const hashB = crypto.createHash('sha256').update(bufB).digest();
    crypto.timingSafeEqual(hashA, hashB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
