/**
 * A small fixed-window rate limiter held in the Node process's memory.
 *
 * LIMITATION, READ BEFORE RELYING ON THIS: the counters live in one server
 * instance's memory. On Vercel, requests are spread across instances that each
 * keep their own counters and are recycled often, so a determined attacker can
 * get more attempts than `limit` suggests. It is a speed bump, not a boundary.
 *
 * The real boundary today is Supabase Auth's own server-side rate limiting,
 * which applies no matter what this app does. Phase 3 introduces Upstash Redis
 * (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) for the job queue —
 * when that lands, move this counter into Redis so every instance shares it.
 */

type WindowState = {
  attempts: number;
  resetAtMs: number;
};

const windows = new Map<string, WindowState>();

/** Stops a flood of unique keys from growing the map without bound. */
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult = {
  isAllowed: boolean;
  retryAfterSeconds: number;
};

export function consumeRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): RateLimitResult {
  const nowMs = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAtMs <= nowMs) {
    if (windows.size >= MAX_TRACKED_KEYS) {
      pruneExpiredWindows(nowMs);
    }

    windows.set(key, { attempts: 1, resetAtMs: nowMs + windowMs });
    return { isAllowed: true, retryAfterSeconds: 0 };
  }

  existing.attempts += 1;

  if (existing.attempts > maxAttempts) {
    return {
      isAllowed: false,
      retryAfterSeconds: Math.ceil((existing.resetAtMs - nowMs) / 1000),
    };
  }

  return { isAllowed: true, retryAfterSeconds: 0 };
}

function pruneExpiredWindows(nowMs: number): void {
  for (const [key, state] of windows) {
    if (state.resetAtMs <= nowMs) {
      windows.delete(key);
    }
  }
}
