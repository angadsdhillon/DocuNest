import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { AuthForm } from '@/components/auth/auth-form';
import { signUpAction } from '@/lib/auth/actions';
import { ROUTES } from '@/lib/auth/routes';

export const metadata: Metadata = {
  title: 'Create your account · DocuNest',
};

export default function SignupPage(): ReactElement {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">
        Create your account
      </h1>
      <p className="mb-6 text-sm text-neutral-600">
        We will set up your vault and your twelve starter categories straight
        away.
      </p>

      <AuthForm
        mode="signup"
        redirectTo={ROUTES.dashboard}
        action={signUpAction}
      />
    </>
  );
}
