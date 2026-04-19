import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()
const mockSiteMaybeSingle = vi.fn()
const mockProfileMaybeSingle = vi.fn()

// Table-routed mock: different Supabase chains per table name. The route
// queries sites (select+eq+maybeSingle), profiles (select+eq+maybeSingle
// via the quota limit lookup), and custom_responses (select+eq+eq+order+
// order). We return empty rules by default so the canned-response path
// is skipped in happy-path tests; the LLM-bypass case lives in
// responses-integration.test.ts.
function thenable<T>(value: T) {
  // PostgREST builders are thenables; awaiting returns { data, error }.
  return {
    then: (resolve: (v: T) => unknown) => Promise.resolve(resolve(value)),
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
  if (table === 'custom_responses' || table === 'escalation_rules') {
    // M6F2 + M7F2: both are empty-by-default in the generic happy-path
    // tests; canned-response / escalation behavior lives in dedicated
    // integration suites.
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn(() => thenable({ data: [], error: null })),
            })),
          })),
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

vi.mock('@/lib/chat/query-rewrite', () => ({
  rewriteQuery: vi.fn(async (msg: string) => msg),
}))

vi.mock('ai', () => ({
  embed: vi.fn(async () => ({ embedding: new Array(1536).fill(0.1) })),
  generateObject: vi.fn(),
  jsonSchema: <T>(s: unknown) => s as T,
}))

vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}))

vi.mock('@/lib/chat/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}))

const mockStoreSession = vi.fn()
vi.mock('@/lib/chat/session-store', () => ({
  storeSession: (...args: unknown[]) => mockStoreSession(...args),
}))

import { POST } from '@/app/api/chat/session/route'
import { checkRateLimit } from '@/lib/chat/rate-limit'

function makeRequest(body: unknown, ip = '1.2.3.4') {
  return new Request('http://localhost/api/chat/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0]
}

describe('POST /api/chat/session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSiteMaybeSingle.mockReset()
    mockProfileMaybeSingle.mockReset()
    mockRpc.mockReset()
    ;(checkRateLimit as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      allowed: true,
    })
  })

  it('returns 400 on invalid JSON', async () => {
    const req = new Request('http://localhost/api/chat/session', {
      method: 'POST',
      body: 'not json',
    }) as unknown as Parameters<typeof POST>[0]
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 on empty message', async () => {
    const res = await POST(makeRequest({ message: '', site_key: 'sk_abc' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on message > 500 chars', async () => {
    const res = await POST(
      makeRequest({ message: 'x'.repeat(501), site_key: 'sk_abc' })
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 on missing site_key', async () => {
    const res = await POST(makeRequest({ message: 'hi' }))
    expect(res.status).toBe(400)
  })

  it('returns 404 on invalid site_key', async () => {
    mockSiteMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const res = await POST(
      makeRequest({ message: 'hi', site_key: 'sk_invalid' })
    )
    expect(res.status).toBe(404)
  })

  it('returns 503 when site not ready', async () => {
    mockSiteMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'site-1',
        url: 'https://acme.test',
        name: 'Acme',
        user_id: 'owner-1',
        crawl_status: 'crawling',
        calendly_url: null,
        google_maps_url: null,
      },
      error: null,
    })
    const res = await POST(makeRequest({ message: 'hi', site_key: 'sk_ok' }))
    expect(res.status).toBe(503)
  })

  it('returns 429 when rate limited', async () => {
    mockSiteMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'site-1',
        url: 'https://acme.test',
        name: 'Acme',
        user_id: 'owner-1',
        crawl_status: 'ready',
        calendly_url: null,
        google_maps_url: null,
      },
      error: null,
    })
    ;(checkRateLimit as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      allowed: false,
      retryAfterMs: 2500,
    })
    const res = await POST(makeRequest({ message: 'hi', site_key: 'sk_ok' }))
    expect(res.status).toBe(429)
  })

  it('returns 200 with sessionId on success', async () => {
    mockSiteMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'site-1',
        url: 'https://acme.test',
        name: 'Acme',
        user_id: 'owner-1',
        crawl_status: 'ready',
        calendly_url: null,
        google_maps_url: null,
      },
      error: null,
    })
    mockProfileMaybeSingle.mockResolvedValueOnce({
      data: { plan_id: null },
      error: null,
    })
    mockRpc
      .mockResolvedValueOnce({
        data: { ok: true, used: 1, limit: 2000 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ chunk_text: 'test', source_url: 'https://acme.test/x' }],
        error: null,
      })

    const res = await POST(makeRequest({ message: 'hi', site_key: 'sk_ok' }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { sessionId: string }
    expect(typeof json.sessionId).toBe('string')
    expect(json.sessionId.length).toBeGreaterThan(0)
    expect(mockStoreSession).toHaveBeenCalledOnce()
    // Canned-response path NOT taken: session stored without cannedResponse.
    const [, storedSession] = mockStoreSession.mock.calls[0] as [
      string,
      { cannedResponse?: string },
    ]
    expect(storedSession.cannedResponse).toBeUndefined()
  })
})

describe('OPTIONS /api/chat/session', () => {
  it('returns 204 with CORS headers', async () => {
    const { OPTIONS } = await import('@/app/api/chat/session/route')
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
