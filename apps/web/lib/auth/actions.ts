'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  signInWithEmailAndPassword,
  signOutCurrentSession,
  signUpWithEmailAndPassword,
} from '@/lib/auth/auth-service';
import type { AuthFormState } from '@/lib/auth/form-state';
import { ROUTES, sanitizeRedirectPath } from '@/lib/auth/routes';
import {
  readCredentialsFromForm,
  validateCredentials,
} from '@/lib/auth/validation';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { getRequestClientKey } from '@/lib/security/request-identity';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_SIGNUP_ATTEMPTS_PER_WINDOW = 5;
const MAX_LOGIN_ATTEMPTS_PER_WINDOW = 10;

const TOO_MANY_ATTEMPTS_MESSAGE =
  'Too many attempts from this connection. Please wait a few minutes and try again.';

export async function signUpAction(formData: FormData): Promise<AuthFormState> {
  const rateLimit = consumeRateLimit(
    `signup:${getRequestClientKey()}`,
    MAX_SIGNUP_ATTEMPTS_PER_WINDOW,
    RATE_LIMIT_WINDOW_MS,
  );

  if (!rateLimit.isAllowed) {
    return {
      formError: TOO_MANY_ATTEMPTS_MESSAGE,
      fieldErrors: {},
      notice: null,
    };
  }

  const credentials = readCredentialsFromForm(formData);
  const validation = validateCredentials(credentials);

  if (!validation.isValid) {
    return {
      formError: null,
      fieldErrors: validation.fieldErrors,
      notice: null,
    };
  }

  const outcome = await signUpWithEmailAndPassword(credentials);

  if (outcome.status === 'error') {
    return {
      formError: outcome.field ? null : outcome.message,
      fieldErrors: outcome.field ? { [outcome.field]: outcome.message } : {},
      notice: null,
    };
  }

  if (outcome.status === 'email-confirmation-required') {
    return {
      formError: null,
      fieldErrors: {},
      notice:
        'Almost there — check your email for a link to confirm your address, then sign in.',
    };
  }

  redirect(sanitizeRedirectPath(readRedirectTarget(formData)));
}

export async function signInAction(formData: FormData): Promise<AuthFormState> {
  const rateLimit = consumeRateLimit(
    `login:${getRequestClientKey()}`,
    MAX_LOGIN_ATTEMPTS_PER_WINDOW,
    RATE_LIMIT_WINDOW_MS,
  );

  if (!rateLimit.isAllowed) {
    return {
      formError: TOO_MANY_ATTEMPTS_MESSAGE,
      fieldErrors: {},
      notice: null,
    };
  }

  const credentials = readCredentialsFromForm(formData);
  const validation = validateCredentials(credentials);

  if (!validation.isValid) {
    return {
      formError: null,
      fieldErrors: validation.fieldErrors,
      notice: null,
    };
  }

  const outcome = await signInWithEmailAndPassword(credentials);

  if (outcome.status === 'error') {
    return {
      formError: outcome.field ? null : outcome.message,
      fieldErrors: outcome.field ? { [outcome.field]: outcome.message } : {},
      notice: null,
    };
  }

  if (outcome.status === 'email-confirmation-required') {
    return {
      formError: null,
      fieldErrors: {},
      notice:
        'Please confirm your email address first — check your inbox for the link.',
    };
  }

  return {
    formError: null,
    fieldErrors: {},
    notice: null,
    redirectTo: sanitizeRedirectPath(readRedirectTarget(formData)),
  };
}

export async function signOutAction(): Promise<void> {
  await signOutCurrentSession();

  // Drops any cached render that was produced for the signed-in user.
  revalidatePath('/', 'layout');
  redirect(ROUTES.login);
}

function readRedirectTarget(formData: FormData): string | null {
  const value = formData.get('redirectTo');
  return typeof value === 'string' ? value : null;
}
