import { z } from 'zod';

/**
 * Environment variables the web app needs, validated once at first use so a
 * missing value fails with a readable message instead of a confusing crash
 * deep inside the Supabase client.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is deliberately absent: nothing in `apps/web`
 * may use it. Service-role work belongs in `apps/worker`.
 */
const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(
    'NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. https://abcd.supabase.co',
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY looks too short to be a real key'),
  NEXT_PUBLIC_APP_URL: z.url(
    'NEXT_PUBLIC_APP_URL must be a full URL, e.g. http://localhost:3000',
  ),
});

export type WebEnvironment = z.infer<typeof environmentSchema>;

let cachedEnvironment: WebEnvironment | null = null;

export function getEnvironment(): WebEnvironment {
  if (cachedEnvironment) {
    return cachedEnvironment;
  }

  const parsed = environmentSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  });

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => issue.message)
      .join('; ');
    throw new Error(
      `Missing or invalid environment variables in apps/web/.env.local — ${problems}`,
    );
  }

  cachedEnvironment = parsed.data;
  return cachedEnvironment;
}

export function getIsProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
