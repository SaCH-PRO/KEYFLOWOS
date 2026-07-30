import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison for secrets/HMAC signatures.
 *
 * Plain `a !== b` short-circuits on the first differing byte, leaking timing
 * information an attacker can use to recover a signature/secret byte-by-byte.
 * Use this for any comparison of a client-supplied signature against an
 * expected value (OAuth state HMACs, webhook signatures, tokens).
 *
 * Returns false (never throws) on length mismatch, so it is safe to call with
 * attacker-controlled input of arbitrary length.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
