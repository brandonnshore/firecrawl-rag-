/**
 * M3F3 crawl-quota-enforcement — webhook-side increment in processCrawlData.
 *
 * VAL-QUOTA-004: after a successful crawl landing N pages, usage_counters
 * .crawl_pages_used for the owner increments by N.
 *
 * Unit test with mocked Supabase + OpenAI (pattern matches crawl-process.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}))

const mockEmbeddingsCreate = vi.fn()
vi.mock('openai', () => {
  const OpenAIMock = function (this: {
    embeddings: { create: typeof mockEmbeddingsCreate }
  }) {
    this.embeddings = { create: mockEmbeddingsCreate }
  } as unknown as typeof import('openai').default
  return { default: OpenAIMock }
})

import { processCrawlData, type CrawledPage } from '@/lib/crawl/process'

/**
 * Collect every update() call made against usage_counters so the test can
 * assert the exact payload and increment math.
 */
function captureUsageCounterUpdates() {
  const reads: Array<{ table: string }> = []
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []

  let currentCrawlPagesUsed = 10 // seed so we can verify increment math

  mockFrom.mockImplementation((table: string) => {
    reads.push({ table })

    if (table === 'sites') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { active_crawl_batch: 0, user_id: 'owner-42' },
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
            data: [
              { id: 1, url: 'https://example.com/a' },
              { id: 2, url: 'https://example.com/b' },
              { id: 3, url: 'https://example.com/c' },
            ],
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
    if (table === 'usage_counters') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { crawl_pages_used: currentCrawlPagesUsed },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockImplementation((payload) => {
          updates.push({ table, payload })
          currentCrawlPagesUsed =
            (payload.crawl_pages_used as number) ?? currentCrawlPagesUsed
          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }),
      }
    }
    return {}
  })

  return { reads, updates }
}

describe('processCrawlData crawl-quota increment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmbeddingsCreate.mockResolvedValue({
      data: [
        { embedding: new Array(1536).fill(0.1) },
        { embedding: new Array(1536).fill(0.2) },
        { embedding: new Array(1536).fill(0.3) },
      ],
    })
  })

  it('increments usage_counters.crawl_pages_used by the unique page count', async () => {
    const { updates } = captureUsageCounterUpdates()

    const pages: CrawledPage[] = [
      {
        markdown: '# Page A\n\nThis is substantial content about page A.',
        metadata: { title: 'A', sourceURL: 'https://example.com/a' },
      },
      {
        markdown: '# Page B\n\nThis is substantial content about page B.',
        metadata: { title: 'B', sourceURL: 'https://example.com/b' },
      },
      {
        markdown: '# Page C\n\nThis is substantial content about page C.',
        metadata: { title: 'C', sourceURL: 'https://example.com/c' },
      },
    ]

    await processCrawlData('site-1', pages)

    const usageUpdate = updates.find((u) => u.table === 'usage_counters')
    expect(usageUpdate).toBeDefined()
    // Seed was 10, three pages landed -> 13
    expect(usageUpdate!.payload.crawl_pages_used).toBe(13)
  })

  it('skips usage_counters update when 0 pages land', async () => {
    // Override mockFrom for pages to return empty insert
    const updates: Array<{ table: string; payload: Record<string, unknown> }> =
      []

    mockFrom.mockImplementation((table: string) => {
      if (table === 'sites') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { active_crawl_batch: 0, user_id: 'owner-42' },
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
          update: vi.fn().mockImplementation((payload) => {
            updates.push({ table, payload })
            return { eq: vi.fn().mockResolvedValue({ error: null }) }
          }),
        }
      }
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }
    })

    // Empty markdown -> chunker produces 0 chunks -> processCrawlData throws
    // before reaching the increment step. That's acceptable: the increment
    // only fires on successful completion (uniquePages.size > 0).
    const pages: CrawledPage[] = [
      { markdown: '', metadata: { sourceURL: 'https://example.com/x' } },
    ]
    await expect(processCrawlData('site-1', pages)).rejects.toThrow()
    expect(updates.find((u) => u.table === 'usage_counters')).toBeUndefined()
  })
})
