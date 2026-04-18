/**
 * M4F5 tos-acceptance-signup — migration + API + billing gates.
 *
 * VAL-TOS-003: tos_accepted_at stamped on profile when signup metadata
 *              includes the timestamp.
 * VAL-TOS-004: existing users without tos_accepted_at blocked on billing
 *              upgrade actions; POST /api/account/accept-tos stamps.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}))

// Stripe mock — checkout/change-plan tests need the SDK.
vi.mock('@/lib/stripe/client', () => ({
  stripeClient: () => ({
    customers: { create: vi.fn().mockResolvedValue({ id: 'cus_new' }) },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/ok' }),
      },
    },
    subscriptions: {
      retrieve: vi.fn(),
      update: vi.fn(),
    },
  }),
  resetStripeClient: vi.fn(),
}))

import { POST as acceptPost } from '@/app/api/account/accept-tos/route'
import { POST as checkoutPost } from '@/app/api/stripe/checkout/route'
import { POST as changePlanPost } from '@/app/api/stripe/change-plan/route'

function postJson(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockProfile(overrides: Record<string, unknown>) {
  const single = vi.fn().mockResolvedValue({ data: overrides, error: null })
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const plansSingle = vi.fn().mockResolvedValue({
    data: { id: 'starter', stripe_price_id: 'price_x', monthly_message_limit: 2000 },
    error: null,
  })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({ eq: () => ({ single }) }),
        update: () => ({ eq: updateEq }),
      }
    }
    if (table === 'plans') {
      return {
        select: () => ({ eq: () => ({ single: plansSingle }) }),
      }
    }
    return {}
  })

  return { single, updateEq }
}

describe('POST /api/account/accept-tos', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = await acceptPost()
    expect(res.status).toBe(401)
  })

  it('stamps tos_accepted_at when caller has NULL', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const { updateEq } = mockProfile({ tos_accepted_at: null })

    const res = await acceptPost()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tos_accepted_at).toBeDefined()
    expect(body.already_accepted).toBe(false)
    expect(updateEq).toHaveBeenCalled()
  })

  it('is idempotent — returns existing timestamp when already accepted', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const existing = '2026-01-01T00:00:00.000Z'
    const { updateEq } = mockProfile({ tos_accepted_at: existing })

    const res = await acceptPost()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tos_accepted_at).toBe(existing)
    expect(body.already_accepted).toBe(true)
    expect(updateEq).not.toHaveBeenCalled()
  })
})

describe('VAL-TOS-004: billing upgrades blocked until ToS accepted', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checkout returns 403 tos_required when tos_accepted_at is NULL', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    mockProfile({
      stripe_customer_id: null,
      email: 'u@r.test',
      tos_accepted_at: null,
    })
    const res = await checkoutPost(postJson('http://x/', { plan_id: 'starter' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('tos_required')
  })

  it('checkout proceeds to 200 when tos_accepted_at is set', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    mockProfile({
      stripe_customer_id: 'cus_existing',
      email: 'u@r.test',
      tos_accepted_at: '2026-01-01T00:00:00.000Z',
    })
    const res = await checkoutPost(postJson('http://x/', { plan_id: 'starter' }))
    expect(res.status).toBe(200)
  })

  it('change-plan returns 403 tos_required when tos_accepted_at is NULL', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    mockProfile({
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      tos_accepted_at: null,
    })
    const res = await changePlanPost(postJson('http://x/', { plan_id: 'pro' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('tos_required')
  })
})
