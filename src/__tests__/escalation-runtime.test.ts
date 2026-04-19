/**
 * M7F2 escalation-runtime unit tests.
 *
 * Fulfills:
 *   VAL-ESCAL-006 — priority determines match order
 *   VAL-ESCAL-007 — turn_count fires on Nth turn
 *   VAL-ESCAL-008 — keyword fires on match (reusing M6F2 matcher)
 *   VAL-ESCAL-009 — intent fires on match (mocked classifier)
 */

import { describe, it, expect, vi } from 'vitest'
import {
  evaluateEscalation,
  type EscalationRule,
} from '@/lib/chat/escalation'

// response-matcher imports the 'ai' module at top-level; stub its
// surface so the pure test doesn't pull any OpenAI dep.
vi.mock('ai', () => ({
  generateObject: vi.fn(),
  jsonSchema: <T>(s: unknown) => s as T,
}))
vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}))

function rule(overrides: Partial<EscalationRule> = {}): EscalationRule {
  return {
    id: crypto.randomUUID(),
    rule_type: 'turn_count',
    config: { turns: 3 },
    action: 'ask_email',
    action_config: {},
    priority: 0,
    created_at: '2026-04-18T00:00:00.000Z',
    ...overrides,
  }
}

describe('evaluateEscalation — turn_count', () => {
  it('VAL-ESCAL-007: fires when userMessageCount >= config.turns', async () => {
    const r = rule({ rule_type: 'turn_count', config: { turns: 3 } })
    const match = await evaluateEscalation({
      message: 'hi',
      userMessageCount: 3,
      rules: [r],
    })
    expect(match?.rule_id).toBe(r.id)
    expect(match?.via).toBe('turn_count')
    expect(match?.action).toBe('ask_email')
  })

  it('does not fire before threshold', async () => {
    const r = rule({ rule_type: 'turn_count', config: { turns: 3 } })
    const match = await evaluateEscalation({
      message: 'hi',
      userMessageCount: 2,
      rules: [r],
    })
    expect(match).toBeNull()
  })

  it('ignores non-numeric config.turns', async () => {
    const r = rule({
      rule_type: 'turn_count',
      config: { turns: 'three' },
    })
    const match = await evaluateEscalation({
      message: 'hi',
      userMessageCount: 99,
      rules: [r],
    })
    expect(match).toBeNull()
  })
})

describe('evaluateEscalation — keyword', () => {
  it('VAL-ESCAL-008: fires when message contains keyword', async () => {
    const r = rule({
      rule_type: 'keyword',
      config: { keywords: ['price', 'cost'] },
      action: 'ask_email',
    })
    const match = await evaluateEscalation({
      message: "what's the price",
      userMessageCount: 1,
      rules: [r],
    })
    expect(match?.rule_id).toBe(r.id)
    expect(match?.via).toBe('keyword')
  })

  it('word-boundary semantics — "pricing" does not match "price"', async () => {
    const r = rule({
      rule_type: 'keyword',
      config: { keywords: ['price'] },
    })
    const match = await evaluateEscalation({
      message: 'pricing plans',
      userMessageCount: 1,
      rules: [r],
    })
    expect(match).toBeNull()
  })

  it('case + diacritic insensitive', async () => {
    const r = rule({
      rule_type: 'keyword',
      config: { keywords: ['café'] },
    })
    const match = await evaluateEscalation({
      message: 'I love the CAFE',
      userMessageCount: 1,
      rules: [r],
    })
    expect(match?.via).toBe('keyword')
  })

  it('skips rules with non-array keywords config', async () => {
    const r = rule({
      rule_type: 'keyword',
      config: { keywords: 'price' },
    })
    const match = await evaluateEscalation({
      message: 'price',
      userMessageCount: 1,
      rules: [r],
    })
    expect(match).toBeNull()
  })
})

describe('evaluateEscalation — intent', () => {
  it('VAL-ESCAL-009: classifies once and matches by label', async () => {
    const classifier = vi.fn().mockResolvedValue('complaint')
    const r = rule({
      rule_type: 'intent',
      config: { intents: ['complaint', 'refund'] },
      action: 'handoff',
    })
    const match = await evaluateEscalation({
      message: 'this is broken',
      userMessageCount: 1,
      rules: [r],
      classifier,
    })
    expect(classifier).toHaveBeenCalledOnce()
    expect(match?.via).toBe('intent')
    expect(match?.intent).toBe('complaint')
    expect(match?.action).toBe('handoff')
  })

  it('uses preClassifiedIntent without invoking classifier', async () => {
    const classifier = vi.fn()
    const r = rule({
      rule_type: 'intent',
      config: { intents: ['hours'] },
    })
    const match = await evaluateEscalation({
      message: 'when are you open',
      userMessageCount: 1,
      rules: [r],
      classifier,
      preClassifiedIntent: 'hours',
    })
    expect(classifier).not.toHaveBeenCalled()
    expect(match?.intent).toBe('hours')
  })

  it('classifier returning null skips intent rules', async () => {
    const classifier = vi.fn().mockResolvedValue(null)
    const r = rule({
      rule_type: 'intent',
      config: { intents: ['complaint'] },
    })
    const match = await evaluateEscalation({
      message: 'something irrelevant',
      userMessageCount: 1,
      rules: [r],
      classifier,
    })
    expect(classifier).toHaveBeenCalledOnce()
    expect(match).toBeNull()
  })

  it('classifier receives (message, labels) and fires at most once', async () => {
    const classifier = vi.fn(async (): Promise<string | null> => 'billing')
    const r1 = rule({
      rule_type: 'intent',
      config: { intents: ['hours'] },
      priority: 2,
    })
    const r2 = rule({
      rule_type: 'intent',
      config: { intents: ['billing'] },
      priority: 1,
    })
    const match = await evaluateEscalation({
      message: 'card declined',
      userMessageCount: 1,
      rules: [r1, r2],
      classifier,
    })
    expect(classifier).toHaveBeenCalledOnce()
    expect(classifier.mock.calls[0][0]).toBe('card declined')
    expect(classifier.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['hours', 'billing'])
    )
    expect(match?.rule_id).toBe(r2.id)
  })
})

describe('evaluateEscalation — priority + short-circuit', () => {
  it('VAL-ESCAL-006: higher priority wins over a later-priority match', async () => {
    const lowKw = rule({
      id: 'low',
      rule_type: 'keyword',
      config: { keywords: ['price'] },
      priority: 0,
    })
    const highTurn = rule({
      id: 'high',
      rule_type: 'turn_count',
      config: { turns: 1 },
      priority: 5,
      action: 'handoff',
    })
    const match = await evaluateEscalation({
      message: "what's the price",
      userMessageCount: 1,
      rules: [lowKw, highTurn],
    })
    expect(match?.rule_id).toBe('high')
    expect(match?.action).toBe('handoff')
  })

  it('priority tie broken by older created_at', async () => {
    const older = rule({
      id: 'older',
      rule_type: 'keyword',
      config: { keywords: ['price'] },
      priority: 3,
      created_at: '2026-01-01T00:00:00.000Z',
    })
    const newer = rule({
      id: 'newer',
      rule_type: 'keyword',
      config: { keywords: ['price'] },
      priority: 3,
      created_at: '2026-04-01T00:00:00.000Z',
    })
    const match = await evaluateEscalation({
      message: 'price',
      userMessageCount: 1,
      rules: [newer, older],
    })
    expect(match?.rule_id).toBe('older')
  })

  it('empty rules returns null without invoking classifier', async () => {
    const classifier = vi.fn()
    const match = await evaluateEscalation({
      message: 'hi',
      userMessageCount: 1,
      rules: [],
      classifier,
    })
    expect(match).toBeNull()
    expect(classifier).not.toHaveBeenCalled()
  })
})
