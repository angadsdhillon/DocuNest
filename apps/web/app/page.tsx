import type { ReactElement } from 'react';

export default function Home(): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">DocuNest</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Phase 0 scaffold — web app is running.
        </p>
      </div>
    </main>
  );
}
