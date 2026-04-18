/**
 * M2F3 stripe-webhook-api — signature verification, timestamp tolerance,
 * idempotency, and per-event handler dispatch.
 *
 * Integration-style: signs real events with the Stripe SDK helper and runs
 * them through the real webhook route against the real Supabase stack. This
 * catches wiring bugs unit tests with mocked SDKs would miss (e.g., raw-body
 * handling in Next.js, constructEvent tolerance args, UNIQUE constraint
 * idempotency on processed_stripe_events).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import Stripe from 'stripe'
import { POST } from '@/app/api/stripe/webhook/route'
import {
  hasSupabaseTestEnv,
  serviceRoleClient,
  createTestUser,
  truncateUserData,
  type TestUser,
} from './helpers/supabase'

const WEBHOOK_SECRET = 'whsec_test_m2f3_webhook_secret_0123456789abcdef'

function signedRequest(payload: object, opts: { secret?: string; timestamp?: number } = {}): Request {
  const body = JSON.stringify(payload)
  const header = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: opts.secret ?? WEBHOOK_SECRET,
    timestamp: opts.timestamp ?? Math.floor(Date.now() / 1000),
  })
  return new Request('http://localhost:3000/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': header,
    },
    body,
  })
}

function unsignedRequest(payload: object): Request {
  return new Request('http://localhost:3000/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': 't=1,v1=bogus',
    },
    body: JSON.stringify(payload),
  })
}

function subscriptionEvent(
  type: 'customer.subscription.updated' | 'customer.subscription.deleted',
  opts: {
    eventId?: string
    customer: string
    subscriptionId: string
    priceId: string
    status: string
    periodStart: number
    periodEnd: number
    cancelAtPeriodEnd?: boolean
  }
) {
  return {
    id: opts.eventId ?? `evt_${crypto.randomUUID()}`,
    object: 'event',
    api_version: '2025-09-30.clover',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: {
      object: {
        id: opts.subscriptionId,
        object: 'subscription',
        customer: opts.customer,
        status: opts.status,
        current_period_start: opts.periodStart,
        current_period_end: opts.periodEnd,
        cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
        items: {
          object: 'list',
          data: [
            {
              id: 'si_test',
              price: { id: opts.priceId, object: 'price' },
            },
          ],
        },
      },
    },
  }
}

function invoiceEvent(
  type: 'invoice.paid' | 'invoice.payment_failed',
  opts: {
    eventId?: string
    customer: string
    subscriptionId: string
    periodStart: number
    periodEnd: number
  }
) {
  return {
    id: opts.eventId ?? `evt_${crypto.randomUUID()}`,
    object: 'event',
    api_version: '2025-09-30.clover',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: {
      object: {
        id: `in_test_${crypto.randomUUID()}`,
        object: 'invoice',
        customer: opts.customer,
        subscription: opts.subscriptionId,
        period_start: opts.periodStart,
        period_end: opts.periodEnd,
      },
    },
  }
}

describe.skipIf(!hasSupabaseTestEnv())('POST /api/stripe/webhook', () => {
  let user: TestUser
  let customerId: string
  let subscriptionId: string

  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET
  const originalStripeKey = process.env.STRIPE_SECRET_KEY

  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock'
  })

  beforeEach(async () => {
    user = await createTestUser()
    customerId = `cus_test_${crypto.randomUUID()}`
    subscriptionId = `sub_test_${crypto.randomUUID()}`

    const admin = serviceRoleClient()
    await admin
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.userId)
  })

  afterEach(async () => {
    const admin = serviceRoleClient()
    // Scrub processed_stripe_events for this user's test customer to keep
    // idempotency state clean between tests.
    await admin
      .from('processed_stripe_events')
      .delete()
      .like('stripe_event_id', 'evt_%')

    await truncateUserData(user.userId)
  })

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret
    if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = originalStripeKey
  })

  describe('VAL-BILLING-007: invalid signature', () => {
    it('returns 400 on missing stripe-signature header', async () => {
      const req = new Request('http://localhost/api/stripe/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('returns 400 on malformed stripe-signature', async () => {
      const event = subscriptionEvent('customer.subscription.updated', {
        customer: customerId,
        subscriptionId,
        priceId: 'price_test_starter',
        status: 'active',
        periodStart: 1,
        periodEnd: 2,
      })
      const res = await POST(unsignedRequest(event))
      expect(res.status).toBe(400)
    })

    it('returns 400 on valid structure but wrong secret', async () => {
      const event = subscriptionEvent('customer.subscription.updated', {
        customer: customerId,
        subscriptionId,
        priceId: 'price_test_starter',
        status: 'active',
        periodStart: 1,
        periodEnd: 2,
      })
      const res = await POST(signedRequest(event, { secret: 'whsec_wrong_secret' }))
      expect(res.status).toBe(400)
    })

    it('does NOT record a 400-rejected event in processed_stripe_events', async () => {
      const event = subscriptionEvent('customer.subscription.updated', {
        eventId: 'evt_bad_sig_1',
        customer: customerId,
        subscriptionId,
        priceId: 'price_test_starter',
        status: 'active',
        periodStart: 1,
        periodEnd: 2,
      })
      await POST(unsignedRequest(event))

      const admin = serviceRoleClient()
      const { data } = await admin
        .from('processed_stripe_events')
        .select('stripe_event_id')
        .eq('stripe_event_id', 'evt_bad_sig_1')
      expect(data).toEqual([])
    })
  })

  describe('VAL-BILLING-009: expired timestamp', () => {
    it('returns 400 when event created more than 5 minutes ago', async () => {
      const event = subscriptionEvent('customer.subscription.updated', {
        customer: customerId,
        subscriptionId,
        priceId: 'price_test_starter',
        status: 'active',
        periodStart: 1,
        periodEnd: 2,
      })
      const sixMinsAgo = Math.floor(Date.now() / 1000) - 6 * 60
      const res = await POST(signedRequest(event, { timestamp: sixMinsAgo }))
      expect(res.status).toBe(400)
    })
  })

  describe('VAL-BILLING-010: idempotency on duplicate event_id', () => {
    it('second delivery returns 200 but does not re-process', async () => {
      const event = subscriptionEvent('customer.subscription.updated', {
        eventId: 'evt_dup_test_M2F3',
        customer: customerId,
        subscriptionId,
        priceId: 'price_test_starter',
        status: 'active',
        periodStart: 100,
        periodEnd: 200,
      })

      const first = await POST(signedRequest(event))
      expect(first.status).toBe(200)

      const admin = serviceRoleClient()
      const { data: rowsAfterFirst } = await admin
        .from('processed_stripe_events')
        .select('stripe_event_id')
        .eq('stripe_event_id', 'evt_dup_test_M2F3')
      expect(rowsAfterFirst).toHaveLength(1)

      // Mutate the profile to detect re-processing.
      await admin
        .from('profiles')
        .update({ subscription_status: 'trialing' })
        .eq('id', user.userId)

      const second = await POST(signedRequest(event))
      expect(second.status).toBe(200)

      const { data: profileAfter } = await admin
        .from('profiles')
        .select('subscription_status')
        .eq('id', user.userId)
        .single<{ subscription_status: string }>()

      // Re-processing would have overwritten back to 'active'; idempotency
      // means the trialing marker survives.
      expect(profileAfter?.subscription_status).toBe('trialing')

      const { data: rowsAfterSecond } = await admin
        .from('processed_stripe_events')
        .select('stripe_event_id')
        .eq('stripe_event_id', 'evt_dup_test_M2F3')
      expect(rowsAfterSecond).toHaveLength(1)
    })
  })

  describe('VAL-BILLING-011 / -012: customer.subscription.updated syncs', () => {
    it('writes stripe_subscription_id, plan_id, status, period dates', async () => {
      const admin = serviceRoleClient()
      const testPriceId = `price_test_cs_${Date.now()}`
      await admin.from('plans').update({ stripe_price_id: testPriceId }).eq('id', 'starter')

      try {
        const now = Math.floor(Date.now() / 1000)
        const periodEnd = now + 30 * 86400
        const event = subscriptionEvent('customer.subscription.updated', {
          customer: customerId,
          subscriptionId,
          priceId: testPriceId,
          status: 'active',
          periodStart: now,
          periodEnd,
        })

        const res = await POST(signedRequest(event))
        expect(res.status).toBe(200)

        const { data: profile } = await admin
          .from('profiles')
          .select(
            'stripe_subscription_id, plan_id, subscription_status, current_period_end, current_period_start'
          )
          .eq('id', user.userId)
          .single<{
            stripe_subscription_id: string
            plan_id: string
            subscription_status: string
            current_period_end: string
            current_period_start: string
          }>()

        expect(profile?.stripe_subscription_id).toBe(subscriptionId)
        expect(profile?.plan_id).toBe('starter')
        expect(profile?.subscription_status).toBe('active')
        expect(new Date(profile!.current_period_end).getTime()).toBe(periodEnd * 1000)
        expect(new Date(profile!.current_period_start).getTime()).toBe(now * 1000)
      } finally {
        await admin.from('plans').update({ stripe_price_id: null }).eq('id', 'starter')
      }
    })

    it('transitions status trialing -> past_due and changes plan_id', async () => {
      const admin = serviceRoleClient()
      await admin
        .from('profiles')
        .update({
          stripe_subscription_id: subscriptionId,
          subscription_status: 'trialing',
        })
        .eq('id', user.userId)

      const testPriceId = `price_test_upd_${Date.now()}`
      await admin.from('plans').update({ stripe_price_id: testPriceId }).eq('id', 'pro')

      try {
        const now = Math.floor(Date.now() / 1000)
        const event = subscriptionEvent('customer.subscription.updated', {
          customer: customerId,
          subscriptionId,
          priceId: testPriceId,
          status: 'past_due',
          periodStart: now,
          periodEnd: now + 86400,
        })
        const res = await POST(signedRequest(event))
        expect(res.status).toBe(200)

        const { data: profile } = await admin
          .from('profiles')
          .select('subscription_status, plan_id')
          .eq('id', user.userId)
          .single<{ subscription_status: string; plan_id: string }>()

        expect(profile?.subscription_status).toBe('past_due')
        expect(profile?.plan_id).toBe('pro')
      } finally {
        await admin.from('plans').update({ stripe_price_id: null }).eq('id', 'pro')
      }
    })
  })

  describe('VAL-BILLING-013: customer.subscription.deleted sets canceled', () => {
    it('sets subscription_status=canceled and preserves cancel_at_period_end', async () => {
      const admin = serviceRoleClient()
      await admin
        .from('profiles')
        .update({
          stripe_subscription_id: subscriptionId,
          subscription_status: 'active',
        })
        .eq('id', user.userId)

      const event = subscriptionEvent('customer.subscription.deleted', {
        customer: customerId,
        subscriptionId,
        priceId: 'price_test_unused',
        status: 'canceled',
        periodStart: Math.floor(Date.now() / 1000),
        periodEnd: Math.floor(Date.now() / 1000) + 86400,
        cancelAtPeriodEnd: true,
      })

      const res = await POST(signedRequest(event))
      expect(res.status).toBe(200)

      const { data: profile } = await admin
        .from('profiles')
        .select('subscription_status, cancel_at_period_end')
        .eq('id', user.userId)
        .single<{ subscription_status: string; cancel_at_period_end: boolean }>()

      expect(profile?.subscription_status).toBe('canceled')
      expect(profile?.cancel_at_period_end).toBe(true)
    })
  })

  describe('VAL-BILLING-014: invoice.paid rolls period', () => {
    it('updates current_period_start / current_period_end on the profile', async () => {
      const admin = serviceRoleClient()
      await admin
        .from('profiles')
        .update({ stripe_subscription_id: subscriptionId })
        .eq('id', user.userId)

      const newStart = Math.floor(Date.now() / 1000)
      const newEnd = newStart + 30 * 86400
      const event = invoiceEvent('invoice.paid', {
        customer: customerId,
        subscriptionId,
        periodStart: newStart,
        periodEnd: newEnd,
      })

      const res = await POST(signedRequest(event))
      expect(res.status).toBe(200)

      const { data: profile } = await admin
        .from('profiles')
        .select('current_period_start, current_period_end')
        .eq('id', user.userId)
        .single<{ current_period_start: string; current_period_end: string }>()

      expect(new Date(profile!.current_period_start).getTime()).toBe(newStart * 1000)
      expect(new Date(profile!.current_period_end).getTime()).toBe(newEnd * 1000)
    })
  })

  describe('VAL-BILLING-015: invoice.payment_failed -> past_due', () => {
    it('sets subscription_status=past_due', async () => {
      const admin = serviceRoleClient()
      await admin
        .from('profiles')
        .update({
          stripe_subscription_id: subscriptionId,
          subscription_status: 'active',
        })
        .eq('id', user.userId)

      const event = invoiceEvent('invoice.payment_failed', {
        customer: customerId,
        subscriptionId,
        periodStart: Math.floor(Date.now() / 1000),
        periodEnd: Math.floor(Date.now() / 1000) + 86400,
      })

      const res = await POST(signedRequest(event))
      expect(res.status).toBe(200)

      const { data: profile } = await admin
        .from('profiles')
        .select('subscription_status')
        .eq('id', user.userId)
        .single<{ subscription_status: string }>()

      expect(profile?.subscription_status).toBe('past_due')
    })
  })

  describe('VAL-BILLING-008: valid signature + fresh timestamp returns 200', () => {
    it('accepts a fresh signed event and returns 200', async () => {
      const event = invoiceEvent('invoice.payment_failed', {
        customer: customerId,
        subscriptionId,
        periodStart: Math.floor(Date.now() / 1000),
        periodEnd: Math.floor(Date.now() / 1000) + 86400,
      })
      const res = await POST(signedRequest(event))
      expect(res.status).toBe(200)
    })

    it('ignores events for unknown customers (200 no-op)', async () => {
      const event = invoiceEvent('invoice.payment_failed', {
        customer: `cus_unknown_${crypto.randomUUID()}`,
        subscriptionId,
        periodStart: Math.floor(Date.now() / 1000),
        periodEnd: Math.floor(Date.now() / 1000) + 86400,
      })
      const res = await POST(signedRequest(event))
      expect(res.status).toBe(200)
    })
  })
})
