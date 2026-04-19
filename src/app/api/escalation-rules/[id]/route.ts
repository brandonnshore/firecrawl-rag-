import { createClient } from '@/lib/supabase/server'
import { validateRuleBody } from '../route'

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params
  if (!id) return Response.json({ error: 'missing_id' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

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

  if (
    body.rule_type !== undefined ||
    body.config !== undefined ||
    body.action !== undefined ||
    body.action_config !== undefined
  ) {
    const existing = await supabase
      .from('escalation_rules')
      .select('rule_type, config, action, action_config')
      .eq('id', id)
      .maybeSingle<{
        rule_type: string
        config: Record<string, unknown>
        action: string
        action_config: Record<string, unknown>
      }>()
    if (!existing.data) {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    const merged = {
      rule_type: body.rule_type ?? existing.data.rule_type,
      config: body.config ?? existing.data.config,
      action: body.action ?? existing.data.action,
      action_config: body.action_config ?? existing.data.action_config,
      priority: body.priority,
    }
    const validationError = validateRuleBody(merged)
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 })
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.rule_type !== undefined) patch.rule_type = body.rule_type
  if (body.config !== undefined) patch.config = body.config
  if (body.action !== undefined) patch.action = body.action
  if (body.action_config !== undefined) patch.action_config = body.action_config
  if (body.priority !== undefined) patch.priority = body.priority
  if (body.is_active !== undefined) patch.is_active = body.is_active

  const { data, error } = await supabase
    .from('escalation_rules')
    .update(patch)
    .eq('id', id)
    .select(
      'id, rule_type, config, action, action_config, priority, is_active, created_at'
    )
    .maybeSingle()

  if (error) {
    return Response.json(
      { error: 'update_failed', details: error.message },
      { status: 500 }
    )
  }
  if (!data) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return Response.json({ rule: data })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params
  if (!id) return Response.json({ error: 'missing_id' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('escalation_rules')
    .select('id')
    .eq('id', id)
    .maybeSingle<{ id: string }>()
  if (!existing) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('escalation_rules')
    .delete()
    .eq('id', id)
  if (error) {
    return Response.json({ error: 'delete_failed' }, { status: 500 })
  }
  return Response.json({ ok: true })
}
