import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import { signOutAction } from '@/lib/auth/actions';
import { ROUTES } from '@/lib/auth/routes';
import { getVerifiedUser } from '@/lib/auth/session';
import { UploadZone } from '@/components/documents/upload-zone';
import { getAccountOverview } from '@/lib/profile/profile-service';

export const metadata: Metadata = {
  title: 'Your vault · DocuNest',
};

export default async function DashboardPage(): Promise<ReactElement> {
  // The middleware already blocked unauthenticated requests. Checking again
  // here means this page stays safe even if the matcher is ever changed.
  const user = await getVerifiedUser();

  if (!user) {
    redirect(ROUTES.login);
  }

  const overview = await getAccountOverview(user.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your vault</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Signed in as {user.email ?? 'your account'}
          </p>
        </div>

        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium transition hover:bg-neutral-50"
          >
            Log out
          </button>
        </form>
      </header>

      {overview ? (
        <>
          <section className="mt-10 rounded-2xl border border-neutral-200 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Your forwarding address
            </h2>
            <p className="mt-3 break-all font-mono text-sm">
              {overview.profile.inbound_address_token}
            </p>
            <p className="mt-2 text-sm text-neutral-600">
              This is the private token that will make up your personal email
              address for forwarding documents in. Email forwarding gets
              switched on in a later phase.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-neutral-500">Plan</dt>
                <dd className="mt-0.5 font-medium capitalize">
                  {overview.profile.subscription_tier}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Storage included</dt>
                <dd className="mt-0.5 font-medium">
                  {formatBytes(overview.profile.storage_limit_bytes)}
                </dd>
              </div>
            </dl>
          </section>

          <UploadZone />

          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Your categories ({overview.categories.length})
            </h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {overview.categories.map((category) => (
                <li
                  key={category.id}
                  className="rounded-xl border border-neutral-200 px-4 py-3 text-sm"
                >
                  {category.name}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <p className="mt-10 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          We could not load your account details just now. Please refresh in a
          moment.
        </p>
      )}
    </main>
  );
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / 1024 / 1024;

  if (megabytes >= 1024) {
    return `${(megabytes / 1024).toFixed(megabytes % 1024 === 0 ? 0 : 1)} GB`;
  }

  return `${Math.round(megabytes)} MB`;
}
