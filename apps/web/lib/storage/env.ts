import 'server-only';

import { z } from 'zod';

/**
 * File-storage secrets. Kept in a module separate from `lib/env.ts` (which
 * only validates the three `NEXT_PUBLIC_*` values) so it is obvious at a
 * glance that nothing here may ever be imported from client code — the
 * `server-only` import above makes that a build error, not just a
 * convention, if anyone tries.
 */
const storageEnvironmentSchema = z.object({
  R2_ACCOUNT_ID: z.string().min(1, 'R2_ACCOUNT_ID is required'),
  R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
  R2_BUCKET_NAME: z.string().min(1, 'R2_BUCKET_NAME is required'),
  R2_ENDPOINT: z.url(
    'R2_ENDPOINT must be a full URL, e.g. https://<account id>.r2.cloudflarestorage.com',
  ),
  DOCUMENT_ENCRYPTION_MASTER_KEY: z
    .string()
    .min(1, 'DOCUMENT_ENCRYPTION_MASTER_KEY is required'),
});

export type StorageEnvironment = z.infer<typeof storageEnvironmentSchema>;

let cachedStorageEnvironment: StorageEnvironment | null = null;

export function getStorageEnvironment(): StorageEnvironment {
  if (cachedStorageEnvironment) {
    return cachedStorageEnvironment;
  }

  const parsed = storageEnvironmentSchema.safeParse({
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    DOCUMENT_ENCRYPTION_MASTER_KEY: process.env.DOCUMENT_ENCRYPTION_MASTER_KEY,
  });

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => issue.message)
      .join('; ');
    throw new Error(
      `Missing or invalid file-storage environment variables in apps/web/.env.local — ${problems}`,
    );
  }

  cachedStorageEnvironment = parsed.data;
  return cachedStorageEnvironment;
}
