/**
 * M2F5 subscription-gate — route integration. /api/chat/session and
 * /api/crawl/start must return 402 with {error, upgrade_url} when the
 * caller / site owner has no active subscription.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockCheckSubscription,
  mockGetUser,
  mockCrawlSupabaseFrom,
  mockChatFrom,
  mockRpc,
} = vi.hoisted(() => ({
  mockCheckSubscription: vi.fn(),
  mockGetUser: vi.fn(),
  mockCrawlSupabaseFrom: vi.fn(),
  mockChatFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('@/lib/subscription', () => ({
  checkSubscription: mockCheckSubscription,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: mockCrawlSupabaseFrom,
  })),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: mockChatFrom,
    rpc: mockRpc,
  })),
}))

// Avoid calling OpenAI in tests.
vi.mock('ai', () => ({
  embed: vi.fn().mockResolvedValue({ embedding: new Array(1536).fill(0) }),
  generateObject: vi.fn(),
  jsonSchema: <T>(s: unknown) => s as T,
}))
vi.mock('@ai-sdk/openai', () => ({
  openai: { embedding: vi.fn().mockReturnValue('embedding-model') },
}))
vi.mock('@/lib/chat/query-rewrite', () => ({
  rewriteQuery: vi.fn().mockImplementation(async (m: string) => m),
}))
vi.mock('@/lib/chat/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  checkChatRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  checkCrawlRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  checkFileUploadRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  _resetRateLimit: vi.fn(),
}))
vi.mock('@/lib/chat/session-store', () => ({
  storeSession: vi.fn().mockResolvedValue(undefined),
}))

import { POST as crawlPost } from '@/app/api/crawl/start/route'
import { POST as chatPost } from '@/app/api/chat/session/route'

describe('/api/crawl/start subscription gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 402 with upgrade_url when subscription inactive', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    mockCheckSubscription.mockResolvedValue({
      active: false,
      reason: 'past_due',
      upgradeUrl: '/dashboard/billing',
    })

    const req = new Request('http://localhost/api/crawl/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    })
    const res = await crawlPost(req)
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toBe('subscription_inactive')
    expect(body.upgrade_url).toBe('/dashboard/billing')
  })
})

describe('/api/chat/session subscription gate', () => {
  beforeEach(() => vi.clearAllMocks())

  function seedSite(owner: string) {
    mockChatFrom.mockImplementation((table: string) => {
      if (table === 'sites') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'site-1',
                  user_id: owner,
                  url: 'https://owner.example',
                  name: 'Owner Site',
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
      return {}
    })
  }

  it('returns 402 with upgrade_url when SITE OWNER subscription inactive', async () => {
    seedSite('owner-1')
    mockCheckSubscription.mockResolvedValue({
      active: false,
      reason: 'trial_expired',
      upgradeUrl: '/dashboard/billing',
    })

    const req = new Request('http://localhost/api/chat/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi', site_key: 'abc' }),
    }) as unknown as Parameters<typeof chatPost>[0]
    const res = await chatPost(req)
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toBe('subscription_inactive')
    expect(body.upgrade_url).toBe('/dashboard/billing')
  })

  it('checkSubscription receives the site OWNER user_id, not the caller', async () => {
    seedSite('owner-XYZ')
    mockCheckSubscription.mockResolvedValue({
      active: false,
      reason: 'canceled',
      upgradeUrl: '/dashboard/billing',
    })

    const req = new Request('http://localhost/api/chat/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi', site_key: 'abc' }),
    }) as unknown as Parameters<typeof chatPost>[0]
    await chatPost(req)
    expect(mockCheckSubscription).toHaveBeenCalledWith('owner-XYZ')
  })
})
