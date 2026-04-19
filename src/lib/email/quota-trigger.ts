import type { SupabaseClient } from '@supabase/supabase-js'
import { sendQuotaWarningEmail } from './transactional'

interface QuotaTriggerInput {
  admin: SupabaseClient
  userId: string
  used: number
  limit: number
}

/**
 * Fires the 80%-of-quota warning email the first time a user's running
 * usage total crosses the 80% threshold within the current period.
 *
 * Called from the chat/session handler right after increment_message_counter.
 * Quick to no-op when the crossing condition isn't met, so the hot path
 * stays cheap. Idempotency is doubled up:
 *   (a) the arithmetic guard below only fires on the exact crossing
 *       message, so steady-state users in the >80% band don't retrigger;
 *   (b) sendQuotaWarningEmail's sent_emails ledger backstops (a) in
 *       the unusual case where `used` jumps more than 1 (e.g. plan change
 *       that moves the cap downward mid-period).
 */
export async function maybeSendQuotaWarning({
  admin,
  userId,
  used,
  limit,
}: QuotaTriggerInput): Promise<void> {
  if (limit <= 0) return
  const threshold = Math.ceil(limit * 0.8)
  if (used < threshold) return
  if (used - 1 >= threshold) return

  try {
    const { data: profile } = await admin
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .maybeSingle<{ email: string | null }>()
    const email = profile?.email
    if (!email) return

    const { data: counter } = await admin
      .from('usage_counters')
      .select('period_start')
      .eq('user_id', userId)
      .maybeSingle<{ period_start: string | null }>()
    const periodStart =
      counter?.period_start ?? new Date().toISOString().slice(0, 10)

    await sendQuotaWarningEmail(admin, userId, periodStart, {
      email,
      used,
      limit,
    })
  } catch (err) {
    console.error('[quota-trigger] warning email skipped:', err)
  }
}
