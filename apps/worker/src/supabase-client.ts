import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@docunest/shared-types';

import { getWorkerEnvironment } from './env';

export type DocuNestServiceClient = SupabaseClient<Database>;

let cachedClient: DocuNestServiceClient | null = null;

/**
 * The worker has no user session — it processes every user's documents —
 * so it authenticates as `service_role`, which Row Level Security exempts
 * (Postgres's `BYPASSRLS`-equivalent behavior for Supabase's service key)
 * and which the Phase 1 grants give full read/write on `profiles`,
 * `categories` and `documents`. This key must never reach `apps/web` or any
 * client bundle — it only ever lives here, in the worker process.
 */
export function getSupabaseServiceClient(): DocuNestServiceClient {
  if (cachedClient) {
    return cachedClient;
  }

  const environment = getWorkerEnvironment();

  cachedClient = createClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  return cachedClient;
}
