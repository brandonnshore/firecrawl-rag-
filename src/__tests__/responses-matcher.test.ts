/**
 * M6F2 responses-matcher unit tests — pure helpers only.
 *
 * Fulfills (in part): VAL-RESP-008 case-insensitive, VAL-RESP-009 word
 * boundaries, VAL-RESP-010 priority tiebreaker. Integration asserts
 * VAL-RESP-007 (LLM bypass) and VAL-RESP-011 (classifier gate) live in
 * responses-integration.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  normalize,
  triggerMatches,
  matchKeywordRule,
  matchIntentRule,
  classifyIntent,
  matchResponse,
  type ResponseRule,
} from '@/lib/chat/response-matcher'

const mockGenerateObject = vi.fn()
vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
  jsonSchema: <T>(schema: unknown) => schema as T,
}))
vi.mock('@ai-sdk/openai', () => ({
  openai: Object.assign(() => ({}), { embedding: () => ({}) }),
}))

function rule(overrides: Partial<ResponseRule> = {}): ResponseRule {
  return {
    id: crypto.randomUUID(),
    trigger_type: 'keyword',
    triggers: ['pricing'],
    response: 'Our pricing starts at $49/mo.',
    priority: 0,
    created_at: '2026-04-18T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockGenerateObject.mockReset()
})

describe('normalize', () => {
  it('lowercases', () => {
    expect(normalize('HELP')).toBe('help')
  })
  it('strips diacritics', () => {
    expect(normalize('café')).toBe('cafe')
    expect(normalize('naïve')).toBe('naive')
    expect(normalize('Zürich')).toBe('zurich')
  })
  it('collapses whitespace', () => {
    expect(normalize('  hello   world  ')).toBe('hello world')
  })
})

describe('triggerMatches — word boundary', () => {
  it('VAL-RESP-008: case-insensitive Help matches many forms', () => {
    expect(triggerMatches('help me', 'Help')).toBe(true)
    expect(triggerMatches('HELP', 'Help')).toBe(true)
    expect(triggerMatches('Help?', 'Help')).toBe(true)
    expect(triggerMatches('Can you help me please', 'Help')).toBe(true)
  })

  it('VAL-RESP-009: word boundary blocks substring matches', () => {
    expect(triggerMatches('helper available', 'help')).toBe(false)
    expect(triggerMatches('alphelp', 'help')).toBe(false)
    expect(triggerMatches('helpless mood', 'help')).toBe(false)
  })

  it('diacritic-insensitive: café matches cafe', () => {
    expect(triggerMatches('where is your cafe', 'café')).toBe(true)
    expect(triggerMatches('I love café au lait', 'cafe')).toBe(true)
  })

  it('handles multi-word triggers as phrases', () => {
    expect(triggerMatches('what are your business hours', 'business hours')).toBe(
      true
    )
    expect(triggerMatches('businesshours', 'business hours')).toBe(false)
  })

  it('empty trigger never matches', () => {
    expect(triggerMatches('hello world', '')).toBe(false)
  })

  it('regex metacharacters in trigger are escaped', () => {
    expect(triggerMatches('call 1.800.555.0123', '1.800.555.0123')).toBe(true)
    // the dot should not act as "any char" — below must NOT match
    expect(triggerMatches('call 1x800x555x0123', '1.800.555.0123')).toBe(false)
  })
})

describe('matchKeywordRule — priority tiebreak', () => {
  it('returns null when no rules', () => {
    expect(matchKeywordRule('hi there', [])).toBeNull()
  })

  it('returns null when nothing matches', () => {
    const rules = [rule({ triggers: ['pricing'] })]
    expect(matchKeywordRule('how do i signup', rules)).toBeNull()
  })

  it('single match returns that rule', () => {
    const r = rule({ triggers: ['pricing', 'cost'] })
    const hit = matchKeywordRule("what's the cost?", [r])
    expect(hit?.id).toBe(r.id)
  })

  it('VAL-RESP-010: higher priority wins', () => {
    const low = rule({
      id: 'low',
      triggers: ['price'],
      priority: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    })
    const high = rule({
      id: 'high',
      triggers: ['price'],
      priority: 5,
      created_at: '2026-04-18T00:00:00.000Z',
    })
    const hit = matchKeywordRule('what is the price?', [low, high])
    expect(hit?.id).toBe('high')
  })

  it('VAL-RESP-010: same priority, older created_at wins', () => {
    const older = rule({
      id: 'older',
      triggers: ['price'],
      priority: 3,
      created_at: '2026-01-01T00:00:00.000Z',
    })
    const newer = rule({
      id: 'newer',
      triggers: ['price'],
      priority: 3,
      created_at: '2026-03-01T00:00:00.000Z',
    })
    const hit = matchKeywordRule('how much is the price?', [newer, older])
    expect(hit?.id).toBe('older')
  })

  it('intent-type rules ignored by keyword matcher', () => {
    const intentRule = rule({ trigger_type: 'intent', triggers: ['price'] })
    expect(matchKeywordRule('what is the price', [intentRule])).toBeNull()
  })
})

describe('matchIntentRule', () => {
  const rules: ResponseRule[] = [
    rule({ id: 'hours', trigger_type: 'intent', triggers: ['hours'] }),
    rule({ id: 'pricing', trigger_type: 'intent', triggers: ['pricing'] }),
  ]

  it('matches by exact normalized intent label', () => {
    expect(matchIntentRule('hours', rules)?.id).toBe('hours')
    expect(matchIntentRule('Hours', rules)?.id).toBe(rules[0].id)
  })

  it('no hit when label absent', () => {
    expect(matchIntentRule('refunds', rules)).toBeNull()
  })

  it('honors priority ordering', () => {
    const r1 = rule({
      id: 'r1',
      trigger_type: 'intent',
      triggers: ['support'],
      priority: 0,
    })
    const r2 = rule({
      id: 'r2',
      trigger_type: 'intent',
      triggers: ['support'],
      priority: 7,
    })
    expect(matchIntentRule('support', [r1, r2])?.id).toBe('r2')
  })
})

describe('classifyIntent', () => {
  it('short-circuits when allowedIntents is empty', async () => {
    const result = await classifyIntent('hi', [])
    expect(result).toBeNull()
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('returns the classified label on a hit', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { intent: 'hours' } })
    const result = await classifyIntent('when are you open?', [
      'hours',
      'pricing',
    ])
    expect(result).toBe('hours')
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })

  it("returns null when classifier reports 'other'", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { intent: 'other' } })
    expect(await classifyIntent('hello', ['hours'])).toBeNull()
  })

  it('returns null on empty label', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { intent: '   ' } })
    expect(await classifyIntent('hello', ['hours'])).toBeNull()
  })
})

describe('matchResponse — orchestration', () => {
  it('VAL-RESP-011: no classifier call when site has no intent rules', async () => {
    const rules = [rule({ triggers: ['pricing'] })]
    const result = await matchResponse('howdy there', rules)
    expect(result).toBeNull()
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('keyword hit skips classifier entirely', async () => {
    const rules = [
      rule({ triggers: ['pricing'] }),
      rule({ trigger_type: 'intent', triggers: ['hours'] }),
    ]
    const result = await matchResponse('what about pricing?', rules)
    expect(result?.via).toBe('keyword')
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('classifier runs only when site has intent rules AND no keyword hit', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { intent: 'hours' } })
    const rules = [
      rule({ trigger_type: 'intent', triggers: ['hours'], id: 'hoursRule' }),
    ]
    const result = await matchResponse('when do you open?', rules)
    expect(result?.via).toBe('intent')
    expect(result?.rule.id).toBe('hoursRule')
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })

  it('returns null when classifier returns unmatched intent', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { intent: 'refunds' } })
    const rules = [rule({ trigger_type: 'intent', triggers: ['hours'] })]
    const result = await matchResponse('something weird', rules)
    expect(result).toBeNull()
  })
})
