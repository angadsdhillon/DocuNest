'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactElement } from 'react';

import {
  EMPTY_AUTH_FORM_STATE,
  type AuthFormState,
} from '@/lib/auth/form-state';
import { ROUTES } from '@/lib/auth/routes';
import {
  MINIMUM_PASSWORD_LENGTH,
  readCredentialsFromForm,
  validateCredentials,
} from '@/lib/auth/validation';

type AuthFormMode = 'login' | 'signup';

type AuthFormProps = {
  mode: AuthFormMode;
  redirectTo: string;
  initialNotice?: string | null;
  action: (formData: FormData) => Promise<AuthFormState>;
};

const COPY: Record<
  AuthFormMode,
  { submitLabel: string; pendingLabel: string }
> = {
  login: { submitLabel: 'Sign in', pendingLabel: 'Signing in…' },
  signup: {
    submitLabel: 'Create account',
    pendingLabel: 'Creating your account…',
  },
};

export function AuthForm({
  mode,
  redirectTo,
  initialNotice = null,
  action,
}: AuthFormProps): ReactElement {
  const [state, setState] = useState<AuthFormState>({
    ...EMPTY_AUTH_FORM_STATE,
    notice: initialNotice,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);

    // First pass, for instant feedback. The server runs the same check again on
    // the submitted values, and Supabase Auth enforces its own rules on top —
    // this pass is a convenience, never the thing standing in the way.
    const validation = validateCredentials(readCredentialsFromForm(formData));

    if (!validation.isValid) {
      setState({
        formError: null,
        fieldErrors: validation.fieldErrors,
        notice: null,
      });
      return;
    }

    setIsSubmitting(true);

    try {
      setState(await action(formData));
    } finally {
      setIsSubmitting(false);
    }
  }

  const { submitLabel, pendingLabel } = COPY[mode];

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <input type="hidden" name="redirectTo" value={redirectTo} />

      {state.notice ? (
        <p
          role="status"
          className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900"
        >
          {state.notice}
        </p>
      ) : null}

      {state.formError ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {state.formError}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label
          htmlFor="email"
          className="block text-sm font-medium text-neutral-800"
        >
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(state.fieldErrors.email)}
          aria-describedby={state.fieldErrors.email ? 'email-error' : undefined}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
        />
        {state.fieldErrors.email ? (
          <p id="email-error" className="text-sm text-red-700">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="password"
          className="block text-sm font-medium text-neutral-800"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          required
          minLength={MINIMUM_PASSWORD_LENGTH}
          aria-invalid={Boolean(state.fieldErrors.password)}
          aria-describedby={
            state.fieldErrors.password ? 'password-error' : 'password-hint'
          }
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
        />
        {state.fieldErrors.password ? (
          <p id="password-error" className="text-sm text-red-700">
            {state.fieldErrors.password}
          </p>
        ) : (
          <p id="password-hint" className="text-sm text-neutral-500">
            At least {MINIMUM_PASSWORD_LENGTH} characters.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? pendingLabel : submitLabel}
      </button>

      <p className="text-center text-sm text-neutral-600">
        {mode === 'login' ? (
          <>
            New to DocuNest?{' '}
            <Link
              href={ROUTES.signup}
              className="font-medium text-neutral-900 underline"
            >
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <Link
              href={ROUTES.login}
              className="font-medium text-neutral-900 underline"
            >
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
