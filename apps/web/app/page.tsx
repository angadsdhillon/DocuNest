import Link from 'next/link';
import type { ReactElement } from 'react';

import { ROUTES } from '@/lib/auth/routes';

export default function Home(): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-semibold tracking-tight">DocuNest</h1>
        <p className="mt-3 text-sm text-neutral-600">
          Every receipt, ticket and contract from your inbox, filed
          automatically and easy to find again.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href={ROUTES.signup}
            className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
          >
            Create an account
          </Link>
          <Link
            href={ROUTES.login}
            className="rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium transition hover:bg-neutral-50"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
