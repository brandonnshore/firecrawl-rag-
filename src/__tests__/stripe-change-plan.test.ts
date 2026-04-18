/**
 * M2F6 POST /api/stripe/change-plan — mid-cycle upgrade/downgrade.
 * Stripe triggers proration via proration_behavior='create_prorations'.
 *
 * VAL-BILLING-022 / VAL-BILLING-023 fulfill via the proration_behavior arg
 * landing in the Stripe SDK call; stripe-mock confirms the wire-level shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockGetUser,
  mockFrom,
  mockSubscriptionsRetrieve,
  mockSubscriptionsUpdate,
  mockInvoicesRetrieveUpcoming,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockSubscriptionsRetrieve: vi.fn(),
  mockSubscriptionsUpdate: vi.fn(),
  mockInvoicesRetrieveUpcoming: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}))

vi.mock('@/lib/stripe/client', () => ({
  stripeClient: () => ({
    subscriptions: {
      retrieve: mockSubscriptionsRetrieve,
      update: mockSubscriptionsUpdate,
    },
    invoices: { retrieveUpcoming: mockInvoicesRetrieveUpcoming },
  }),
  resetStripeClient: vi.fn(),
}))

import { POST } from '@/app/api/stripe/change-plan/route'

function mockProfileAndPlan(opts: {
  customerId: string | null
  subscriptionId: string | null
  planPriceId: string
}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({
              data: {
                stripe_customer_id: opts.customerId,
                stripe_subscription_id: opts.subscriptionId,
              },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'plans') {
      return {
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'pro', stripe_price_id: opts.planPriceId },
              error: null,
            }),
          }),
        }),
      }
    }
    return {}
  })
}

function postJson(body: unknown) {
  return new Request('http://localhost/api/stripe/change-plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/stripe/change-plan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without auth', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = await POST(postJson({ plan_id: 'pro' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 on missing plan_id', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    })
    const res = await POST(postJson({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when caller has no active subscription', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    })
    mockProfileAndPlan({
      customerId: 'cus_1',
      subscriptionId: null,
      planPriceId: 'price_pro',
    })
    const res = await POST(postJson({ plan_id: 'pro' }))
    expect(res.status).toBe(400)
  })

  it('updates subscription with proration_behavior=create_prorations', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    })
    mockProfileAndPlan({
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      planPriceId: 'price_pro',
    })
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      items: { data: [{ id: 'si_existing', price: { id: 'price_starter' } }] },
    })
    mockSubscriptionsUpdate.mockResolvedValue({ id: 'sub_1', status: 'active' })

    const res = await POST(postJson({ plan_id: 'pro' }))
    expect(res.status).toBe(200)

    const updateArgs = mockSubscriptionsUpdate.mock.calls[0]
    expect(updateArgs[0]).toBe('sub_1')
    expect(updateArgs[1].proration_behavior).toBe('create_prorations')
    expect(updateArgs[1].items).toEqual([
      { id: 'si_existing', price: 'price_pro' },
    ])
  })

  it('returns 400 when current subscription has no items (defensive)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    })
    mockProfileAndPlan({
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      planPriceId: 'price_pro',
    })
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      items: { data: [] },
    })
    const res = await POST(postJson({ plan_id: 'pro' }))
    expect(res.status).toBe(400)
  })
})
