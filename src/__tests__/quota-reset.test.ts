/**
 * M3F4 quota-reset-on-invoice-paid — invoice.paid zeros the counters
 * and rolls the billing window, without touching files_stored.
 *
 * Fulfills VAL-QUOTA-006 and re-confirms VAL-BILLING-014 (webhook side)
 * now that usage_counters exists.
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

const WEBHOOK_SECRET = 'whsec_test_m3f4_quota_reset_fixture'

function signedRequest(payload: object) {
  const body = JSON.stringify(payload)
  const header = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
    timestamp: Math.floor(Date.now() / 1000),
  })
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': header,
    },
    body,
  })
}

function invoicePaidEvent(opts: {
  eventId?: string
  customer: string
  subscriptionId: string
  periodStart: number
  periodEnd: number
}) {
  return {
    id: opts.eventId ?? `evt_${crypto.randomUUID()}`,
    object: 'event',
    api_version: '2025-09-30.clover',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_${crypto.randomUUID()}`,
        object: 'invoice',
        customer: opts.customer,
        subscription: opts.subscriptionId,
        period_start: opts.periodStart,
        period_end: opts.periodEnd,
      },
    },
  }
}

describe.skipIf(!hasSupabaseTestEnv())('M3F4 quota reset on invoice.paid', () => {
  let user: TestUser
  let customerId: string
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET
  const originalKey = process.env.STRIPE_SECRET_KEY

  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_mock'
  })

  beforeEach(async () => {
    user = await createTestUser()
    customerId = `cus_${crypto.randomUUID()}`
    const admin = serviceRoleClient()
    await admin
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.userId)
    // Seed counters with non-zero values so the reset is visible.
    await admin
      .from('usage_counters')
      .update({
        messages_used: 150,
        crawl_pages_used: 42,
        files_stored: 7,
      })
      .eq('user_id', user.userId)
  })

  afterEach(async () => {
    const admin = serviceRoleClient()
    await admin
      .from('processed_stripe_events')
      .delete()
      .like('stripe_event_id', 'evt_%')
    await truncateUserData(user.userId)
  })

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = originalKey
  })

  it('zeros messages_used + crawl_pages_used, preserves files_stored, rolls period', async () => {
    const admin = serviceRoleClient()
    const newStart = Math.floor(Date.now() / 1000)
    const newEnd = newStart + 30 * 86400

    const res = await POST(
      signedRequest(
        invoicePaidEvent({
          customer: customerId,
          subscriptionId: 'sub_fake',
          periodStart: newStart,
          periodEnd: newEnd,
        })
      )
    )
    expect(res.status).toBe(200)

    const { data: counter } = await admin
      .from('usage_counters')
      .select('messages_used, crawl_pages_used, files_stored, period_start, period_end')
      .eq('user_id', user.userId)
      .single<{
        messages_used: number
        crawl_pages_used: number
        files_stored: number
        period_start: string
        period_end: string
      }>()

    expect(counter?.messages_used).toBe(0)
    expect(counter?.crawl_pages_used).toBe(0)
    expect(counter?.files_stored).toBe(7) // NOT reset — storage is cumulative
    expect(new Date(counter!.period_start).getTime()).toBe(newStart * 1000)
    expect(new Date(counter!.period_end).getTime()).toBe(newEnd * 1000)
  })

  it('after reset, a new chat call can increment from 0 (VAL-QUOTA-006 recovery)', async () => {
    const admin = serviceRoleClient()
    const newStart = Math.floor(Date.now() / 1000)

    await POST(
      signedRequest(
        invoicePaidEvent({
          customer: customerId,
          subscriptionId: 'sub_fake',
          periodStart: newStart,
          periodEnd: newStart + 30 * 86400,
        })
      )
    )

    const { data: first } = await admin.rpc('increment_message_counter', {
      p_user_id: user.userId,
      p_limit: 10,
    })
    expect((first as { ok: boolean; used: number }).ok).toBe(true)
    expect((first as { ok: boolean; used: number }).used).toBe(1)
  })

  it('duplicate invoice.paid event does NOT double-reset (VAL-QUOTA-010)', async () => {
    const admin = serviceRoleClient()
    const eventId = 'evt_dup_quota_reset'

    const firstRes = await POST(
      signedRequest(
        invoicePaidEvent({
          eventId,
          customer: customerId,
          subscriptionId: 'sub_fake',
          periodStart: 100,
          periodEnd: 200,
        })
      )
    )
    expect(firstRes.status).toBe(200)

    // Burn some messages between deliveries so 're-reset' would be visible.
    await admin
      .from('usage_counters')
      .update({ messages_used: 73 })
      .eq('user_id', user.userId)

    const secondRes = await POST(
      signedRequest(
        invoicePaidEvent({
          eventId,
          customer: customerId,
          subscriptionId: 'sub_fake',
          periodStart: 100,
          periodEnd: 200,
        })
      )
    )
    expect(secondRes.status).toBe(200)

    const { data: counter } = await admin
      .from('usage_counters')
      .select('messages_used')
      .eq('user_id', user.userId)
      .single<{ messages_used: number }>()
    // Re-processing would have wiped the 73 back to 0. Idempotency preserves it.
    expect(counter?.messages_used).toBe(73)
  })
})
