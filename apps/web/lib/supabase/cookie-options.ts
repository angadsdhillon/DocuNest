import type { CookieOptions } from '@supabase/ssr';

import { getIsProduction } from '@/lib/env';

/**
 * Cookie flags applied to every Supabase auth cookie this app writes.
 *
 * `@supabase/ssr` ships `httpOnly: false` in its own DEFAULT_COOKIE_OPTIONS
 * (see node_modules/@supabase/ssr/dist/module/utils/constants.js) so that a
 * browser-side Supabase client can read the session out of `document.cookie`.
 * We override it, because a session token readable by JavaScript is a session
 * token stealable by any injected script — not acceptable for a vault holding
 * tax forms and IDs.
 *
 * The consequence is deliberate and worth knowing before Phase 2: because the
 * browser cannot read these cookies, `createBrowserClient()` will never see a
 * session. Every authenticated read or write therefore has to go through a
 * Server Component, Server Action, or Route Handler. Do not "fix" a client
 * component that can't see the user by turning `httpOnly` off.
 *
 * `secure` is off in local development only, because `http://localhost` would
 * otherwise refuse to store the cookie at all.
 */
export function getAuthCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: getIsProduction(),
    sameSite: 'lax',
    path: '/',
  };
}
