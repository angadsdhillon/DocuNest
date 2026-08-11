import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import { ROUTES } from '@/lib/auth/routes';

export default function AuthLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link
            href={ROUTES.home}
            className="text-xl font-semibold tracking-tight"
          >
            DocuNest
          </Link>
          <p className="mt-1 text-sm text-neutral-600">
            Your personal document vault
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          {children}
        </div>
      </div>
    </main>
  );
}
