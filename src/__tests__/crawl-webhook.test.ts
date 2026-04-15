import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock after() from next/server
const mockAfterCallbacks: Array<() => Promise<void>> = []
vi.mock('next/server', () => ({
  after: vi.fn((cb: () => Promise<void>) => {
    mockAfterCallbacks.push(cb)
  }),
}))

// Mock Supabase service client
const mockFrom = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

// Mock the process module
const mockProcessCrawlData = vi.fn()
const mockMarkCrawlFailed = vi.fn()

vi.mock('@/lib/crawl/process', () => ({
  processCrawlData: (...args: unknown[]) => mockProcessCrawlData(...args),
  markCrawlFailed: (...args: unknown[]) => mockMarkCrawlFailed(...args),
}))

import { POST } from '@/app/api/crawl/webhook/route'

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/crawl/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/crawl/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAfterCallbacks.length = 0
  })

  it('returns 400 for invalid JSON', async () => {
    const request = new Request('http://localhost:3000/api/crawl/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 400 for missing crawl job ID', async () => {
    const response = await POST(makeRequest({ type: 'crawl.completed' }))
    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toContain('Missing crawl job ID')
  })

  it('returns 200 for fabricated crawl_job_id (not found in DB)', async () => {
    // Setup: no matching site
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })

    const response = await POST(
      makeRequest({
        id: 'fabricated-job-id',
        type: 'crawl.completed',
        data: [],
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.received).toBe(true)

    // No after() callbacks should have been scheduled
    expect(mockAfterCallbacks.length).toBe(0)
  })

  it('returns 200 for valid crawl.completed and schedules processing', async () => {
    // Setup: matching site in 'crawling' status
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'site-123', crawl_status: 'crawling' },
            error: null,
          }),
        }),
      }),
    })

    const pageData = [
      {
        markdown: '# Test Page\n\nContent here.',
        metadata: { title: 'Test Page', sourceURL: 'https://example.com' },
      },
    ]

    const response = await POST(
      makeRequest({
        id: 'valid-job-id',
        type: 'crawl.completed',
        data: pageData,
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.received).toBe(true)

    // after() callback should have been scheduled
    expect(mockAfterCallbacks.length).toBe(1)

    // Execute the callback
    mockProcessCrawlData.mockResolvedValue(undefined)
    await mockAfterCallbacks[0]()

    expect(mockProcessCrawlData).toHaveBeenCalledWith('site-123', pageData)
  })

  it('returns 200 for crawl.failed and schedules failure marking', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'site-456', crawl_status: 'crawling' },
            error: null,
          }),
        }),
      }),
    })

    const response = await POST(
      makeRequest({
        id: 'valid-job-id',
        type: 'crawl.failed',
        error: 'Rate limited',
      })
    )

    expect(response.status).toBe(200)

    expect(mockAfterCallbacks.length).toBe(1)

    mockMarkCrawlFailed.mockResolvedValue(undefined)
    await mockAfterCallbacks[0]()

    expect(mockMarkCrawlFailed).toHaveBeenCalledWith('site-456', 'Rate limited')
  })

  it('does not process site not in crawling status', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'site-789', crawl_status: 'ready' },
            error: null,
          }),
        }),
      }),
    })

    const response = await POST(
      makeRequest({
        id: 'valid-job-id',
        type: 'crawl.completed',
        data: [],
      })
    )

    expect(response.status).toBe(200)
    // No processing should be scheduled
    expect(mockAfterCallbacks.length).toBe(0)
  })

  it('acknowledges crawl.started events without processing', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'site-123', crawl_status: 'crawling' },
            error: null,
          }),
        }),
      }),
    })

    const response = await POST(
      makeRequest({
        id: 'valid-job-id',
        type: 'crawl.started',
      })
    )

    expect(response.status).toBe(200)
    expect(mockAfterCallbacks.length).toBe(0)
  })

  it('handles after() processing errors gracefully', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'site-err', crawl_status: 'crawling' },
            error: null,
          }),
        }),
      }),
    })

    const response = await POST(
      makeRequest({
        id: 'valid-job-id',
        type: 'crawl.completed',
        data: [],
      })
    )

    expect(response.status).toBe(200)

    // Simulate processing failure
    mockProcessCrawlData.mockRejectedValue(new Error('Processing failed'))
    mockMarkCrawlFailed.mockResolvedValue(undefined)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await mockAfterCallbacks[0]()

    expect(mockMarkCrawlFailed).toHaveBeenCalledWith('site-err', 'Processing failed')
    consoleSpy.mockRestore()
  })
})
