/**
 * M2F2 stripe-checkout-api — unit tests.
 *
 * Asserts:
 *   VAL-BILLING-004: 200 returns {url} with valid auth + plan_id.
 *   VAL-BILLING-005: 400 on invalid plan_id.
 *   VAL-BILLING-006: 401 without auth.
 * Plus lazy customer creation + reuse semantics.
 *
 * Stripe SDK and Supabase server client are mocked — integration coverage
 * against live stripe-mock lives in stripe-checkout-integration.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockCustomerCreate = vi.fn()
const mockSessionCreate = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}))

vi.mock('@/lib/stripe/client', () => ({
  stripeClient: () => ({
    customers: { create: mockCustomerCreate },
    checkout: { sessions: { create: mockSessionCreate } },
  }),
  resetStripeClient: vi.fn(),
}))

import { POST } from '@/app/api/stripe/checkout/route'

function postJson(body: unknown): Request {
  return new Request('http://localhost:3000/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockPlansLookup(plan: {
  id: string
  stripe_price_id: string | null
} | null) {
  return vi.fn().mockResolvedValue({ data: plan, error: plan ? null : { code: 'PGRST116' } })
}

function mockProfileLookup(profile: {
  stripe_customer_id: string | null
  email: string
}) {
  return vi.fn().mockResolvedValue({ data: profile, error: null })
}

function mockProfileUpdate() {
  return vi.fn().mockResolvedValue({ error: null })
}

function setupHappyPath(opts: {
  userId?: string
  email?: string
  existingCustomer?: string | null
  planId?: string
  stripePriceId?: string
} = {}) {
  const {
    userId = 'user-1',
    email = 'user@rubycrawl.test',
    existingCustomer = null,
    planId = 'starter',
    stripePriceId = 'price_test_starter',
  } = opts

  mockGetUser.mockResolvedValue({
    data: { user: { id: userId, email } },
    error: null,
  })

  const plansSingle = mockPlansLookup({ id: planId, stripe_price_id: stripePriceId })
  const profileSingle = mockProfileLookup({
    stripe_customer_id: existingCustomer,
    email,
  })
  const profileUpdateEq = mockProfileUpdate()

  mockFrom.mockImplementation((table: string) => {
    if (table === 'plans') {
      return {
        select: () => ({
          eq: () => ({ single: plansSingle }),
        }),
      }
    }
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({ single: profileSingle }),
        }),
        update: () => ({ eq: profileUpdateEq }),
      }
    }
    return {}
  })

  mockCustomerCreate.mockResolvedValue({ id: 'cus_test_new' })
  mockSessionCreate.mockResolvedValue({
    id: 'cs_test_123',
    url: 'https://checkout.stripe.com/c/cs_test_123',
  })

  return { plansSingle, profileSingle, profileUpdateEq }
}

describe('POST /api/stripe/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('VAL-BILLING-006: auth', () => {
    it('returns 401 when unauthenticated', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
      const res = await POST(postJson({ plan_id: 'starter' }))
      expect(res.status).toBe(401)
    })
  })

  describe('VAL-BILLING-005: invalid plan_id', () => {
    it('returns 400 when body missing plan_id', async () => {
      setupHappyPath()
      const res = await POST(postJson({}))
      expect(res.status).toBe(400)
    })

    it('returns 400 when plan_id not in plans table', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'u@r.test' } },
        error: null,
      })
      mockFrom.mockImplementation((table: string) => {
        if (table === 'plans') {
          return {
            select: () => ({
              eq: () => ({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
              }),
            }),
          }
        }
        return {}
      })
      const res = await POST(postJson({ plan_id: 'nope' }))
      expect(res.status).toBe(400)
    })

    it('returns 400 when plan has no stripe_price_id yet', async () => {
      setupHappyPath({ stripePriceId: '' })
      // Replace plans lookup with null stripe_price_id
      mockFrom.mockImplementation((table: string) => {
        if (table === 'plans') {
          return {
            select: () => ({
              eq: () => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'starter', stripe_price_id: null },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      })
      const res = await POST(postJson({ plan_id: 'starter' }))
      expect(res.status).toBe(400)
    })

    it('returns 400 on malformed JSON body', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'u@r.test' } },
        error: null,
      })
      const bad = new Request('http://localhost/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      })
      const res = await POST(bad)
      expect(res.status).toBe(400)
    })
  })

  describe('VAL-BILLING-004: happy path', () => {
    it('returns 200 with Checkout Session URL', async () => {
      setupHappyPath()
      const res = await POST(postJson({ plan_id: 'starter' }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    })

    it('passes stripe_price_id from plans table into session line items', async () => {
      setupHappyPath({ stripePriceId: 'price_test_PRO_abc' })
      await POST(postJson({ plan_id: 'starter' }))
      const args = mockSessionCreate.mock.calls[0][0]
      expect(args.line_items[0].price).toBe('price_test_PRO_abc')
      expect(args.line_items[0].quantity).toBe(1)
      expect(args.mode).toBe('subscription')
    })

    it('success_url and cancel_url point at /dashboard/billing', async () => {
      setupHappyPath()
      await POST(postJson({ plan_id: 'starter' }))
      const args = mockSessionCreate.mock.calls[0][0]
      expect(args.success_url).toContain('/dashboard/billing')
      expect(args.cancel_url).toContain('/dashboard/billing')
    })

    it('client_reference_id is the user id (for webhook correlation)', async () => {
      setupHappyPath({ userId: 'user-42' })
      await POST(postJson({ plan_id: 'starter' }))
      const args = mockSessionCreate.mock.calls[0][0]
      expect(args.client_reference_id).toBe('user-42')
    })
  })

  describe('lazy customer creation', () => {
    it('creates stripe customer and stores ID on first call', async () => {
      const { profileUpdateEq } = setupHappyPath({ existingCustomer: null })
      mockCustomerCreate.mockResolvedValue({ id: 'cus_NEW_123' })

      await POST(postJson({ plan_id: 'starter' }))

      expect(mockCustomerCreate).toHaveBeenCalledTimes(1)
      expect(mockCustomerCreate.mock.calls[0][0].email).toBe('user@rubycrawl.test')
      expect(profileUpdateEq).toHaveBeenCalledTimes(1)
      // Session uses the newly-created customer
      expect(mockSessionCreate.mock.calls[0][0].customer).toBe('cus_NEW_123')
    })

    it('reuses existing stripe_customer_id on subsequent calls', async () => {
      const { profileUpdateEq } = setupHappyPath({
        existingCustomer: 'cus_EXISTING_xyz',
      })

      await POST(postJson({ plan_id: 'starter' }))

      expect(mockCustomerCreate).not.toHaveBeenCalled()
      expect(profileUpdateEq).not.toHaveBeenCalled()
      expect(mockSessionCreate.mock.calls[0][0].customer).toBe('cus_EXISTING_xyz')
    })
  })
})
