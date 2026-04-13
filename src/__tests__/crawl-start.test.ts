import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock modules before importing the handler
const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockStartCrawl = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}))

vi.mock('@mendable/firecrawl-js', () => {
  const FirecrawlMock = function (this: { startCrawl: typeof mockStartCrawl }) {
    this.startCrawl = mockStartCrawl
  } as unknown as typeof import('@mendable/firecrawl-js').default
  return { default: FirecrawlMock }
})

vi.mock('@/lib/subscription', () => ({
  checkSubscription: vi.fn().mockResolvedValue({ active: true, status: 'active' }),
}))

// Import handler after mocks are set up
import { POST } from '@/app/api/crawl/start/route'

function makeRequest(body: Record<string, unknown> | null = null): Request {
  return new Request('http://localhost:3000/api/crawl/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
  })
}

describe('POST /api/crawl/start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const response = await POST(makeRequest({ url: 'https://example.com' }))
    expect(response.status).toBe(401)

    const body = await response.json()
    expect(body.error).toBeDefined()
  })

  it('returns 400 for empty URL', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const response = await POST(makeRequest({ url: '' }))
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toBeDefined()
  })

  it('returns 400 for missing URL', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const response = await POST(makeRequest({}))
    expect(response.status).toBe(400)
  })

  it('returns 400 for HTTP URL', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const response = await POST(makeRequest({ url: 'http://example.com' }))
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toMatch(/https/i)
  })

  it('returns 400 for localhost URL', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const response = await POST(makeRequest({ url: 'https://localhost' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 for private IP URL', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const response = await POST(makeRequest({ url: 'https://192.168.1.1' }))
    expect(response.status).toBe(400)
  })

  it('returns 409 when user already has a site', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    // Mock sites query: user already has a site
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'existing-site-id', url: 'https://existing.com' },
          error: null,
        }),
      }),
    })
    mockFrom.mockReturnValue({ select: selectMock })

    const response = await POST(makeRequest({ url: 'https://example.com' }))
    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body.error).toMatch(/already|exists|one site/i)
  })

  it('returns 200/201 with site_id for valid request', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    // Mock sites query: no existing site
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      }),
    })

    // Mock insert
    const insertSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'new-site-id',
        site_key: 'sk_abc123',
        url: 'https://example.com',
        crawl_status: 'crawling',
      },
      error: null,
    })
    const insertSelectMock = vi.fn().mockReturnValue({
      single: insertSingleMock,
    })
    const insertMock = vi.fn().mockReturnValue({
      select: insertSelectMock,
    })

    // Mock update
    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn().mockReturnValue({
      eq: updateEqMock,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'sites') {
        return {
          select: selectMock,
          insert: insertMock,
          update: updateMock,
        }
      }
      return {}
    })

    // Mock Firecrawl startCrawl
    mockStartCrawl.mockResolvedValue({
      id: 'crawl-job-123',
      url: 'https://api.firecrawl.dev/v2/crawl/crawl-job-123',
    })

    const response = await POST(makeRequest({ url: 'https://example.com' }))
    expect(response.status).toBeLessThanOrEqual(201)
    expect(response.status).toBeGreaterThanOrEqual(200)

    const body = await response.json()
    expect(body.site_id).toBe('new-site-id')
    expect(body.crawl_job_id).toBe('crawl-job-123')
  })

  it('calls Firecrawl startCrawl with correct config', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      }),
    })

    const insertSingleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'new-site-id',
        site_key: 'sk_abc123',
        url: 'https://example.com',
        crawl_status: 'crawling',
      },
      error: null,
    })
    const insertSelectMock = vi.fn().mockReturnValue({
      single: insertSingleMock,
    })
    const insertMock = vi.fn().mockReturnValue({
      select: insertSelectMock,
    })

    const updateEqMock = vi.fn().mockResolvedValue({ error: null })
    const updateMock = vi.fn().mockReturnValue({
      eq: updateEqMock,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'sites') {
        return {
          select: selectMock,
          insert: insertMock,
          update: updateMock,
        }
      }
      return {}
    })

    mockStartCrawl.mockResolvedValue({
      id: 'crawl-job-456',
      url: 'https://api.firecrawl.dev/v2/crawl/crawl-job-456',
    })

    await POST(makeRequest({ url: 'https://example.com' }))

    expect(mockStartCrawl).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        limit: 100,
        maxDiscoveryDepth: 3,
        scrapeOptions: {
          formats: ['markdown'],
          onlyMainContent: true,
        },
        webhook: expect.objectContaining({
          metadata: expect.objectContaining({
            site_id: 'new-site-id',
            user_id: 'user-1',
          }),
        }),
      })
    )
  })
})
