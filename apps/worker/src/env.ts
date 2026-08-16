import { z } from 'zod';

/**
 * The worker is a standalone Node process (not Next.js), so it reads its
 * environment the plain Node way — nothing here is `NEXT_PUBLIC_*`-gated,
 * but the variable *names* deliberately match `.env.example` /
 * `apps/web/.env.local` wherever the value is the same secret shared across
 * both processes (the Supabase project URL, the R2 credentials, the
 * document encryption master key), so one value never has two names in the
 * codebase.
 */
const workerEnvironmentSchema = z.object({
  // Supabase — service role, because the worker runs with no user session
  // and must read/write across every user's documents and categories.
  NEXT_PUBLIC_SUPABASE_URL: z.url('NEXT_PUBLIC_SUPABASE_URL is required'),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  // Cloudflare R2 — same bucket/credentials the web app uploads through.
  R2_ACCOUNT_ID: z.string().min(1, 'R2_ACCOUNT_ID is required'),
  R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
  R2_BUCKET_NAME: z.string().min(1, 'R2_BUCKET_NAME is required'),
  R2_ENDPOINT: z.url('R2_ENDPOINT must be a full URL'),
  DOCUMENT_ENCRYPTION_MASTER_KEY: z
    .string()
    .min(1, 'DOCUMENT_ENCRYPTION_MASTER_KEY is required'),

  // Job queue
  UPSTASH_REDIS_REST_URL: z.url('UPSTASH_REDIS_REST_URL is required'),
  UPSTASH_REDIS_REST_TOKEN: z
    .string()
    .min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),

  // AI classification
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  // Cheapest current "nano"-tier OpenAI model as of writing this phase —
  // kept as an env var, not a literal, specifically so this can be changed
  // without a code change as pricing/models shift over time.
  OPENAI_CLASSIFICATION_MODEL: z.string().min(1).default('gpt-5-nano'),

  // Virus scanning — a ClamAV daemon (`clamd`) reachable over TCP, run as a
  // sidecar process next to the worker. See `src/processing/virus-scan.ts`
  // for what happens when it can't be reached.
  CLAMAV_HOST: z.string().min(1).default('127.0.0.1'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  CLAMAV_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

let cachedEnvironment: WorkerEnvironment | null = null;

export function getWorkerEnvironment(): WorkerEnvironment {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }

  const parsed = workerEnvironmentSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => issue.message)
      .join('; ');
    throw new Error(
      `Missing or invalid worker environment variables — ${problems}`,
    );
  }

  cachedEnvironment = parsed.data;
  return cachedEnvironment;
}
