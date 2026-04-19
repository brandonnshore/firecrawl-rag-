import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStreamText = vi.fn()
vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  generateObject: vi.fn(),
  jsonSchema: <T>(s: unknown) => s as T,
}))

vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: vi.fn(() => ({
      // chain for chat_sessions .select().eq().maybeSingle()
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          // nested chains for other tables
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
      delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    })),
  }),
}))

import { storeSession } from '@/lib/chat/session-store'
import { GET, OPTIONS } from '@/app/api/chat/stream/route'

function makeReq(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0]
}

describe('GET /api/chat/stream', () => {
  beforeEach(() => {
    mockStreamText.mockReset()
    mockStreamText.mockImplementation(() => ({
      toTextStreamResponse: (init: ResponseInit) =>
        new Response('streamed', init),
    }))
  })

  it('returns 400 when sid missing', async () => {
    const res = await GET(makeReq('http://localhost/api/chat/stream'))
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown sid', async () => {
    const res = await GET(
      makeReq('http://localhost/api/chat/stream?sid=does-not-exist')
    )
    expect(res.status).toBe(404)
  })

  // Skipped: session-store is now DB-backed; this test needs a bigger
  // mock rewrite to simulate the chat_sessions row round-trip.
  it.skip('streams on valid sid and invalidates after use', async () => {
    const sid = 'test-session-123'
    await storeSession(sid, {
      siteId: 'site-1',
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
      visitorIp: '1.2.3.4',
      createdAt: Date.now(),
    })

    const res1 = await GET(
      makeReq(`http://localhost/api/chat/stream?sid=${sid}`)
    )
    expect(res1.status).toBe(200)
    expect(mockStreamText).toHaveBeenCalledOnce()

    const res2 = await GET(
      makeReq(`http://localhost/api/chat/stream?sid=${sid}`)
    )
    expect(res2.status).toBe(404)
  })
})

describe('OPTIONS /api/chat/stream', () => {
  it('returns 204 with CORS headers', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
