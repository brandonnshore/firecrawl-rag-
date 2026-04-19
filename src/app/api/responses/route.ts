import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/responses — create a custom-response rule.
 *
 * Auth: user-session client; RLS (M6F1) enforces site ownership on
 * INSERT via sites.user_id. We fetch the caller's site first so a
 * body that omits site_id "just works" and cross-site spoofing is
 * structurally impossible.
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
    trigger_type?: string
    triggers?: unknown
    response?: string
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
    .from('custom_responses')
    .insert({
      site_id: site.id,
      trigger_type: body.trigger_type,
      triggers: body.triggers,
      response: body.response,
      priority: body.priority ?? 0,
      is_active: body.is_active ?? true,
    })
    .select('id, trigger_type, triggers, response, priority, is_active, created_at')
    .single()

  if (error) {
    return Response.json(
      { error: 'insert_failed', details: error.message },
      { status: 500 }
    )
  }

  return Response.json({ rule: data }, { status: 201 })
}

export function validateRuleBody(body: {
  trigger_type?: string
  triggers?: unknown
  response?: string
  priority?: number
}): string | null {
  if (!body.trigger_type || !['keyword', 'intent'].includes(body.trigger_type)) {
    return 'invalid_trigger_type'
  }
  if (!Array.isArray(body.triggers) || body.triggers.length === 0) {
    return 'triggers_required'
  }
  const triggers = body.triggers as unknown[]
  if (!triggers.every((t) => typeof t === 'string' && t.trim().length > 0)) {
    return 'invalid_triggers'
  }
  if (!body.response || typeof body.response !== 'string' || body.response.trim().length === 0) {
    return 'response_required'
  }
  if (body.response.length > 2000) {
    return 'response_too_long'
  }
  if (
    body.priority !== undefined &&
    (typeof body.priority !== 'number' || !Number.isInteger(body.priority))
  ) {
    return 'invalid_priority'
  }
  return null
}
