import * as Sentry from '@sentry/nextjs';

// Next auto-loads exactly two instrumentation entry points: this file (server +
// edge runtimes) and `instrumentation-client.ts` (browser). Without it nothing
// imports `sentry.server.config.ts` / `sentry.edge.config.ts`, so `Sentry.init`
// never runs on the server and every exception the app catches stays inside the
// container. The Bull worker is not a Next runtime and keeps initializing Sentry
// on its own in `scripts/worker.ts`.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Server-component and route-handler errors that Next catches before any of our
// own wrappers see them. `withObservability` still logs the ones it handles; this
// covers rendering and anything thrown outside a wrapped handler.
export const onRequestError = Sentry.captureRequestError;
