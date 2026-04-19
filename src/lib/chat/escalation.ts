/**
 * M7F2 escalation runtime.
 *
 * Evaluates site-owner-defined escalation rules AFTER the main response
 * has been determined. Three rule types:
 *
 *   turn_count — fires when the visitor's userMessageCount (current
 *                message inclusive) reaches config.turns.
 *   keyword    — fires when any config.keywords entry matches the
 *                current user message. Reuses the exact same
 *                triggerMatches helper as M6F2 (diacritic- and
 *                case-insensitive, word-boundary enforced).
 *   intent     — fires when the classified intent is in config.intents.
 *                The classifier is invoked at most once per evaluation
 *                across all intent rules; labels are the union of every
 *                intent rule's config.intents.
 *
 * First matching rule wins when sorted by priority DESC, created_at ASC.
 * The resulting {action, action_config, rule_id} becomes the widget's
 * pending_action; handoff additionally flags conversations.needs_human.
 */

import {
  triggerMatches,
  classifyIntent,
} from '@/lib/chat/response-matcher'

export type EscalationRuleType = 'turn_count' | 'keyword' | 'intent'

export type EscalationAction =
  | 'ask_email'
  | 'ask_phone'
  | 'show_form'
  | 'calendly_link'
  | 'handoff'

export interface EscalationRule {
  id: string
  rule_type: EscalationRuleType
  config: Record<string, unknown>
  action: EscalationAction
  action_config: Record<string, unknown>
  priority: number
  created_at: string
}

export interface EscalationMatch {
  rule_id: string
  action: EscalationAction
  action_config: Record<string, unknown>
  via: EscalationRuleType
  intent?: string
}

export interface EvaluateCtx {
  /** Current visitor message — normalized internally for keyword match. */
  message: string
  /**
   * Count of user-authored messages in this conversation, INCLUDING the
   * current one. turn_count rules fire when this >= config.turns.
   */
  userMessageCount: number
  /**
   * Active rules fetched from escalation_rules for the site, unordered.
   * The evaluator sorts internally.
   */
  rules: EscalationRule[]
  /**
   * Optional pre-classified intent. If set, the evaluator uses it
   * instead of invoking the classifier. Useful when the response
   * matcher already classified the message and we want to avoid a
   * second gpt-4o-mini call.
   */
  preClassifiedIntent?: string | null
  /**
   * Optional classifier override — lets tests stub without mocking the
   * whole response-matcher module. Defaults to the real classifyIntent.
   */
  classifier?: (message: string, labels: string[]) => Promise<string | null>
}

function sortRules(rules: EscalationRule[]): EscalationRule[] {
  return [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority
    return a.created_at.localeCompare(b.created_at)
  })
}

function uniqLabels(rules: EscalationRule[]): string[] {
  const seen = new Set<string>()
  for (const rule of rules) {
    if (rule.rule_type !== 'intent') continue
    const intents = rule.config.intents
    if (!Array.isArray(intents)) continue
    for (const label of intents) {
      if (typeof label === 'string') {
        const trimmed = label.trim()
        if (trimmed) seen.add(trimmed)
      }
    }
  }
  return Array.from(seen)
}

export async function evaluateEscalation(
  ctx: EvaluateCtx
): Promise<EscalationMatch | null> {
  const sorted = sortRules(ctx.rules)
  if (sorted.length === 0) return null

  const classifier = ctx.classifier ?? classifyIntent
  let intent: string | null | undefined = ctx.preClassifiedIntent
  let intentResolved = ctx.preClassifiedIntent !== undefined

  for (const rule of sorted) {
    if (rule.rule_type === 'turn_count') {
      const turns = Number(rule.config.turns)
      if (Number.isFinite(turns) && ctx.userMessageCount >= turns) {
        return {
          rule_id: rule.id,
          action: rule.action,
          action_config: rule.action_config,
          via: 'turn_count',
        }
      }
      continue
    }

    if (rule.rule_type === 'keyword') {
      const kws = rule.config.keywords
      if (!Array.isArray(kws)) continue
      const hit = kws.some(
        (k) => typeof k === 'string' && triggerMatches(ctx.message, k)
      )
      if (hit) {
        return {
          rule_id: rule.id,
          action: rule.action,
          action_config: rule.action_config,
          via: 'keyword',
        }
      }
      continue
    }

    if (rule.rule_type === 'intent') {
      if (!intentResolved) {
        const labels = uniqLabels(sorted)
        intent =
          labels.length > 0 ? await classifier(ctx.message, labels) : null
        intentResolved = true
      }
      if (!intent) continue
      const candidates = rule.config.intents
      if (
        Array.isArray(candidates) &&
        candidates.some(
          (c) => typeof c === 'string' && c.trim() === intent
        )
      ) {
        return {
          rule_id: rule.id,
          action: rule.action,
          action_config: rule.action_config,
          via: 'intent',
          intent: intent ?? undefined,
        }
      }
      continue
    }
  }

  return null
}
