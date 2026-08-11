import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@docunest/shared-types';
import { cookies } from 'next/headers';

import { getEnvironment } from '@/lib/env';
import { getAuthCookieOptions } from '@/lib/supabase/cookie-options';

export type DocuNestSupabaseClient = SupabaseClient<Database>;

/**
 * Creates a request-scoped Supabase client for Server Components, Server
 * Actions and Route Handlers. Never cache or reuse the returned client across
 * requests — it is bound to one request's cookies.
 */
export function createSupabaseServerClient(): DocuNestSupabaseClient {
  const environment = getEnvironment();
  const cookieStore = cookies();

  return createServerClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: getAuthCookieOptions(),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components are not allowed to write cookies. The auth
            // middleware refreshes the session on every request, so a refresh
            // that lands here can safely be dropped.
          }
        },
      },
    },
  );
}
