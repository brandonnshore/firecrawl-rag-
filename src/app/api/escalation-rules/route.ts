import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/escalation-rules — create a rule. Auth via user session;
 * RLS enforces site ownership on INSERT. The caller's site is looked
 * up server-side so the body cannot cross-site spoof.
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    rule_type?: string
    config?: unknown
    action?: string
    action_config?: unknown
    priority?: number
    is_active?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const validationError = validateRuleBody(body)
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 })
  }

  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle<{ id: string }>()
  if (!site) {
    return Response.json({ error: 'no_site' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('escalation_rules')
    .insert({
      site_id: site.id,
      rule_type: body.rule_type,
      config: body.config ?? {},
      action: body.action,
      action_config: body.action_config ?? {},
      priority: body.priority ?? 0,
      is_active: body.is_active ?? true,
    })
    .select(
      'id, rule_type, config, action, action_config, priority, is_active, created_at'
    )
    .single()

  if (error) {
    return Response.json(
      { error: 'insert_failed', details: error.message },
      { status: 500 }
    )
  }

  return Response.json({ rule: data }, { status: 201 })
}

const RULE_TYPES = ['turn_count', 'keyword', 'intent'] as const
const ACTIONS = [
  'ask_email',
  'ask_phone',
  'show_form',
  'calendly_link',
  'handoff',
] as const

export function validateRuleBody(body: {
  rule_type?: string
  config?: unknown
  action?: string
  action_config?: unknown
  priority?: number
}): string | null {
  if (!body.rule_type || !(RULE_TYPES as readonly string[]).includes(body.rule_type)) {
    return 'invalid_rule_type'
  }
  if (!body.action || !(ACTIONS as readonly string[]).includes(body.action)) {
    return 'invalid_action'
  }
  if (body.config === null || typeof body.config !== 'object' || Array.isArray(body.config)) {
    return 'config_required'
  }
  const config = body.config as Record<string, unknown>
  if (body.rule_type === 'turn_count') {
    const turns = config.turns
    if (typeof turns !== 'number' || !Number.isInteger(turns) || turns < 1) {
      return 'invalid_turns'
    }
  }
  if (body.rule_type === 'keyword') {
    const kws = config.keywords
    if (!Array.isArray(kws) || kws.length === 0) {
      return 'keywords_required'
    }
    if (!kws.every((k) => typeof k === 'string' && k.trim().length > 0)) {
      return 'invalid_keywords'
    }
  }
  if (body.rule_type === 'intent') {
    const intents = config.intents
    if (!Array.isArray(intents) || intents.length === 0) {
      return 'intents_required'
    }
    if (!intents.every((i) => typeof i === 'string' && i.trim().length > 0)) {
      return 'invalid_intents'
    }
  }

  if (
    body.action_config !== undefined &&
    body.action_config !== null &&
    (typeof body.action_config !== 'object' || Array.isArray(body.action_config))
  ) {
    return 'invalid_action_config'
  }
  const actionConfig = (body.action_config ?? {}) as Record<string, unknown>
  if (body.action === 'calendly_link') {
    const url = actionConfig.url
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      return 'calendly_url_required'
    }
  }
  if (body.action === 'show_form') {
    const fields = actionConfig.fields
    if (!Array.isArray(fields) || fields.length === 0) {
      return 'form_fields_required'
    }
    if (!fields.every((f) => typeof f === 'string' && f.trim().length > 0)) {
      return 'invalid_form_fields'
    }
  }

  if (
    body.priority !== undefined &&
    (typeof body.priority !== 'number' || !Number.isInteger(body.priority))
  ) {
    return 'invalid_priority'
  }
  return null
}
