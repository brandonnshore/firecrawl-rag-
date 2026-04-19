/**
 * M6F2 custom-response matcher.
 *
 * Two stages run BEFORE the RAG/LLM path in /api/chat/session:
 *
 *   1. keyword match  — pure-string, word-boundary, case + diacritic
 *                       insensitive. Walks active rules ordered by
 *                       priority DESC, created_at ASC.
 *
 *   2. intent match   — invoked ONLY if the site has at least one
 *                       trigger_type='intent' rule. Calls gpt-4o-mini
 *                       with a schema-constrained classifier; first
 *                       rule whose triggers contain the classified
 *                       intent wins (same priority ordering).
 *
 * A canned response skips every downstream cost (embedding, hybrid
 * search, chat completion). Tests assert zero OpenAI chat-completion
 * calls for the keyword path and zero intent-classifier calls when no
 * intent rules exist.
 */

import { generateObject, jsonSchema } from 'ai'
import { openai } from '@ai-sdk/openai'

export type TriggerType = 'keyword' | 'intent'

export interface ResponseRule {
  id: string
  trigger_type: TriggerType
  triggers: string[]
  response: string
  priority: number
  created_at: string
}

export interface MatchResult {
  rule: ResponseRule
  via: 'keyword' | 'intent'
  intent?: string
}

/**
 * Normalize a string for matching: NFD-decompose, strip combining marks
 * (diacritics), lowercase, collapse whitespace, trim. The output is
 * pure lowercase ASCII/Latin-ish so plain \b word boundaries work.
 */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True iff the (normalized) trigger appears as a whole word or phrase
 * in the (normalized) message. Supports multi-word triggers by escaping
 * and anchoring with \b on each end.
 */
export function triggerMatches(message: string, trigger: string): boolean {
  const normMsg = normalize(message)
  const normTrig = normalize(trigger)
  if (!normTrig) return false

  // Use a Unicode-aware word boundary via lookarounds on non-word chars.
  // \b behaves on [A-Za-z0-9_] which is fine after diacritic stripping.
  const pattern = new RegExp(`(?:^|\\W)${escapeRegex(normTrig)}(?:\\W|$)`, 'i')
  return pattern.test(normMsg)
}

function ruleOrder(a: ResponseRule, b: ResponseRule): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  // older created_at wins ties
  return a.created_at.localeCompare(b.created_at)
}

/**
 * Find the best keyword-type rule whose any-trigger matches the message.
 * Returns null if nothing matches or no keyword rules exist.
 */
export function matchKeywordRule(
  message: string,
  rules: ResponseRule[]
): ResponseRule | null {
  const candidates = rules
    .filter((r) => r.trigger_type === 'keyword')
    .filter((r) => r.triggers.some((t) => triggerMatches(message, t)))
    .sort(ruleOrder)
  return candidates[0] ?? null
}

/**
 * Find the best intent-type rule whose triggers (normalized) contain
 * the classifier-returned intent label.
 */
export function matchIntentRule(
  intent: string,
  rules: ResponseRule[]
): ResponseRule | null {
  const normIntent = normalize(intent)
  if (!normIntent) return null
  const candidates = rules
    .filter((r) => r.trigger_type === 'intent')
    .filter((r) => r.triggers.some((t) => normalize(t) === normIntent))
    .sort(ruleOrder)
  return candidates[0] ?? null
}

const intentSchema = jsonSchema<{ intent: string }>({
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      description:
        "The label that best matches the user's message from the allowed list, or 'other' if none fit.",
    },
  },
  required: ['intent'],
  additionalProperties: false,
})

/**
 * Single gpt-4o-mini call, schema-constrained, to classify the user
 * message into one of the allowed intent labels. The labels are the
 * union of every intent-type rule's triggers for the site.
 *
 * The caller decides whether to invoke this — it is NOT called when
 * the site has no intent rules.
 */
export async function classifyIntent(
  message: string,
  allowedIntents: string[]
): Promise<string | null> {
  if (allowedIntents.length === 0) return null

  const listed = allowedIntents.map((t) => `- ${t}`).join('\n')
  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: intentSchema,
    temperature: 0,
    prompt: `Classify the user's message into one of the following intents:\n${listed}\n\nIf none apply, reply with "other".\n\nUser message: ${message}`,
  })

  const label = object.intent.trim()
  if (!label) return null
  if (label.toLowerCase() === 'other') return null
  return label
}

/**
 * Top-level matcher used by /api/chat/session.
 *
 * Order:
 *   1. keyword first (no LLM call needed)
 *   2. if site has any intent rules AND no keyword hit → classify → try intent
 *
 * Returns null if nothing matched.
 */
export async function matchResponse(
  message: string,
  rules: ResponseRule[]
): Promise<MatchResult | null> {
  const kw = matchKeywordRule(message, rules)
  if (kw) return { rule: kw, via: 'keyword' }

  const intentRules = rules.filter((r) => r.trigger_type === 'intent')
  if (intentRules.length === 0) return null

  // Build the label list from every intent rule's triggers, deduped.
  const allowed = Array.from(
    new Set(intentRules.flatMap((r) => r.triggers).map((t) => t.trim()))
  ).filter(Boolean)

  const intent = await classifyIntent(message, allowed)
  if (!intent) return null

  const hit = matchIntentRule(intent, intentRules)
  if (!hit) return null
  return { rule: hit, via: 'intent', intent }
}
