/**
 * M7F2 escalation stream-integration test.
 *
 * Exercises /api/chat/stream's pending_action trailer and handoff flag.
 * Fulfills the stream-side half of VAL-ESCAL-010 (pending_action plumbed
 * to widget via stream body) and VAL-ESCAL-015 (handoff sets
 * conversations.needs_human=true).
 *
 * The upstream LLM stream is stubbed with a deterministic text body so
 * we can assert the trailer bytes verbatim.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatSession } from '@/lib/chat/session-store'

const mockStreamText = vi.fn()
const mockServiceFrom = vi.fn()
const mockGetSession = vi.fn()
const mockDeleteSession = vi.fn()

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  generateObject: vi.fn(),
  jsonSchema: <T>(s: unknown) => s as T,
}))

vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}))

vi.mock('@/lib/chat/session-store', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/chat/session-store')
  >('@/lib/chat/session-store')
  return {
    ...actual,
    getSession: (...args: unknown[]) => mockGetSession(...args),
    deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
  }
})

const updateCalls: Array<{ id: string; patch: Record<string, unknown> }> = []
const insertCalls: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => mockServiceFrom(table),
  }),
}))

import { GET, PENDING_ACTION_SENTINEL } from '@/app/api/chat/stream/route'

beforeEach(() => {
  vi.clearAllMocks()
  updateCalls.length = 0
  insertCalls.length = 0
  mockDeleteSession.mockResolvedValue(true)
  mockServiceFrom.mockImplementation((table: string) => {
    if (table !== 'conversations') {
      throw new Error(`unexpected table: ${table}`)
    }
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        insertCalls.push(row)
        return { error: null }
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          updateCalls.push({ id, patch })
          return { error: null }
        },
      }),
    }
  })
})

function makeReq(sid: string) {
  return new Request(
    `http://localhost/api/chat/stream?sid=${sid}`
  ) as unknown as Parameters<typeof GET>[0]
}

async function readAll(res: Response): Promise<string> {
  const text = await res.text()
  return text
}

describe('canned-response path with escalation trailer', () => {
  it('emits text + \\x1E + JSON trailer when escalation fires', async () => {
    const session: ChatSession = {
      siteId: 'site-1',
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      systemPrompt: '',
      messages: [{ role: 'user', content: "what's the price" }],
      visitorIp: '1.2.3.4',
      createdAt: Date.now(),
      cannedResponse: 'Our pricing starts at $49.',
      escalationRules: [
        {
          id: 'rule-x',
          rule_type: 'keyword',
          config: { keywords: ['price'] },
          action: 'ask_email',
          action_config: {},
          priority: 0,
          created_at: '2026-04-18T00:00:00.000Z',
        },
      ],
      userMessageCount: 1,
    }
    mockGetSession.mockResolvedValueOnce(session)

    const res = await GET(makeReq('abc'))
    const body = await readAll(res)

    expect(res.status).toBe(200)
    const [text, trailer] = body.split(PENDING_ACTION_SENTINEL)
    expect(text).toBe('Our pricing starts at $49.')
    const trailerJson = JSON.parse(trailer)
    expect(trailerJson.pending_action.action).toBe('ask_email')
    expect(trailerJson.pending_action.rule_id).toBe('rule-x')
    expect(trailerJson.pending_action.via).toBe('keyword')
  })

  it('no trailer when no rule matches', async () => {
    const session: ChatSession = {
      siteId: 'site-1',
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hello' }],
      visitorIp: '1.2.3.4',
      createdAt: Date.now(),
      cannedResponse: 'Hi there!',
      escalationRules: [
        {
          id: 'rule-x',
          rule_type: 'keyword',
          config: { keywords: ['price'] },
          action: 'ask_email',
          action_config: {},
          priority: 0,
          created_at: '2026-04-18T00:00:00.000Z',
        },
      ],
      userMessageCount: 1,
    }
    mockGetSession.mockResolvedValueOnce(session)

    const res = await GET(makeReq('abc'))
    const body = await readAll(res)
    expect(body).toBe('Hi there!')
    expect(body.includes(PENDING_ACTION_SENTINEL)).toBe(false)
  })

  it('VAL-ESCAL-015: handoff action sets needs_human on conversation insert', async () => {
    const session: ChatSession = {
      siteId: 'site-1',
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      systemPrompt: '',
      messages: [{ role: 'user', content: 'your product is broken' }],
      visitorIp: '1.2.3.4',
      createdAt: Date.now(),
      cannedResponse: "Sorry to hear that — I'll find a human.",
      escalationRules: [
        {
          id: 'handoff-rule',
          rule_type: 'keyword',
          config: { keywords: ['broken'] },
          action: 'handoff',
          action_config: {},
          priority: 0,
          created_at: '2026-04-18T00:00:00.000Z',
        },
      ],
      userMessageCount: 1,
    }
    mockGetSession.mockResolvedValueOnce(session)

    const res = await GET(makeReq('abc'))
    await readAll(res)
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].needs_human).toBe(true)
  })
})

describe('RAG path with escalation trailer', () => {
  function mockStreamWithText(text: string) {
    mockStreamText.mockImplementation(() => ({
      toTextStreamResponse: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(text))
              controller.close()
            },
          })
        ),
    }))
  }

  it('appends \\x1E trailer after LLM text on match', async () => {
    mockStreamWithText('Here is the info you asked for.')
    const session: ChatSession = {
      siteId: 'site-1',
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'tell me everything' }],
      visitorIp: '1.2.3.4',
      createdAt: Date.now(),
      escalationRules: [
        {
          id: 'rule-t',
          rule_type: 'turn_count',
          config: { turns: 1 },
          action: 'show_form',
          action_config: { fields: ['name', 'email'] },
          priority: 0,
          created_at: '2026-04-18T00:00:00.000Z',
        },
      ],
      userMessageCount: 1,
    }
    mockGetSession.mockResolvedValueOnce(session)

    const res = await GET(makeReq('rag'))
    const body = await readAll(res)
    const [text, trailer] = body.split(PENDING_ACTION_SENTINEL)
    expect(text).toBe('Here is the info you asked for.')
    const trailerJson = JSON.parse(trailer)
    expect(trailerJson.pending_action.action).toBe('show_form')
    expect(trailerJson.pending_action.action_config).toEqual({
      fields: ['name', 'email'],
    })
  })

  it('RAG path without rules streams text unchanged (no trailer)', async () => {
    mockStreamWithText('plain response')
    const session: ChatSession = {
      siteId: 'site-1',
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      visitorIp: '1.2.3.4',
      createdAt: Date.now(),
      escalationRules: [],
      userMessageCount: 1,
    }
    mockGetSession.mockResolvedValueOnce(session)

    const res = await GET(makeReq('rag2'))
    const body = await readAll(res)
    expect(body).toBe('plain response')
    expect(body.includes(PENDING_ACTION_SENTINEL)).toBe(false)
  })
})
