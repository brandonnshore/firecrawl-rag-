import { createClient } from '@/lib/supabase/server'
import { validateRuleBody } from '../route'

/**
 * PATCH /api/responses/{id} — partial update of a rule. RLS gates
 * write access to the caller's own site, so a bogus id returns 404
 * without leaking the target row's existence.
 */
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

  // PATCH: only validate fields the caller sent. If trigger_type is
  // touched, the full validator runs because triggers/response must stay
  // consistent with the type.
  const fullPayload = {
    trigger_type: body.trigger_type,
    triggers: body.triggers,
    response: body.response,
    priority: body.priority,
  }
  if (
    body.trigger_type !== undefined ||
    body.triggers !== undefined ||
    body.response !== undefined
  ) {
    // Fill with existing values so partial updates still validate.
    const existing = await supabase
      .from('custom_responses')
      .select('trigger_type, triggers, response')
      .eq('id', id)
      .maybeSingle<{
        trigger_type: string
        triggers: string[]
        response: string
      }>()
    if (!existing.data) {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    const merged = {
      trigger_type: fullPayload.trigger_type ?? existing.data.trigger_type,
      triggers: fullPayload.triggers ?? existing.data.triggers,
      response: fullPayload.response ?? existing.data.response,
      priority: fullPayload.priority,
    }
    const validationError = validateRuleBody(merged)
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 })
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.trigger_type !== undefined) patch.trigger_type = body.trigger_type
  if (body.triggers !== undefined) patch.triggers = body.triggers
  if (body.response !== undefined) patch.response = body.response
  if (body.priority !== undefined) patch.priority = body.priority
  if (body.is_active !== undefined) patch.is_active = body.is_active

  const { data, error } = await supabase
    .from('custom_responses')
    .update(patch)
    .eq('id', id)
    .select('id, trigger_type, triggers, response, priority, is_active, created_at')
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

/**
 * DELETE /api/responses/{id} — remove a rule. RLS handles ownership;
 * zero-rows-affected surfaces as 404 so we don't hand out row IDs.
 */
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
    .from('custom_responses')
    .select('id')
    .eq('id', id)
    .maybeSingle<{ id: string }>()
  if (!existing) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const { error } = await supabase
    .from('custom_responses')
    .delete()
    .eq('id', id)
  if (error) {
    return Response.json({ error: 'delete_failed' }, { status: 500 })
  }
  return Response.json({ ok: true })
}
