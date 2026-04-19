import { createServiceClient } from '@/lib/supabase/service'
import { sendTrialEndingEmail } from '@/lib/email/transactional'

/**
 * Vercel Cron endpoint — hit daily. Finds users whose trial ends in the
 * 3–4 day window and sends the pre-expiry reminder. Idempotent per
 * (user_id, 'trial_ending', YYYY-MM-DD) via the sent_emails ledger, so
 * re-runs on the same day are safe.
 *
 * Auth: Bearer CRON_SECRET. Vercel Cron sends this header automatically
 * when the env var is configured on the deployment.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()
  const now = Date.now()
  const from = new Date(now + 3 * 24 * 3_600_000).toISOString()
  const to = new Date(now + 4 * 24 * 3_600_000).toISOString()

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, email, trial_ends_at')
    .eq('subscription_status', 'trialing')
    .gte('trial_ends_at', from)
    .lt('trial_ends_at', to)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const rows = (profiles ?? []) as Array<{
    id: string
    email: string
    trial_ends_at: string
  }>

  let sent = 0
  let duplicates = 0
  const errors: string[] = []

  for (const p of rows) {
    const outcome = await sendTrialEndingEmail(admin, p.id, {
      email: p.email,
      trialEndsAt: p.trial_ends_at,
    })
    if (outcome.status === 'sent') sent++
    else if (outcome.status === 'duplicate') duplicates++
    else if (outcome.status === 'error') errors.push(outcome.error)
  }

  return Response.json({
    candidates: rows.length,
    sent,
    duplicates,
    errors,
  })
}
