import Stripe from 'stripe'

/**
 * Memoized Stripe SDK client.
 *
 * In tests we point the SDK at stripe-mock (localhost:12111) by setting
 * STRIPE_API_HOST / STRIPE_API_PORT / STRIPE_API_PROTOCOL env vars. The secret
 * key in tests is the stripe-mock default (sk_test_mock); the server just
 * needs a non-empty string so the SDK constructor doesn't throw.
 *
 * In production STRIPE_SECRET_KEY is a real sk_test_... (preview env) or
 * sk_live_... (Vercel production).
 */

let cached: Stripe | null = null

export function stripeClient(): Stripe {
  if (cached) return cached

  const apiKey = process.env.STRIPE_SECRET_KEY
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY is not set')
  }

  const host = process.env.STRIPE_API_HOST
  const port = process.env.STRIPE_API_PORT
  const protocol = process.env.STRIPE_API_PROTOCOL as
    | 'http'
    | 'https'
    | undefined

  cached = new Stripe(apiKey, {
    ...(host ? { host } : {}),
    ...(port ? { port: Number(port) } : {}),
    ...(protocol ? { protocol } : {}),
  })

  return cached
}

/** Test-only: reset the memoized client so env-var changes take effect. */
export function resetStripeClient(): void {
  cached = null
}
