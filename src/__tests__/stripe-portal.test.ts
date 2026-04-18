/**
 * M2F4 stripe-portal-api — unit tests.
 *
 * VAL-BILLING-021: authenticated POST returns {url} pointing at a Customer
 * Portal session. Also: 401 without auth; 400 if the caller has no
 * stripe_customer_id yet (no subscription history).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockPortalCreate = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}))

vi.mock('@/lib/stripe/client', () => ({
  stripeClient: () => ({
    billingPortal: { sessions: { create: mockPortalCreate } },
  }),
  resetStripeClient: vi.fn(),
}))

import { POST } from '@/app/api/stripe/portal/route'

function mockProfile(stripeCustomerId: string | null) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({
              data: { stripe_customer_id: stripeCustomerId },
              error: null,
            }),
          }),
        }),
      }
    }
    return {}
  })
}

describe('POST /api/stripe/portal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('returns 400 when authenticated but no stripe_customer_id', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    })
    mockProfile(null)
    const res = await POST()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 200 with Portal URL when customer exists', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    })
    mockProfile('cus_existing_abc')
    mockPortalCreate.mockResolvedValue({
      id: 'bps_test_1',
      url: 'https://billing.stripe.com/p/session/test_xyz',
    })

    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toMatch(/^https:\/\/billing\.stripe\.com\//)
  })

  it('uses the caller stripe_customer_id for the portal session', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    })
    mockProfile('cus_caller_xyz')
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/ok' })

    await POST()
    const args = mockPortalCreate.mock.calls[0][0]
    expect(args.customer).toBe('cus_caller_xyz')
    expect(args.return_url).toContain('/dashboard/billing')
  })
})
