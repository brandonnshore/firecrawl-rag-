import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/escalation-rules/reorder — bulk priority update.
 *
 * Body: {rule_ids: ["id-at-top", "id-next", ...]}. Top of the list
 * gets the highest priority. We assign priorities descending from
 * rule_ids.length down to 1 so the DB order (priority DESC, created_at
 * ASC) mirrors the UI order after the update.
 *
 * RLS gates the UPDATE to the caller's rules; any id that is not
 * visible silently no-ops, so a malformed list can't corrupt the DB.
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { rule_ids?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const ids = body.rule_ids
  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: 'rule_ids_required' }, { status: 400 })
  }
  if (!ids.every((x) => typeof x === 'string' && x.length > 0)) {
    return Response.json({ error: 'invalid_rule_ids' }, { status: 400 })
  }

  const total = ids.length
  const updates: Array<PromiseLike<{ error: unknown }>> = []
  for (let i = 0; i < ids.length; i++) {
    const priority = total - i
    updates.push(
      supabase
        .from('escalation_rules')
        .update({ priority, updated_at: new Date().toISOString() })
        .eq('id', ids[i]) as unknown as PromiseLike<{ error: unknown }>
    )
  }
  const results = await Promise.all(updates)
  const firstError = results.find(
    (r) => (r as { error?: unknown }).error
  ) as { error?: { message?: string } } | undefined
  if (firstError?.error) {
    return Response.json(
      { error: 'reorder_failed', details: firstError.error.message },
      { status: 500 }
    )
  }
  return Response.json({ ok: true, count: ids.length })
}
