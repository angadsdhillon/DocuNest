import type { NextRequest, NextResponse } from 'next/server';

import { guardRequest } from '@/lib/auth/middleware-guard';

export function middleware(request: NextRequest): Promise<NextResponse> {
  return guardRequest(request);
}

export const config = {
  /**
   * Runs on every page and API request except static assets. The session has to
   * be refreshed on ordinary page loads too, not just on protected ones, or a
   * token can expire while the user is reading a public page and log them out.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
};
