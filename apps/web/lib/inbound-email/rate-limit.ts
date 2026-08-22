import 'server-only';

import { getQueueEnvironment } from '@/lib/queue/env';

const ONE_HOUR_SECONDS = 60 * 60;

export type HourlyRateLimitResult = {
  isAllowed: boolean;
};

/**
 * A rolling-hour counter per inbound token, backed by Upstash's REST API
 * (reusing the same `UPSTASH_REDIS_REST_URL`/`_TOKEN` already configured for
 * BullMQ in `lib/queue/env.ts` — one Redis, two unrelated uses of it) rather
 * than the in-memory `consumeRateLimit` used elsewhere in this app. That
 * in-memory limiter is explicitly documented as not shared across server
 * instances; this endpoint has no user session to fall back on as a second
 * line of defense, so a spam flood hitting a leaked token needs a limit
 * that actually holds across every instance.
 *
 * Protects against a flood of *attachments*, not a flood of emails — an
 * email with five qualifying attachments consumes five of this hour's
 * allowance, which is the right unit to bound: it's attachments that cost
 * storage and OpenAI calls downstream.
 *
 * Fails OPEN on a Redis error: an outage here must not silently start
 * bouncing or dropping legitimate mail. The per-attachment type/size/quota
 * checks still apply regardless, so a Redis outage only means this one
 * layer of flood protection is temporarily unavailable, not that anything
 * unsafe gets through.
 */
export async function consumeHourlyAttachmentRateLimit(
  inboundToken: string,
  maxAttachmentsPerHour: number,
): Promise<HourlyRateLimitResult> {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } =
    getQueueEnvironment();
  const key = `inbound-email-attachments:${inboundToken}`;

  try {
    const incrResponse = await fetch(
      `${UPSTASH_REDIS_REST_URL}/incr/${encodeURIComponent(key)}`,
      { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } },
    );

    if (!incrResponse.ok) {
      throw new Error(`Upstash INCR responded with ${incrResponse.status}`);
    }

    const { result: countAfterIncrement } = (await incrResponse.json()) as {
      result: number;
    };

    if (countAfterIncrement === 1) {
      // First hit of this hour for this token — start its expiry now.
      // Best-effort: if this call fails, the key never expires and this
      // token is over-strictly rate-limited until a process restart clears
      // nothing (Redis keys don't expire on their own without this), which
      // is a safer failure mode than under-limiting.
      await fetch(
        `${UPSTASH_REDIS_REST_URL}/expire/${encodeURIComponent(key)}/${ONE_HOUR_SECONDS}`,
        { headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` } },
      ).catch((error) => {
        console.error(
          '[inbound-email] failed to set rate-limit key expiry',
          error,
        );
      });
    }

    return { isAllowed: countAfterIncrement <= maxAttachmentsPerHour };
  } catch (error) {
    console.error(
      '[inbound-email] rate limit check failed, failing open',
      error,
    );
    return { isAllowed: true };
  }
}
