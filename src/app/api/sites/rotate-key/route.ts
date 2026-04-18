import crypto from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { checkRotationRateLimit } from '@/lib/sites/rotation-rate-limit'

/**
 * POST /api/sites/rotate-key — issues a new 32-char hex site_key for the
 * caller's site. Old key is immediately invalid (widget calls to
 * /api/chat/session resolve the site by site_key, so the stale key
 * yields zero rows and the widget gets 401). Rate-limited 5/hour/user.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rate = checkRotationRateLimit(user.id)
  if (!rate.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((rate.retryAfterMs ?? 0) / 1000))
    return Response.json(
      { error: 'Too many rotations. Try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSec) },
      }
    )
  }

  const newSiteKey = crypto.randomBytes(16).toString('hex')

  const { data, error } = await supabase
    .from('sites')
    .update({ site_key: newSiteKey })
    .eq('user_id', user.id)
    .select('id, site_key')
    .single()

  if (error || !data) {
    // PGRST116 = no rows matched — the user has no site yet.
    if (error?.code === 'PGRST116') {
      return Response.json(
        { error: 'No site found for this account.' },
        { status: 404 }
      )
    }
    return Response.json(
      { error: 'Failed to rotate site key' },
      { status: 500 }
    )
  }

  return Response.json({ site_key: data.site_key })
}
