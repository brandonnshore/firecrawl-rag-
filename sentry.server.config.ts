// Sentry server-side init. Called from instrumentation.ts::register()
// when Next.js spins up the Node runtime. Skips init when SENTRY_DSN is
// absent so dev and CI never emit to a misconfigured project.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN
const environment =
  process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: environment === 'production' ? 0.1 : 0,
  })
}
