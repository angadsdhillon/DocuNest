import 'server-only';

import { timingSafeEqual } from 'node:crypto';

/** Header the Cloudflare Worker sends on every call to this webhook. */
export const INBOUND_WORKER_SHARED_SECRET_HEADER = 'x-inbound-worker-secret';

/**
 * Constant-time comparison so response timing can't be used to guess the
 * secret one byte at a time. `timingSafeEqual` throws if the two buffers
 * differ in length, so that case is checked separately first — a length
 * mismatch is safe to short-circuit on, since it leaks nothing more than
 * "wrong", the same as any other mismatch.
 */
export function isValidSharedSecret(
  providedSecret: string | null,
  expectedSecret: string,
): boolean {
  if (!providedSecret) {
    return false;
  }

  const provided = Buffer.from(providedSecret, 'utf8');
  const expected = Buffer.from(expectedSecret, 'utf8');

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
