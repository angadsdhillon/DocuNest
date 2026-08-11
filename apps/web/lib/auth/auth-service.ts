import type { AuthError } from '@supabase/supabase-js';

import { ROUTES } from '@/lib/auth/routes';
import type { Credentials } from '@/lib/auth/validation';
import { getEnvironment } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type AuthOutcome =
  | { status: 'signed-in' }
  | { status: 'email-confirmation-required' }
  | { status: 'error'; message: string; field?: keyof Credentials };

const GENERIC_FAILURE_MESSAGE =
  'Something went wrong on our side. Please try again in a moment.';

/**
 * Creates an account. Supabase Auth is the enforcement point: it applies the
 * project's own password rules and rejects malformed addresses regardless of
 * what the form allowed through.
 *
 * When the project has email confirmation switched on, no session is issued
 * until the user clicks the link, so the caller must not treat a successful
 * call as "signed in".
 */
export async function signUpWithEmailAndPassword(
  credentials: Credentials,
): Promise<AuthOutcome> {
  const environment = getEnvironment();
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase.auth.signUp({
    email: credentials.email,
    password: credentials.password,
    options: {
      emailRedirectTo: `${environment.NEXT_PUBLIC_APP_URL}${ROUTES.emailConfirmCallback}`,
    },
  });

  if (error) {
    return mapSignUpError(error);
  }

  if (!data.session) {
    return { status: 'email-confirmation-required' };
  }

  return { status: 'signed-in' };
}

export async function signInWithEmailAndPassword(
  credentials: Credentials,
): Promise<AuthOutcome> {
  const supabase = createSupabaseServerClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });

  if (error) {
    return mapSignInError(error);
  }

  return { status: 'signed-in' };
}

/**
 * Ends the session on this device: Supabase revokes this session's refresh
 * token and `@supabase/ssr` clears the auth cookies through the same cookie
 * adapter that set them.
 *
 * Scope is `local` on purpose. The default, `global`, would also sign the user
 * out on their phone and every other device, which is not what a "Log out"
 * button is understood to mean.
 */
export async function signOutCurrentSession(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: 'local' });

  if (error) {
    logAuthFailure('signout', error);
  }
}

function mapSignUpError(error: AuthError): AuthOutcome {
  switch (error.code) {
    // Never confirm or deny that an address already has an account: that turns
    // the signup form into a tool for checking who uses DocuNest. The caller
    // shows the same "check your email" message it shows a real new signup.
    case 'user_already_exists':
    case 'email_exists':
      return { status: 'email-confirmation-required' };

    case 'weak_password':
      return {
        status: 'error',
        field: 'password',
        message: 'That password is too easy to guess. Try a longer one.',
      };

    case 'email_address_invalid':
    case 'validation_failed':
      return {
        status: 'error',
        field: 'email',
        message:
          'That email address was not accepted. Please check it and try again.',
      };

    case 'signup_disabled':
      return {
        status: 'error',
        message:
          'New accounts are temporarily unavailable. Please try again later.',
      };

    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return {
        status: 'error',
        message: 'Too many attempts. Please wait a minute and try again.',
      };

    default:
      logAuthFailure('signup', error);
      return { status: 'error', message: GENERIC_FAILURE_MESSAGE };
  }
}

function mapSignInError(error: AuthError): AuthOutcome {
  switch (error.code) {
    case 'invalid_credentials':
      return {
        status: 'error',
        message: 'That email and password do not match. Please try again.',
      };

    case 'email_not_confirmed':
      return {
        status: 'error',
        message:
          'Please confirm your email address first — check your inbox for the link we sent you.',
      };

    case 'user_banned':
      return {
        status: 'error',
        message: 'This account is not available. Please contact support.',
      };

    case 'over_request_rate_limit':
      return {
        status: 'error',
        message: 'Too many attempts. Please wait a minute and try again.',
      };

    default:
      logAuthFailure('signin', error);
      return { status: 'error', message: GENERIC_FAILURE_MESSAGE };
  }
}

/**
 * Logs only the error code and HTTP status. Email addresses, passwords and
 * provider payloads must never reach the logs.
 */
function logAuthFailure(operation: string, error: AuthError): void {
  console.error(
    `[auth] ${operation} failed (code=${error.code ?? 'none'}, status=${error.status ?? 'none'})`,
  );
}
