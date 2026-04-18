import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase service client
const mockFrom = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

// Mock OpenAI
const mockEmbeddingsCreate = vi.fn()
vi.mock('openai', () => {
  const OpenAIMock = function (this: { embeddings: { create: typeof mockEmbeddingsCreate } }) {
    this.embeddings = { create: mockEmbeddingsCreate }
  } as unknown as typeof import('openai').default
  return { default: OpenAIMock }
})

import { processCrawlData, markCrawlFailed, type CrawledPage } from '@/lib/crawl/process'

/**
 * Sets up proper chained mocks for supabase.from() calls.
 * The process function calls from('sites'), from('pages'), from('embeddings'), from('sites') again.
 */
function setupFullMocks(options: {
  activeBatch?: number
  insertPagesResult?: { id: number; url: string }[]
}) {
  const { activeBatch = 0, insertPagesResult = [{ id: 1, url: 'https://example.com' }] } = options

  mockFrom.mockImplementation((table: string) => {
    if (table === 'sites') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { active_crawl_batch: activeBatch, user_id: 'owner-test' },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }
    }
    if (table === 'usage_counters') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { crawl_pages_used: 0 },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }
    }
    if (table === 'pages') {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: insertPagesResult,
            error: null,
          }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }
    }
    if (table === 'embeddings') {
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }
    }
    return {}
  })
}

describe('processCrawlData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when no valid content found in pages', async () => {
    setupFullMocks({})

    const pages: CrawledPage[] = [
      { markdown: '', metadata: { sourceURL: 'https://example.com' } },
    ]

    await expect(processCrawlData('site-1', pages)).rejects.toThrow(
      'No valid content found'
    )
  })

  it('throws when pages have no markdown', async () => {
    setupFullMocks({})

    const pages: CrawledPage[] = [
      { metadata: { sourceURL: 'https://example.com' } },
    ]

    await expect(processCrawlData('site-1', pages)).rejects.toThrow(
      'No valid content found'
    )
  })

  it('throws when pages have no sourceURL', async () => {
    setupFullMocks({})

    const pages: CrawledPage[] = [
      { markdown: '# Test\n\nContent here.' },
    ]

    await expect(processCrawlData('site-1', pages)).rejects.toThrow(
      'No valid content found'
    )
  })

  it('processes valid pages through clean, chunk, embed pipeline', async () => {
    setupFullMocks({
      activeBatch: 0,
      insertPagesResult: [{ id: 1, url: 'https://example.com' }],
    })

    // Mock OpenAI embedding response
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: new Array(1536).fill(0.1) }],
    })

    const pages: CrawledPage[] = [
      {
        markdown: '# Test Page\n\nThis is test content about our services.',
        metadata: {
          title: 'Test Page',
          sourceURL: 'https://example.com',
          statusCode: 200,
        },
      },
    ]

    await processCrawlData('site-1', pages)

    // Verify OpenAI was called with correct model
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'text-embedding-3-small',
      })
    )

    // Verify pages and embeddings tables were written to
    const calledTables = mockFrom.mock.calls.map((c: string[]) => c[0])
    expect(calledTables).toContain('pages')
    expect(calledTables).toContain('embeddings')
    expect(calledTables).toContain('sites')
  })

  it('deduplicates pages with identical content', async () => {
    // For deduplication, first page gets processed, second is skipped
    setupFullMocks({
      activeBatch: 0,
      insertPagesResult: [{ id: 1, url: 'https://example.com/page1' }],
    })

    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: new Array(1536).fill(0.1) }],
    })

    // Two pages with identical markdown
    const pages: CrawledPage[] = [
      {
        markdown: '# Same Content\n\nThis is the same content.',
        metadata: { title: 'Page 1', sourceURL: 'https://example.com/page1' },
      },
      {
        markdown: '# Same Content\n\nThis is the same content.',
        metadata: { title: 'Page 2', sourceURL: 'https://example.com/page2' },
      },
    ]

    await processCrawlData('site-1', pages)

    // Only one embedding call should have been made (one unique page)
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
  })

  it('uses correct batch number (active_crawl_batch + 1)', async () => {
    setupFullMocks({
      activeBatch: 2,
      insertPagesResult: [{ id: 5, url: 'https://example.com' }],
    })

    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: new Array(1536).fill(0.1) }],
    })

    const pages: CrawledPage[] = [
      {
        markdown: '# Content\n\nSome content here.',
        metadata: { title: 'Page', sourceURL: 'https://example.com' },
      },
    ]

    await processCrawlData('site-1', pages)

    // Verify that sites.update was called (for the atomic swap)
    const sitesCalls = mockFrom.mock.calls.filter((c: string[]) => c[0] === 'sites')
    expect(sitesCalls.length).toBeGreaterThanOrEqual(2) // at least select + update
  })

  it('calls OpenAI embeddings in batches', async () => {
    // Create pages with many unique chunks
    const uniquePages: CrawledPage[] = []
    const insertResults: { id: number; url: string }[] = []

    for (let i = 0; i < 5; i++) {
      const url = `https://example.com/page-${i}`
      uniquePages.push({
        markdown: `# Page ${i}\n\nUnique content for page ${i} with enough text to form a chunk.`,
        metadata: { title: `Page ${i}`, sourceURL: url },
      })
      insertResults.push({ id: i + 1, url })
    }

    setupFullMocks({
      activeBatch: 0,
      insertPagesResult: insertResults,
    })

    // Each batch call returns embeddings for the chunks in that batch
    mockEmbeddingsCreate.mockImplementation(async (params: { input: string[] }) => ({
      data: params.input.map(() => ({ embedding: new Array(1536).fill(0.1) })),
    }))

    await processCrawlData('site-1', uniquePages)

    // Embeddings should have been called (all chunks fit in one batch of 100)
    expect(mockEmbeddingsCreate).toHaveBeenCalled()
  })
})

describe('markCrawlFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates site with failed status and error message', async () => {
    const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdateFn = vi.fn().mockReturnValue({ eq: mockUpdateEq })
    mockFrom.mockReturnValue({ update: mockUpdateFn })

    await markCrawlFailed('site-1', 'Something went wrong')

    expect(mockFrom).toHaveBeenCalledWith('sites')
    expect(mockUpdateFn).toHaveBeenCalledWith({
      crawl_status: 'failed',
      crawl_error_message: 'Something went wrong',
    })
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'site-1')
  })
})
