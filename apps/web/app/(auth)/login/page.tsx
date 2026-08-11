import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { AuthForm } from '@/components/auth/auth-form';
import { signInAction } from '@/lib/auth/actions';
import { sanitizeRedirectPath } from '@/lib/auth/routes';

export const metadata: Metadata = {
  title: 'Sign in · DocuNest',
};

type LoginPageProps = {
  searchParams: {
    redirectTo?: string;
    notice?: string;
  };
};

export default function LoginPage({
  searchParams,
}: LoginPageProps): ReactElement {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">
        Welcome back
      </h1>
      <p className="mb-6 text-sm text-neutral-600">
        Sign in to get to your documents.
      </p>

      <AuthForm
        mode="login"
        redirectTo={sanitizeRedirectPath(searchParams.redirectTo)}
        initialNotice={getNoticeMessage(searchParams.notice)}
        action={signInAction}
      />
    </>
  );
}

function getNoticeMessage(notice: string | undefined): string | null {
  if (notice === 'confirm-failed') {
    return 'That confirmation link did not work — it may have already been used or expired. Try signing in, and we can send you a fresh one.';
  }

  if (notice === 'signed-out') {
    return 'You are signed out.';
  }

  return null;
}
