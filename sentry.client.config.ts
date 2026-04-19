// Sentry client-side init. Loaded by @sentry/nextjs bootstrap and runs
// in the browser on every page. Skips init when SENTRY_DSN is absent so
// dev + CI never emit events to a misconfigured project.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN
const environment =
  process.env.NEXT_PUBLIC_SENTRY_ENV ||
  process.env.VERCEL_ENV ||
  process.env.NODE_ENV ||
  'development'

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: environment === 'production' ? 0.1 : 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  })
}
