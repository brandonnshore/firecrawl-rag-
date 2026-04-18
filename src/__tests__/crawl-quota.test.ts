/**
 * M3F3 crawl-quota-enforcement — /api/crawl/start gate.
 *
 * VAL-QUOTA-004 (webhook increment side) lives in crawl-process.test.ts
 * for the processor unit. This file focuses on the start-side gate:
 *
 *   VAL-QUOTA-005: at/over-limit crawl_pages_used -> 402 and no
 *                  Firecrawl SDK call made.
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

vi.mock('@/lib/subscription', () => ({
  checkSubscription: vi.fn().mockResolvedValue({ active: true, status: 'active' }),
}))

const { mockFirecrawlStartCrawl } = vi.hoisted(() => ({
  mockFirecrawlStartCrawl: vi.fn(),
}))
vi.mock('@mendable/firecrawl-js', () => {
  const FirecrawlMock = function (this: { startCrawl: typeof mockFirecrawlStartCrawl }) {
    this.startCrawl = mockFirecrawlStartCrawl
  } as unknown as typeof import('@mendable/firecrawl-js').default
  return { default: FirecrawlMock }
})

import { POST } from '@/app/api/crawl/start/route'

function setupSupabase(opts: {
  ownerId?: string
  planId?: string | null
  crawlLimit?: number
  crawlUsed?: number
  existingSite?: boolean
}) {
  const {
    ownerId = 'u1',
    planId = 'starter',
    crawlLimit = 500,
    crawlUsed = 0,
    existingSite = false,
  } = opts

  mockFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { plan_id: planId }, error: null }),
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
                ? { id: planId, monthly_crawl_page_limit: crawlLimit }
                : null,
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'usage_counters') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { crawl_pages_used: crawlUsed },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'sites') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: existingSite ? { id: 'site-1', url: 'https://x.test' } : null,
              error: null,
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'site-new',
                site_key: 'sk_new',
                user_id: ownerId,
                url: 'https://x.test',
              },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }
    }
    return {}
  })

  mockGetUser.mockResolvedValue({
    data: { user: { id: ownerId } },
    error: null,
  })
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/crawl/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/crawl/start crawl-quota gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFirecrawlStartCrawl.mockResolvedValue({ id: 'crawl_123' })
  })

  it('VAL-QUOTA-005: returns 402 when crawl_pages_used >= plan limit', async () => {
    setupSupabase({ crawlUsed: 500, crawlLimit: 500 })
    const res = await POST(makeRequest({ url: 'https://x.test' }))
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toBe('crawl_quota_exceeded')
    expect(body.upgrade_url).toBe('/dashboard/billing')
    expect(mockFirecrawlStartCrawl).not.toHaveBeenCalled()
  })

  it('VAL-QUOTA-005: returns 402 when over limit', async () => {
    setupSupabase({ crawlUsed: 1200, crawlLimit: 500 })
    const res = await POST(makeRequest({ url: 'https://x.test' }))
    expect(res.status).toBe(402)
    expect(mockFirecrawlStartCrawl).not.toHaveBeenCalled()
  })

  it('allows crawl when under limit', async () => {
    setupSupabase({ crawlUsed: 50, crawlLimit: 500 })
    const res = await POST(makeRequest({ url: 'https://x.test' }))
    expect(res.status).toBe(200)
    expect(mockFirecrawlStartCrawl).toHaveBeenCalledTimes(1)
  })

  it('falls back to Starter crawl cap (500) when owner has no plan_id', async () => {
    setupSupabase({ planId: null, crawlUsed: 500 })
    const res = await POST(makeRequest({ url: 'https://x.test' }))
    expect(res.status).toBe(402)
    expect(mockFirecrawlStartCrawl).not.toHaveBeenCalled()
  })

  it('still returns 409 existing-site error when quota OK', async () => {
    setupSupabase({ crawlUsed: 0, existingSite: true })
    const res = await POST(makeRequest({ url: 'https://x.test' }))
    expect(res.status).toBe(409)
    expect(mockFirecrawlStartCrawl).not.toHaveBeenCalled()
  })
})
