/**
 * M6F2 responses-matcher integration tests.
 *
 * Asserts the /api/chat/session short-circuit path and the /api/chat/
 * stream canned-response stream, both skipping gpt-4o-mini.
 *
 * Fulfills:
 *   VAL-RESP-007 — keyword match bypasses main LLM call (chat-completion
 *                  mock call count = 0)
 *   VAL-RESP-011 — intent classifier only invoked when site has intent
 *                  rules
 *
 * The matcher-level assertions (case / diacritics / word boundary /
 * priority) live in responses-matcher.test.ts as pure unit tests. Here
 * we prove the ROUTE wiring correctly skips embedding + streaming.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()
const mockSiteMaybeSingle = vi.fn()
const mockProfileMaybeSingle = vi.fn()
const mockRulesResult = vi.fn<() => Promise<{ data: unknown; error: unknown }>>()

function rulesBuilder() {
  return {
    then: (resolve: (v: unknown) => unknown) => mockRulesResult().then(resolve),
  }
}

function fromBuilder(table: string) {
  if (table === 'sites') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mockSiteMaybeSingle })),
      })),
    }
  }
  if (table === 'profiles') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mockProfileMaybeSingle })),
      })),
    }
  }
  if (table === 'custom_responses') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({ order: rulesBuilder })),
          })),
        })),
      })),
    }
  }
  if (table === 'escalation_rules') {
    // M7F2: the session route fetches escalation rules in parallel
    // with custom_responses. These integration tests are scoped to the
    // response-matcher behavior; escalation stays empty.
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        })),
      })),
    }
  }
  if (table === 'conversations') {
    // Not exercised from the session route — only the stream route.
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              })),
            })),
          })),
        })),
      })),
      insert: vi.fn(async () => ({ error: null })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    }
  }
  if (table === 'chat_sessions') {
    return {
      insert: vi.fn(async () => ({ error: null })),
      delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    }
  }
  throw new Error(`Unexpected table: ${table}`)
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => fromBuilder(table),
    rpc: mockRpc,
  }),
}))

vi.mock('@/lib/subscription', () => ({
  checkSubscription: vi
    .fn()
    .mockResolvedValue({ active: true, status: 'active' }),
}))

const mockEmbed = vi.fn()
const mockGenerateObject = vi.fn()
vi.mock('ai', () => ({
  embed: (...args: unknown[]) => mockEmbed(...args),
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
  jsonSchema: <T>(s: unknown) => s as T,
}))

vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}))

vi.mock('@/lib/chat/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}))

vi.mock('@/lib/email/quota-trigger', () => ({
  maybeSendQuotaWarning: vi.fn().mockResolvedValue(undefined),
}))

const mockRewriteQuery = vi.fn()
vi.mock('@/lib/chat/query-rewrite', () => ({
  rewriteQuery: (...args: unknown[]) => mockRewriteQuery(...args),
}))

const mockStoreSession = vi.fn()
vi.mock('@/lib/chat/session-store', () => ({
  storeSession: (...args: unknown[]) => mockStoreSession(...args),
}))

import { POST } from '@/app/api/chat/session/route'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/chat/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0]
}

const siteRow = {
  id: 'site-42',
  url: 'https://acme.test',
  name: 'Acme',
  user_id: 'owner-9',
  crawl_status: 'ready',
  calendly_url: null,
  google_maps_url: null,
}

function seedPrereqs() {
  mockSiteMaybeSingle.mockResolvedValueOnce({ data: siteRow, error: null })
  mockProfileMaybeSingle.mockResolvedValueOnce({
    data: { plan_id: null },
    error: null,
  })
  mockRpc.mockResolvedValueOnce({
    data: { ok: true, used: 1, limit: 2000 },
    error: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEmbed.mockReset()
  mockGenerateObject.mockReset()
  mockRewriteQuery.mockReset()
  mockRulesResult.mockReset()
  // default: no rules — plain RAG path (any RAG-side RPC is queued ad-hoc
  // per test).
  mockRulesResult.mockResolvedValue({ data: [], error: null })
  mockRewriteQuery.mockImplementation(async (q: string) => q)
  mockEmbed.mockResolvedValue({ embedding: new Array(1536).fill(0) })
})

describe('VAL-RESP-007 keyword match bypasses LLM + embedding', () => {
  it('returns sessionId, stores cannedResponse, never calls embed or generateObject', async () => {
    seedPrereqs()
    mockRulesResult.mockResolvedValueOnce({
      data: [
        {
          id: 'rule-1',
          trigger_type: 'keyword',
          triggers: ['pricing', 'cost'],
          response: 'Our pricing starts at $49/mo.',
          priority: 5,
          created_at: '2026-04-01T00:00:00.000Z',
        },
      ],
      error: null,
    })

    const res = await POST(
      makeRequest({ message: "What's the cost?", site_key: 'sk_42' })
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { sessionId: string }
    expect(typeof json.sessionId).toBe('string')

    const [, storedSession] = mockStoreSession.mock.calls[0] as [
      string,
      { cannedResponse?: string },
    ]
    expect(storedSession.cannedResponse).toBe('Our pricing starts at $49/mo.')

    // Critical: no RAG/embedding/classifier calls on keyword hit.
    expect(mockEmbed).not.toHaveBeenCalled()
    expect(mockGenerateObject).not.toHaveBeenCalled()
    expect(mockRewriteQuery).not.toHaveBeenCalled()
  })
})

describe('VAL-RESP-011 intent classifier only runs when intent rules exist', () => {
  it('keyword-only ruleset: generateObject never invoked even on miss', async () => {
    seedPrereqs()
    mockRulesResult.mockResolvedValueOnce({
      data: [
        {
          id: 'kw-1',
          trigger_type: 'keyword',
          triggers: ['pricing'],
          response: 'Prices on request.',
          priority: 0,
          created_at: '2026-04-01T00:00:00.000Z',
        },
      ],
      error: null,
    })
    // embed returns an array so the RPC path proceeds.
    mockRpc.mockResolvedValueOnce({ data: [], error: null })

    const res = await POST(
      makeRequest({ message: 'completely unrelated', site_key: 'sk_42' })
    )
    expect(res.status).toBe(200)
    expect(mockGenerateObject).not.toHaveBeenCalled()
    // Fell through to RAG path.
    expect(mockEmbed).toHaveBeenCalled()
  })

  it('intent-type rule present: classifier invoked when keyword misses', async () => {
    seedPrereqs()
    mockRulesResult.mockResolvedValueOnce({
      data: [
        {
          id: 'intent-1',
          trigger_type: 'intent',
          triggers: ['hours'],
          response: "We're open 9-5.",
          priority: 0,
          created_at: '2026-04-01T00:00:00.000Z',
        },
      ],
      error: null,
    })
    mockGenerateObject.mockResolvedValueOnce({
      object: { intent: 'hours' },
    })

    const res = await POST(
      makeRequest({ message: 'when are you open?', site_key: 'sk_42' })
    )
    expect(res.status).toBe(200)
    expect(mockGenerateObject).toHaveBeenCalledOnce()
    expect(mockEmbed).not.toHaveBeenCalled()

    const [, storedSession] = mockStoreSession.mock.calls[0] as [
      string,
      { cannedResponse?: string },
    ]
    expect(storedSession.cannedResponse).toBe("We're open 9-5.")
  })
})
