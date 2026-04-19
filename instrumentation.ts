// Next.js instrumentation hook — registers Sentry SDK for server + edge
// runtimes on cold start. Client init lives in sentry.client.config.ts.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export { captureRequestError } from '@sentry/nextjs'
