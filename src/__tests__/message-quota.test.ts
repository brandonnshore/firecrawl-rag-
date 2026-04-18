/**
 * M3F2 message-quota-enforcement — route-level gating.
 *
 * Asserts:
 *   VAL-QUOTA-001: successful chat increments messages_used by 1
 *                  (proven by the RPC being invoked with the right args).
 *   VAL-QUOTA-002: at-budget request returns 402 with upgrade_url and
 *                  does NOT call OpenAI embed().
 *   Plan resolution: owner plan_id -> plans.monthly_message_limit.
 *   Trial fallback: plan_id null uses the Starter default (2000).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { embed } from 'ai'

const { mockChatFrom, mockRpc, mockStoreSession } = vi.hoisted(() => ({
  mockChatFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockStoreSession: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: mockChatFrom,
    rpc: mockRpc,
  }),
}))

vi.mock('@/lib/subscription', () => ({
  checkSubscription: vi.fn().mockResolvedValue({ active: true, status: 'active' }),
}))

vi.mock('ai', () => ({
  embed: vi.fn(async () => ({ embedding: new Array(1536).fill(0.1) })),
}))
vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}))
vi.mock('@/lib/chat/query-rewrite', () => ({
  rewriteQuery: vi.fn(async (m: string) => m),
}))
vi.mock('@/lib/chat/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}))
vi.mock('@/lib/chat/session-store', () => ({
  storeSession: (...args: unknown[]) => mockStoreSession(...args),
}))

import { POST } from '@/app/api/chat/session/route'

function seedSiteAndPlan(opts: {
  owner?: string
  planId?: string | null
  messageLimit?: number
}) {
  const { owner = 'owner-1', planId = 'starter', messageLimit = 2000 } = opts

  mockChatFrom.mockImplementation((table: string) => {
    if (table === 'sites') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'site-1',
                user_id: owner,
                url: 'https://acme.test',
                name: 'Acme',
                crawl_status: 'ready',
                calendly_url: null,
                google_maps_url: null,
              },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { plan_id: planId },
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
            maybeSingle: vi.fn().mockResolvedValue({
              data: planId
                ? { id: planId, monthly_message_limit: messageLimit }
                : null,
              error: null,
            }),
          }),
        }),
      }
    }
    return {}
  })
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/chat/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0]
}

describe('/api/chat/session message-quota gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // match_chunks RPC called after the quota gate — return empty results
    // so downstream code doesn't explode.
    mockRpc.mockImplementation((name: string) => {
      if (name === 'increment_message_counter') {
        return Promise.resolve({
          data: { ok: true, used: 1, limit: 2000 },
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    })
  })

  it('VAL-QUOTA-001: invokes increment_message_counter with owner id + plan limit', async () => {
    seedSiteAndPlan({ owner: 'owner-42', planId: 'pro', messageLimit: 7500 })
    const res = await POST(makeRequest({ message: 'hi', site_key: 'sk_x' }))
    expect(res.status).toBe(200)

    const incrementCall = mockRpc.mock.calls.find(
      (c) => c[0] === 'increment_message_counter'
    )
    expect(incrementCall).toBeDefined()
    expect(incrementCall![1]).toEqual({
      p_user_id: 'owner-42',
      p_limit: 7500,
    })
  })

  it('VAL-QUOTA-002: at-budget returns 402 with upgrade_url and does NOT call embed()', async () => {
    seedSiteAndPlan({ owner: 'owner-1', planId: 'starter', messageLimit: 2000 })
    mockRpc.mockImplementation((name: string) => {
      if (name === 'increment_message_counter') {
        return Promise.resolve({
          data: { ok: false, used: 2000, limit: 2000 },
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    })

    const res = await POST(makeRequest({ message: 'hi', site_key: 'sk_x' }))
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toBe('quota_exceeded')
    expect(body.upgrade_url).toBe('/dashboard/billing')
    expect(embed).not.toHaveBeenCalled()
    expect(mockStoreSession).not.toHaveBeenCalled()
  })

  it('falls back to Starter limit (2000) when owner has no plan_id', async () => {
    seedSiteAndPlan({ owner: 'owner-trial', planId: null })
    await POST(makeRequest({ message: 'hi', site_key: 'sk_x' }))
    const incrementCall = mockRpc.mock.calls.find(
      (c) => c[0] === 'increment_message_counter'
    )
    expect(incrementCall![1].p_limit).toBe(2000)
  })

  it('returns 500 when RPC errors (distinguishes from quota denial)', async () => {
    seedSiteAndPlan({ owner: 'owner-1', planId: 'starter' })
    mockRpc.mockImplementation((name: string) => {
      if (name === 'increment_message_counter') {
        return Promise.resolve({
          data: null,
          error: { message: 'db down' },
        })
      }
      return Promise.resolve({ data: [], error: null })
    })

    const res = await POST(makeRequest({ message: 'hi', site_key: 'sk_x' }))
    expect(res.status).toBe(500)
  })

  it('still runs quota gate even for trialing owner (any chat burns a message)', async () => {
    // Override subscription mock to trialing
    const subMod = await import('@/lib/subscription')
    vi.mocked(subMod.checkSubscription).mockResolvedValueOnce({
      active: true,
      status: 'trialing',
    })
    seedSiteAndPlan({ owner: 'owner-trial', planId: null })
    await POST(makeRequest({ message: 'hi', site_key: 'sk_x' }))
    expect(
      mockRpc.mock.calls.some((c) => c[0] === 'increment_message_counter')
    ).toBe(true)
  })
})
