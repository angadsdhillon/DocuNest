import { createServerClient } from '@supabase/ssr';
import type { Database } from '@docunest/shared-types';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getEnvironment } from '@/lib/env';
import { getAuthCookieOptions } from '@/lib/supabase/cookie-options';

export type MiddlewareSessionResult = {
  /** Response carrying any refreshed auth cookies. Must be the one returned. */
  response: NextResponse;
  /** The signed-in user's id, or null when the request has no valid session. */
  userId: string | null;
};

/**
 * Reads the session from the request cookies, refreshing the access token when
 * it has expired, and reports who the request belongs to.
 *
 * Identity comes from `getClaims()`, which verifies the JWT signature against
 * the project's published keys. `getSession()` is not used here on purpose: it
 * returns whatever the cookie says without verifying it, so it can be forged.
 */
export async function resolveSessionForRequest(
  request: NextRequest,
): Promise<MiddlewareSessionResult> {
  const environment = getEnvironment();

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: getAuthCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, cacheHeaders) {
          // Refreshed cookies go onto the request as well, so Server
          // Components rendering this same request see the new token instead
          // of trying to refresh it a second time.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }

          // Stops a CDN from caching a response that carries somebody's
          // refreshed session cookie and serving it to the next visitor.
          for (const [header, value] of Object.entries(cacheHeaders)) {
            response.headers.set(header, value);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const subject = data?.claims?.sub;

  return {
    response,
    userId: typeof subject === 'string' ? subject : null,
  };
}
