import * as crypto from 'crypto';

/**
 * Constant-time string compare that does not return early on a length
 * mismatch.
 *
 * Both values are copied into buffers of the same length and compared with
 * `timingSafeEqual`, so the time taken does not depend on where they differ;
 * the lengths are compared afterwards. It used to hash both sides to equalise
 * lengths, which does the same job but reads — to a scanner, and to a reviewer
 * — like hashing a password with a fast hash; there is nothing to hash here.
 */
export function safeTimingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  const length = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(length);
  const paddedB = Buffer.alloc(length);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  const same = crypto.timingSafeEqual(paddedA, paddedB);
  return same && bufA.length === bufB.length;
}
