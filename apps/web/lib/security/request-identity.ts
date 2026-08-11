import { headers } from 'next/headers';

/**
 * Best-effort caller identity for rate limiting.
 *
 * Behind Vercel the left-most entry of `x-forwarded-for` is the real client.
 * These headers are spoofable when the app is not behind a trusted proxy, so
 * the value is only ever used to bucket rate-limit counters — never for
 * authorisation, and never written to a database row.
 */
export function getRequestClientKey(): string {
  const requestHeaders = headers();

  const forwardedFor = requestHeaders.get('x-forwarded-for');

  if (forwardedFor) {
    const firstAddress = forwardedFor.split(',')[0]?.trim();

    if (firstAddress) {
      return firstAddress;
    }
  }

  return requestHeaders.get('x-real-ip') ?? 'unknown-client';
}
