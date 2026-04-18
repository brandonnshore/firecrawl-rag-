/**
 * M2F2 stripe-checkout-api — integration test against live stripe-mock.
 *
 * Gated by STRIPE_API_HOST to stay CI-friendly. Local run:
 *   docker run -d --name stripe-mock -p 12111:12111 stripe/stripe-mock
 *   STRIPE_API_HOST=localhost STRIPE_API_PORT=12111 STRIPE_API_PROTOCOL=http \
 *   STRIPE_SECRET_KEY=sk_test_mock \
 *   pnpm vitest run src/__tests__/stripe-checkout-integration.test.ts
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { resetStripeClient, stripeClient } from '@/lib/stripe/client'

function hasStripeMock(): boolean {
  return (
    !!process.env.STRIPE_API_HOST &&
    !!process.env.STRIPE_SECRET_KEY
  )
}

describe.skipIf(!hasStripeMock())('stripe-mock wiring', () => {
  beforeEach(() => {
    resetStripeClient()
  })

  afterAll(() => {
    resetStripeClient()
  })

  it('stripeClient() routes requests to stripe-mock', async () => {
    const stripe = stripeClient()
    const customer = await stripe.customers.create({ email: 'probe@rubycrawl.test' })
    // stripe-mock returns fixture data; any valid id prefix proves routing works.
    expect(customer.id).toMatch(/^cus_/)
  })

  it('creates a checkout session via the mocked API', async () => {
    const stripe = stripeClient()
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: 'price_fixture', quantity: 1 }],
      success_url: 'https://example.test/success',
      cancel_url: 'https://example.test/cancel',
    })
    expect(session.id).toMatch(/^cs_/)
  })
})
