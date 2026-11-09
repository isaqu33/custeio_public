'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global] Render error:', error);
    Sentry.captureException(error);
  }, [error]);

  // Must render its own <html>/<body> because the root layout itself failed.
  return (
    <html lang="en">
      <body className="m-0 flex min-h-screen items-center justify-center bg-[#0a0a0a] p-4 font-sans text-[#fafafa]">
        <div className="w-full max-w-md text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-red-500">
            <span>●</span>
            <span>Critical error</span>
          </div>
          <h1 className="mb-2 text-2xl font-semibold">The application could not be loaded</h1>
          <p className="mb-6 text-sm leading-6 text-zinc-400">
            An unexpected error happened while bootstrapping the page. Try reloading. If it
            persists, contact support.
          </p>
          {error.digest && (
            <p className="mb-6 font-mono text-xs text-zinc-500">Reference: {error.digest}</p>
          )}
          <button
            onClick={reset}
            className="rounded-md bg-[#fafafa] px-4 py-2 text-sm font-medium text-[#0a0a0a]"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
