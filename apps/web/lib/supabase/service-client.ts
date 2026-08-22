import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@docunest/shared-types';

import { getEnvironment } from '@/lib/env';
import { getInboundEmailEnvironment } from '@/lib/inbound-email/env';
import type { DocuNestSupabaseClient } from '@/lib/supabase/server';

let cachedClient: DocuNestSupabaseClient | null = null;

/**
 * DELIBERATE, NARROW EXCEPTION to the rule stated in `lib/env.ts` that
 * `SUPABASE_SERVICE_ROLE_KEY` never reaches `apps/web`.
 *
 * The Phase 4 inbound-email webhook is called server-to-server by the
 * Cloudflare Worker (authenticated by `INBOUND_WORKER_SHARED_SECRET`, not a
 * Supabase session) and must resolve an arbitrary recipient by their
 * `inbound_address_token`, check that user's storage quota, and insert a
 * `documents` row on their behalf — none of which Row Level Security can
 * authorize, because there is no `auth.uid()` for a request with no signed-in
 * user. The service-role key is the only way to do that lookup and write.
 *
 * This client is imported ONLY by `lib/inbound-email/*` modules and the
 * inbound-email route handlers — never by anything reachable from a user
 * session, and never returned in any response. If you're tempted to import
 * this from anywhere else, use the normal RLS-scoped
 * `createSupabaseServerClient()` instead.
 */
export function getSupabaseServiceClient(): DocuNestSupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const { NEXT_PUBLIC_SUPABASE_URL } = getEnvironment();
  const { SUPABASE_SERVICE_ROLE_KEY } = getInboundEmailEnvironment();

  cachedClient = createClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  return cachedClient;
}
