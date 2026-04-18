import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/account/accept-tos — stamps profiles.tos_accepted_at for the
 * authenticated caller. Used by the legacy-user acceptance banner
 * (VAL-TOS-004) after the ToS page was introduced.
 *
 * Idempotent: calling twice leaves the original acceptance timestamp
 * intact (ON the first call), so users aren't penalized for re-clicking.
 */
export async function POST(): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile, error: readErr } = await supabase
    .from('profiles')
    .select('tos_accepted_at')
    .eq('id', user.id)
    .single<{ tos_accepted_at: string | null }>()

  if (readErr || !profile) {
    return Response.json({ error: 'Profile not found' }, { status: 500 })
  }

  if (profile.tos_accepted_at) {
    return Response.json({
      tos_accepted_at: profile.tos_accepted_at,
      already_accepted: true,
    })
  }

  const now = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ tos_accepted_at: now })
    .eq('id', user.id)

  if (updateErr) {
    return Response.json({ error: 'Failed to record acceptance' }, { status: 500 })
  }

  return Response.json({ tos_accepted_at: now, already_accepted: false })
}
