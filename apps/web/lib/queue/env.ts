import 'server-only';

import { z } from 'zod';

/**
 * Job-queue secrets, validated separately from `lib/env.ts` for the same
 * reason `lib/storage/env.ts` is separate: the `server-only` import makes it
 * a build error, not just a convention, for this module to ever reach
 * client code.
 */
const queueEnvironmentSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.url('UPSTASH_REDIS_REST_URL must be a full URL'),
  UPSTASH_REDIS_REST_TOKEN: z
    .string()
    .min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),
});

export type QueueEnvironment = z.infer<typeof queueEnvironmentSchema>;

let cachedQueueEnvironment: QueueEnvironment | null = null;

export function getQueueEnvironment(): QueueEnvironment {
  if (cachedQueueEnvironment) {
    return cachedQueueEnvironment;
  }

  const parsed = queueEnvironmentSchema.safeParse({
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => issue.message)
      .join('; ');
    throw new Error(
      `Missing or invalid job-queue environment variables in apps/web/.env.local — ${problems}`,
    );
  }

  cachedQueueEnvironment = parsed.data;
  return cachedQueueEnvironment;
}
