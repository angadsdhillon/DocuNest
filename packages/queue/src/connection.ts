import IORedis, { type Redis, type RedisOptions } from 'ioredis';

/**
 * BullMQ needs a real Redis-protocol (RESP) connection — it issues blocking
 * commands (e.g. `BLPOP`) that Upstash's HTTP/REST API does not support at
 * all. Upstash exposes the same database over both: the REST URL/token
 * pair, and a plain TCP/TLS endpoint at the same hostname on port 6379,
 * authenticated with that same token as the password (confirmed in
 * Upstash's own docs — the REST token *is* the RESP password for a given
 * database, not a separate credential).
 *
 * So rather than asking for yet another pair of environment variables, this
 * derives the `rediss://` connection string BullMQ needs directly from
 * `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — the two values the
 * project already standardized on in `.env.example`.
 */

export type QueueRedisEnv = {
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
};

const UPSTASH_TCP_PORT = 6379;

export function buildUpstashRedisConnectionString(
  env: QueueRedisEnv,
): string {
  let hostname: string;

  try {
    hostname = new URL(env.UPSTASH_REDIS_REST_URL).hostname;
  } catch {
    throw new Error(
      'UPSTASH_REDIS_REST_URL is not a valid URL (expected something like https://<name>.upstash.io).',
    );
  }

  return `rediss://default:${env.UPSTASH_REDIS_REST_TOKEN}@${hostname}:${UPSTASH_TCP_PORT}`;
}

/**
 * `maxRetriesPerRequest: null` and `enableReadyCheck: false` are BullMQ's
 * documented requirements for any connection passed to a `Queue` or
 * `Worker` — without them, BullMQ's blocking calls fail outright instead of
 * waiting/reconnecting as intended.
 */
const BULLMQ_REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

export function createQueueRedisConnection(env: QueueRedisEnv): Redis {
  const connectionString = buildUpstashRedisConnectionString(env);
  return new IORedis(connectionString, BULLMQ_REDIS_OPTIONS);
}
