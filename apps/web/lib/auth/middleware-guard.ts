import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getIsAuthPath, getIsProtectedPath, ROUTES } from '@/lib/auth/routes';
import { resolveSessionForRequest } from '@/lib/supabase/middleware-client';

/**
 * Runs on every matched request: refreshes the Supabase session, then decides
 * whether the request is allowed to continue.
 *
 * This is the checkpoint that always runs, so it is where route protection
 * belongs. Individual pages still verify the user themselves — middleware is
 * the gate, not the only lock.
 */
export async function guardRequest(
  request: NextRequest,
): Promise<NextResponse> {
  const { response, userId } = await resolveSessionForRequest(request);
  const { pathname, search } = request.nextUrl;

  if (getIsProtectedPath(pathname) && !userId) {
    const loginUrl = new URL(ROUTES.login, request.url);
    loginUrl.searchParams.set('redirectTo', `${pathname}${search}`);
    return redirectKeepingCookies(loginUrl, response);
  }

  if (getIsAuthPath(pathname) && userId) {
    return redirectKeepingCookies(
      new URL(ROUTES.dashboard, request.url),
      response,
    );
  }

  return response;
}

/**
 * A redirect is a brand new response, so any auth cookie the session refresh
 * just wrote has to be copied across or the refreshed token is thrown away and
 * the user gets logged out at random.
 */
function redirectKeepingCookies(
  target: URL,
  sessionResponse: NextResponse,
): NextResponse {
  const redirectResponse = NextResponse.redirect(target);

  for (const cookie of sessionResponse.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }

  return redirectResponse;
}
