/**
 * M6F3 responses API unit tests. Covers POST /api/responses (create),
 * PATCH /api/responses/{id} (update), DELETE /api/responses/{id},
 * POST /api/responses/test (matcher dry-run).
 *
 * Fulfills (in part): VAL-RESP-002 add-modal validation, VAL-RESP-003
 * keyword CRUD, VAL-RESP-004 intent CRUD, VAL-RESP-012 delete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockSiteFrom = vi.fn()
const mockRulesInsert = vi.fn()
const mockRulesSelect = vi.fn()
const mockRulesUpdate = vi.fn()
const mockRulesDelete = vi.fn()
const mockRulesOrder = vi.fn()

function fromBuilder(table: string) {
  if (table === 'sites') return mockSiteFrom()
  if (table === 'custom_responses') {
    return {
      insert: mockRulesInsert,
      select: mockRulesSelect,
      update: mockRulesUpdate,
      delete: mockRulesDelete,
    }
  }
  throw new Error(`unexpected table: ${table}`)
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => fromBuilder(table),
  }),
}))

vi.mock('ai', () => ({
  generateObject: vi.fn(),
  jsonSchema: <T>(s: unknown) => s as T,
}))
vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}))

import { POST as createRule } from '@/app/api/responses/route'
import { PATCH as patchRule, DELETE as deleteRule } from '@/app/api/responses/[id]/route'
import { POST as testRule } from '@/app/api/responses/test/route'

function makeRequest(url: string, body: unknown, method = 'POST') {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  // Most tests use a single canned site row; override per-test when needed.
  mockSiteFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'site-1' },
          error: null,
        }),
      }),
    }),
  })
  mockRulesOrder.mockReset()
})

describe('POST /api/responses — create', () => {
  it('401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await createRule(
      makeRequest('http://x/api/responses', {
        trigger_type: 'keyword',
        triggers: ['pricing'],
        response: 'yes',
      })
    )
    expect(res.status).toBe(401)
  })

  it('400 on invalid trigger_type', async () => {
    const res = await createRule(
      makeRequest('http://x/api/responses', {
        trigger_type: 'foo',
        triggers: ['x'],
        response: 'y',
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_trigger_type')
  })

  it('400 on empty triggers array', async () => {
    const res = await createRule(
      makeRequest('http://x/api/responses', {
        trigger_type: 'keyword',
        triggers: [],
        response: 'y',
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('triggers_required')
  })

  it('400 on empty response', async () => {
    const res = await createRule(
      makeRequest('http://x/api/responses', {
        trigger_type: 'keyword',
        triggers: ['pricing'],
        response: '',
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('response_required')
  })

  it('400 on triggers with empty string', async () => {
    const res = await createRule(
      makeRequest('http://x/api/responses', {
        trigger_type: 'keyword',
        triggers: ['pricing', '   '],
        response: 'y',
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_triggers')
  })

  it('400 on overlong response', async () => {
    const res = await createRule(
      makeRequest('http://x/api/responses', {
        trigger_type: 'keyword',
        triggers: ['pricing'],
        response: 'x'.repeat(2001),
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('response_too_long')
  })

  it('201 with rule row on happy path', async () => {
    mockRulesInsert.mockReturnValueOnce({
      select: () => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'rule-1',
            trigger_type: 'keyword',
            triggers: ['pricing'],
            response: 'Our pricing…',
            priority: 0,
            is_active: true,
            created_at: '2026-04-18T00:00:00.000Z',
          },
          error: null,
        }),
      }),
    })
    const res = await createRule(
      makeRequest('http://x/api/responses', {
        trigger_type: 'keyword',
        triggers: ['pricing'],
        response: 'Our pricing…',
      })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.rule.id).toBe('rule-1')
  })
})

describe('DELETE /api/responses/{id}', () => {
  it('401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await deleteRule(
      makeRequest('http://x/api/responses/r1', null, 'DELETE'),
      { params: Promise.resolve({ id: 'r1' }) }
    )
    expect(res.status).toBe(401)
  })

  it('404 when rule invisible to caller (RLS)', async () => {
    mockRulesSelect.mockReturnValueOnce({
      eq: () => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    })
    const res = await deleteRule(
      makeRequest('http://x/api/responses/ghost', null, 'DELETE'),
      { params: Promise.resolve({ id: 'ghost' }) }
    )
    expect(res.status).toBe(404)
  })

  it('200 on successful delete', async () => {
    mockRulesSelect.mockReturnValueOnce({
      eq: () => ({
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: { id: 'rule-1' }, error: null }),
      }),
    })
    mockRulesDelete.mockReturnValueOnce({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const res = await deleteRule(
      makeRequest('http://x/api/responses/rule-1', null, 'DELETE'),
      { params: Promise.resolve({ id: 'rule-1' }) }
    )
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})

describe('PATCH /api/responses/{id}', () => {
  it('401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await patchRule(
      makeRequest('http://x/api/responses/r1', { is_active: false }, 'PATCH'),
      { params: Promise.resolve({ id: 'r1' }) }
    )
    expect(res.status).toBe(401)
  })

  it('updates partial field without validation (is_active only)', async () => {
    mockRulesUpdate.mockReturnValueOnce({
      eq: () => ({
        select: () => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'rule-1',
              trigger_type: 'keyword',
              triggers: ['pricing'],
              response: 'Our pricing…',
              priority: 0,
              is_active: false,
              created_at: '2026-04-18T00:00:00.000Z',
            },
            error: null,
          }),
        }),
      }),
    })
    const res = await patchRule(
      makeRequest('http://x/api/responses/rule-1', { is_active: false }, 'PATCH'),
      { params: Promise.resolve({ id: 'rule-1' }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rule.is_active).toBe(false)
  })

  it('400 on invalid patched response', async () => {
    mockRulesSelect.mockReturnValueOnce({
      eq: () => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            trigger_type: 'keyword',
            triggers: ['pricing'],
            response: 'Old',
          },
          error: null,
        }),
      }),
    })
    const res = await patchRule(
      makeRequest(
        'http://x/api/responses/rule-1',
        { response: '' },
        'PATCH'
      ),
      { params: Promise.resolve({ id: 'rule-1' }) }
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('response_required')
  })
})

describe('POST /api/responses/test — matcher dry-run', () => {
  function seedRules(rows: unknown[]) {
    // custom_responses select chain: select().eq().eq().order().order()
    mockRulesSelect.mockReturnValueOnce({
      eq: () => ({
        eq: () => ({
          order: () => ({
            order: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    })
  }

  it('401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await testRule(
      makeRequest('http://x/api/responses/test', { message: 'hi' })
    )
    expect(res.status).toBe(401)
  })

  it('400 on empty message', async () => {
    const res = await testRule(
      makeRequest('http://x/api/responses/test', { message: '' })
    )
    expect(res.status).toBe(400)
  })

  it('VAL-RESP-006: returns matched=true with rule_id + response on keyword hit', async () => {
    seedRules([
      {
        id: 'rule-1',
        trigger_type: 'keyword',
        triggers: ['pricing', 'cost'],
        response: 'Our pricing starts at $49.',
        priority: 0,
        created_at: '2026-04-18T00:00:00.000Z',
      },
    ])
    const res = await testRule(
      makeRequest('http://x/api/responses/test', {
        message: "What's the cost?",
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.matched).toBe(true)
    expect(body.rule_id).toBe('rule-1')
    expect(body.response).toBe('Our pricing starts at $49.')
    expect(body.via).toBe('keyword')
  })

  it('returns matched=false when nothing fires', async () => {
    seedRules([
      {
        id: 'rule-1',
        trigger_type: 'keyword',
        triggers: ['pricing'],
        response: 'Our pricing…',
        priority: 0,
        created_at: '2026-04-18T00:00:00.000Z',
      },
    ])
    const res = await testRule(
      makeRequest('http://x/api/responses/test', {
        message: 'totally unrelated question',
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.matched).toBe(false)
  })
})
