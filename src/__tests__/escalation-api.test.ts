/**
 * M7F3 escalation API unit tests.
 *
 * Covers POST /api/escalation-rules (create), PATCH /{id} (update),
 * DELETE /{id}, POST /reorder (bulk priority).
 *
 * Fulfills (in part): VAL-ESCAL-002 turn_count create, VAL-ESCAL-003
 * keyword create, VAL-ESCAL-004 intent create, VAL-ESCAL-005 reorder
 * persists priority.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockSiteMaybeSingle = vi.fn()
const mockRulesInsert = vi.fn()
const mockRulesSelect = vi.fn()
const mockRulesUpdate = vi.fn()
const mockRulesDelete = vi.fn()

const updateCalls: Array<{ id: string; patch: Record<string, unknown> }> = []

function fromBuilder(table: string) {
  if (table === 'sites') {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: mockSiteMaybeSingle }),
      }),
    }
  }
  if (table === 'escalation_rules') {
    return {
      insert: mockRulesInsert,
      select: mockRulesSelect,
      update: (patch: Record<string, unknown>) => {
        // For reorder: .update({priority}).eq('id', X) => record the call.
        // Individual PATCH uses the richer mockRulesUpdate chain.
        if (mockRulesUpdate.getMockImplementation()) {
          return mockRulesUpdate(patch)
        }
        return {
          eq: async (_col: string, id: string) => {
            updateCalls.push({ id, patch })
            return { error: null }
          },
        }
      },
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

import { POST as createRule } from '@/app/api/escalation-rules/route'
import {
  PATCH as patchRule,
  DELETE as deleteRule,
} from '@/app/api/escalation-rules/[id]/route'
import { POST as reorderRules } from '@/app/api/escalation-rules/reorder/route'

function makeRequest(url: string, body: unknown, method = 'POST') {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateCalls.length = 0
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  mockSiteMaybeSingle.mockResolvedValue({
    data: { id: 'site-1' },
    error: null,
  })
  mockRulesUpdate.mockReset()
})

describe('POST /api/escalation-rules — create', () => {
  it('401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await createRule(
      makeRequest('http://x/api/escalation-rules', {
        rule_type: 'turn_count',
        config: { turns: 3 },
        action: 'ask_email',
      })
    )
    expect(res.status).toBe(401)
  })

  it('400 on invalid rule_type', async () => {
    const res = await createRule(
      makeRequest('http://x/api/escalation-rules', {
        rule_type: 'gibberish',
        config: { turns: 3 },
        action: 'ask_email',
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_rule_type')
  })

  it('400 on invalid action', async () => {
    const res = await createRule(
      makeRequest('http://x/api/escalation-rules', {
        rule_type: 'turn_count',
        config: { turns: 3 },
        action: 'launch_missile',
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_action')
  })

  it('400 when turn_count config.turns is missing/non-integer', async () => {
    const res = await createRule(
      makeRequest('http://x/api/escalation-rules', {
        rule_type: 'turn_count',
        config: { turns: 'three' },
        action: 'ask_email',
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_turns')
  })

  it('400 when keyword config.keywords is empty', async () => {
    const res = await createRule(
      makeRequest('http://x/api/escalation-rules', {
        rule_type: 'keyword',
        config: { keywords: [] },
        action: 'ask_email',
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('keywords_required')
  })

  it('400 when intent config.intents is empty', async () => {
    const res = await createRule(
      makeRequest('http://x/api/escalation-rules', {
        rule_type: 'intent',
        config: { intents: [] },
        action: 'handoff',
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('intents_required')
  })

  it('400 when calendly_link action has no url', async () => {
    const res = await createRule(
      makeRequest('http://x/api/escalation-rules', {
        rule_type: 'turn_count',
        config: { turns: 3 },
        action: 'calendly_link',
        action_config: {},
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('calendly_url_required')
  })

  it('400 when show_form action has no fields', async () => {
    const res = await createRule(
      makeRequest('http://x/api/escalation-rules', {
        rule_type: 'turn_count',
        config: { turns: 3 },
        action: 'show_form',
        action_config: {},
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('form_fields_required')
  })

  it('VAL-ESCAL-002: 201 on turn_count + ask_email create', async () => {
    mockRulesInsert.mockReturnValueOnce({
      select: () => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'rule-1',
            rule_type: 'turn_count',
            config: { turns: 3 },
            action: 'ask_email',
            action_config: {},
            priority: 0,
            is_active: true,
            created_at: '2026-04-18T00:00:00.000Z',
          },
          error: null,
        }),
      }),
    })
    const res = await createRule(
      makeRequest('http://x/api/escalation-rules', {
        rule_type: 'turn_count',
        config: { turns: 3 },
        action: 'ask_email',
      })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.rule.rule_type).toBe('turn_count')
    expect(body.rule.config.turns).toBe(3)
  })

  it('VAL-ESCAL-003: 201 on keyword + ask_email create', async () => {
    mockRulesInsert.mockReturnValueOnce({
      select: () => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'rule-2',
            rule_type: 'keyword',
            config: { keywords: ['price'] },
            action: 'ask_email',
            action_config: {},
            priority: 0,
            is_active: true,
            created_at: '2026-04-18T00:00:00.000Z',
          },
          error: null,
        }),
      }),
    })
    const res = await createRule(
      makeRequest('http://x/api/escalation-rules', {
        rule_type: 'keyword',
        config: { keywords: ['price'] },
        action: 'ask_email',
      })
    )
    expect(res.status).toBe(201)
  })

  it('VAL-ESCAL-004: 201 on intent + handoff create', async () => {
    mockRulesInsert.mockReturnValueOnce({
      select: () => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'rule-3',
            rule_type: 'intent',
            config: { intents: ['complaint'] },
            action: 'handoff',
            action_config: {},
            priority: 0,
            is_active: true,
            created_at: '2026-04-18T00:00:00.000Z',
          },
          error: null,
        }),
      }),
    })
    const res = await createRule(
      makeRequest('http://x/api/escalation-rules', {
        rule_type: 'intent',
        config: { intents: ['complaint'] },
        action: 'handoff',
      })
    )
    expect(res.status).toBe(201)
  })
})

describe('PATCH /api/escalation-rules/{id}', () => {
  it('partial is_active flip succeeds without full validation', async () => {
    mockRulesUpdate.mockImplementation(() => ({
      eq: () => ({
        select: () => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'rule-1',
              rule_type: 'turn_count',
              config: { turns: 3 },
              action: 'ask_email',
              action_config: {},
              priority: 0,
              is_active: false,
              created_at: '2026-04-18T00:00:00.000Z',
            },
            error: null,
          }),
        }),
      }),
    }))
    const res = await patchRule(
      makeRequest('http://x/api/escalation-rules/rule-1', { is_active: false }, 'PATCH'),
      { params: Promise.resolve({ id: 'rule-1' }) }
    )
    expect(res.status).toBe(200)
    expect((await res.json()).rule.is_active).toBe(false)
  })

  it('400 when patched action breaks invariant', async () => {
    mockRulesSelect.mockReturnValueOnce({
      eq: () => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            rule_type: 'turn_count',
            config: { turns: 3 },
            action: 'ask_email',
            action_config: {},
          },
          error: null,
        }),
      }),
    })
    const res = await patchRule(
      makeRequest(
        'http://x/api/escalation-rules/rule-1',
        { action: 'calendly_link' },
        'PATCH'
      ),
      { params: Promise.resolve({ id: 'rule-1' }) }
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('calendly_url_required')
  })
})

describe('DELETE /api/escalation-rules/{id}', () => {
  it('404 for row invisible under RLS', async () => {
    mockRulesSelect.mockReturnValueOnce({
      eq: () => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    })
    const res = await deleteRule(
      makeRequest('http://x/api/escalation-rules/ghost', null, 'DELETE'),
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
      makeRequest('http://x/api/escalation-rules/rule-1', null, 'DELETE'),
      { params: Promise.resolve({ id: 'rule-1' }) }
    )
    expect(res.status).toBe(200)
  })
})

describe('POST /api/escalation-rules/reorder — VAL-ESCAL-005', () => {
  it('401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const res = await reorderRules(
      makeRequest('http://x/api/escalation-rules/reorder', {
        rule_ids: ['a', 'b'],
      })
    )
    expect(res.status).toBe(401)
  })

  it('400 on empty / invalid rule_ids', async () => {
    const empty = await reorderRules(
      makeRequest('http://x/api/escalation-rules/reorder', { rule_ids: [] })
    )
    expect(empty.status).toBe(400)
    const bad = await reorderRules(
      makeRequest('http://x/api/escalation-rules/reorder', {
        rule_ids: ['', null],
      })
    )
    expect(bad.status).toBe(400)
  })

  it('assigns descending priorities: first id = highest', async () => {
    const res = await reorderRules(
      makeRequest('http://x/api/escalation-rules/reorder', {
        rule_ids: ['top', 'middle', 'bottom'],
      })
    )
    expect(res.status).toBe(200)
    const priorities = updateCalls.map((c) => ({ id: c.id, p: c.patch.priority }))
    expect(priorities).toEqual([
      { id: 'top', p: 3 },
      { id: 'middle', p: 2 },
      { id: 'bottom', p: 1 },
    ])
  })
})
