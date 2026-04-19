import { describe, it, expect, vi, beforeEach } from 'vitest'

// M8F6 /api/widget/config endpoint — pre-flight that answers the widget
// loader. Gates 200 on (site exists + subscription active + crawl ready).

const mockSiteMaybeSingle = vi.fn()

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== 'sites') throw new Error(`unexpected table ${table}`)
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: mockSiteMaybeSingle,
          })),
        })),
      }
    },
  })),
}))

const mockCheckSubscription = vi.fn()
vi.mock('@/lib/subscription', () => ({
  checkSubscription: (...args: unknown[]) => mockCheckSubscription(...args),
}))

import { GET } from '@/app/api/widget/config/route'

function req(query: string): Request {
  return new Request(`http://localhost/api/widget/config${query}`, {
    method: 'GET',
  })
}

describe('GET /api/widget/config', () => {
  beforeEach(() => {
    mockSiteMaybeSingle.mockReset()
    mockCheckSubscription.mockReset()
  })

  it('returns 400 when site_key is missing', async () => {
    const res = await GET(req(''))
    expect(res.status).toBe(400)
  })

  it('returns 404 when no site matches the key', async () => {
    mockSiteMaybeSingle.mockResolvedValue({ data: null })
    const res = await GET(req('?site_key=sk_nope'))
    expect(res.status).toBe(404)
  })

  it('returns 402 when the owner subscription is inactive', async () => {
    mockSiteMaybeSingle.mockResolvedValue({
      data: {
        id: 'site-1',
        user_id: 'user-1',
        crawl_status: 'ready',
      },
    })
    mockCheckSubscription.mockResolvedValue({
      active: false,
      reason: 'past_due',
    })
    const res = await GET(req('?site_key=sk_ok'))
    expect(res.status).toBe(402)
  })

  it('returns 503 when crawl status is not ready', async () => {
    mockSiteMaybeSingle.mockResolvedValue({
      data: {
        id: 'site-1',
        user_id: 'user-1',
        crawl_status: 'crawling',
      },
    })
    mockCheckSubscription.mockResolvedValue({ active: true })
    const res = await GET(req('?site_key=sk_ok'))
    expect(res.status).toBe(503)
  })

  it('returns 200 ready:true when everything checks out', async () => {
    mockSiteMaybeSingle.mockResolvedValue({
      data: {
        id: 'site-1',
        user_id: 'user-1',
        crawl_status: 'ready',
      },
    })
    mockCheckSubscription.mockResolvedValue({ active: true })
    const res = await GET(req('?site_key=sk_ok'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ready: boolean }
    expect(body.ready).toBe(true)
  })
})
