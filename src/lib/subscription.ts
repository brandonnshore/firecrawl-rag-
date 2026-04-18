import { createServiceClient } from '@/lib/supabase/service'

export interface SubscriptionStatus {
  active: boolean
  status: string
  reason?:
    | 'trial_expired'
    | 'past_due'
    | 'canceled'
    | 'incomplete'
    | 'incomplete_expired'
    | 'unpaid'
    | 'paused'
    | 'unknown'
    | 'not_found'
  upgradeUrl?: string
}

const UPGRADE_URL = '/dashboard/billing'

/**
 * Real subscription gate (replaces the M0 stub). Reads profiles directly
 * via service-role so widget paths (no user JWT) can check the site
 * owner's subscription.
 *
 * Rules:
 *  - trialing     + trial_ends_at > now         -> active
 *  - trialing     + trial_ends_at <= now        -> inactive (trial_expired)
 *  - active                                      -> active (even if period_end null
 *                                                  — Stripe sync can lag)
 *  - past_due                                    -> inactive (past_due)
 *  - canceled     + current_period_end > now    -> active (paid-through grace)
 *  - canceled     + current_period_end <= now   -> inactive (canceled)
 *  - everything else                             -> inactive
 */
export async function checkSubscription(
  userId: string
): Promise<SubscriptionStatus> {
  const supabase = createServiceClient()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('subscription_status, trial_ends_at, current_period_end')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    return {
      active: false,
      status: 'not_found',
      reason: 'not_found',
      upgradeUrl: UPGRADE_URL,
    }
  }

  const status = profile.subscription_status as string
  const now = Date.now()
  const trialEndMs = profile.trial_ends_at
    ? new Date(profile.trial_ends_at).getTime()
    : null
  const periodEndMs = profile.current_period_end
    ? new Date(profile.current_period_end).getTime()
    : null

  switch (status) {
    case 'trialing':
      if (trialEndMs !== null && trialEndMs > now) {
        return { active: true, status }
      }
      return {
        active: false,
        status,
        reason: 'trial_expired',
        upgradeUrl: UPGRADE_URL,
      }
    case 'active':
      return { active: true, status }
    case 'past_due':
      return {
        active: false,
        status,
        reason: 'past_due',
        upgradeUrl: UPGRADE_URL,
      }
    case 'canceled':
      if (periodEndMs !== null && periodEndMs > now) {
        return { active: true, status }
      }
      return {
        active: false,
        status,
        reason: 'canceled',
        upgradeUrl: UPGRADE_URL,
      }
    case 'incomplete':
    case 'incomplete_expired':
    case 'unpaid':
    case 'paused':
      return {
        active: false,
        status,
        reason: status as SubscriptionStatus['reason'],
        upgradeUrl: UPGRADE_URL,
      }
    default:
      return {
        active: false,
        status,
        reason: 'unknown',
        upgradeUrl: UPGRADE_URL,
      }
  }
}
