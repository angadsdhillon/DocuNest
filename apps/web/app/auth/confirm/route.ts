import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { ROUTES, sanitizeRedirectPath } from '@/lib/auth/routes';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Where the link in a Supabase confirmation email lands.
 *
 * Supabase sends one of two shapes depending on how the project's email
 * templates are configured, so both are handled:
 *   - `?code=...`        the PKCE flow, which the default templates produce
 *   - `?token_hash=&type=` the token-hash flow, produced by templates that use
 *                          `{{ .TokenHash }}`
 *
 * The library's own type for `type` accepts any string, so it is checked
 * against an explicit allowlist here rather than trusted from the query string.
 */
const EMAIL_OTP_TYPES = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
] as const;

type EmailOtpTypeName = (typeof EMAIL_OTP_TYPES)[number];

export async function GET(request: NextRequest): Promise<never> {
  const { searchParams } = new URL(request.url);
  const destination = sanitizeRedirectPath(searchParams.get('next'));

  if (await confirmEmail(searchParams)) {
    redirect(destination);
  }

  redirect(`${ROUTES.login}?notice=confirm-failed`);
}

async function confirmEmail(searchParams: URLSearchParams): Promise<boolean> {
  const supabase = createSupabaseServerClient();
  const code = searchParams.get('code');

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error(
        `[auth] email confirmation failed (code=${error.code ?? 'none'})`,
      );
      return false;
    }

    return true;
  }

  const tokenHash = searchParams.get('token_hash');
  const otpType = searchParams.get('type');

  if (!tokenHash || !getIsEmailOtpType(otpType)) {
    return false;
  }

  const { error } = await supabase.auth.verifyOtp({
    type: otpType,
    token_hash: tokenHash,
  });

  if (error) {
    console.error(
      `[auth] email confirmation failed (code=${error.code ?? 'none'})`,
    );
    return false;
  }

  return true;
}

function getIsEmailOtpType(value: string | null): value is EmailOtpTypeName {
  return (
    value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value)
  );
}
