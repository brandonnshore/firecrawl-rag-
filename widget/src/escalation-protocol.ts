/**
 * M7F4 widget-side helpers for the /api/chat/stream trailer protocol
 * and escalation action payload construction.
 *
 * Kept in its own module so the pure logic can be unit-tested from the
 * main Vitest harness without pulling preact into the test tree.
 */

export const PENDING_ACTION_SENTINEL = '\x1E'

export type EscalationAction =
  | 'ask_email'
  | 'ask_phone'
  | 'show_form'
  | 'calendly_link'
  | 'handoff'

export interface PendingAction {
  rule_id: string
  action: EscalationAction
  action_config: Record<string, unknown>
  via?: string
}

export interface ParsedStream {
  text: string
  pendingAction: PendingAction | null
}

/**
 * Split a buffered stream body on the PENDING_ACTION_SENTINEL and
 * parse the trailer as JSON {pending_action: ...}. Returns the visible
 * text (always) and the pending_action if present and well-formed.
 *
 * Malformed JSON in the trailer is a non-fatal warning path — the
 * widget behaves as if no action fired so chat remains usable.
 */
export function parseStream(buffer: string): ParsedStream {
  const idx = buffer.indexOf(PENDING_ACTION_SENTINEL)
  if (idx < 0) return { text: buffer, pendingAction: null }
  const text = buffer.slice(0, idx)
  const trailer = buffer.slice(idx + 1)
  try {
    const parsed = JSON.parse(trailer) as { pending_action?: PendingAction }
    return { text, pendingAction: parsed?.pending_action ?? null }
  } catch {
    return { text, pendingAction: null }
  }
}

/**
 * Build the /api/leads body for a show_form submission. Promotes the
 * well-known keys (email/phone/name) into top-level fields so they
 * populate leads.email / phone / name; everything else rides along in
 * extra_fields for the dashboard to surface.
 */
export function buildShowFormPayload(
  values: Record<string, string>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    extra_fields: { ...values },
  }
  for (const key of ['email', 'phone', 'name'] as const) {
    if (values[key]) payload[key] = values[key]
  }
  return payload
}
