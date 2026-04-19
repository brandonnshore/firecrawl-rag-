import { createClient } from '@/lib/supabase/server'
import {
  matchResponse,
  type ResponseRule,
} from '@/lib/chat/response-matcher'

/**
 * POST /api/responses/test — dry-run the matcher against the caller's
 * active rules with a sample message. Powers the dashboard test drawer.
 *
 * Returns {matched, rule_id, response, via} shape so the drawer can
 * show the exact row that would trigger on this message in production.
 *
 * Intent classification is identical to the live /api/chat/session
 * path — gpt-4o-mini is invoked only when the site has at least one
 * intent-type rule AND the keyword pass missed.
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { message?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const message = body.message
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return Response.json({ error: 'message_required' }, { status: 400 })
  }
  if (message.length > 500) {
    return Response.json({ error: 'message_too_long' }, { status: 400 })
  }

  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle<{ id: string }>()
  if (!site) {
    return Response.json({ error: 'no_site' }, { status: 400 })
  }

  const { data: rules } = await supabase
    .from('custom_responses')
    .select('id, trigger_type, triggers, response, priority, created_at')
    .eq('site_id', site.id)
    .eq('is_active', true)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })

  const match = await matchResponse(
    message.trim(),
    ((rules ?? []) as ResponseRule[])
  )

  if (!match) {
    return Response.json({ matched: false })
  }

  return Response.json({
    matched: true,
    rule_id: match.rule.id,
    response: match.rule.response,
    via: match.via,
    intent: match.intent,
  })
}
