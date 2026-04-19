import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  /* config options here */
}

// Wrap with Sentry only when DSN is configured so dev/CI builds stay fast
// and don't emit events to a misconfigured project. Source-map upload
// requires SENTRY_AUTH_TOKEN (Vercel env only).
const shouldInstrument = Boolean(
  process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
)

export default shouldInstrument
  ? withSentryConfig(nextConfig, {
      silent: !process.env.CI,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      widenClientFileUpload: true,
      tunnelRoute: '/monitoring',
      disableLogger: true,
    })
  : nextConfig
