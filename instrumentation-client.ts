import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0),
  replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE ?? 0),
  replaysOnErrorSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE ?? 0),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
