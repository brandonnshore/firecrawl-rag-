import type { SupabaseClient } from '@supabase/supabase-js'

export interface DeleteAccountInput {
  admin: SupabaseClient
  userId: string
  storageBucket?: string
  cancelStripeSubscription?: (subscriptionId: string) => Promise<void>
  /**
   * Override the auth.users row deletion. Production uses the Supabase
   * admin API; test harnesses that can't reach it inject a pg-based
   * implementation instead.
   */
  deleteAuthUser?: (userId: string) => Promise<{ error?: string }>
}

export interface DeleteAccountLog {
  stripe: 'none' | 'canceled' | 'error'
  stripeError?: string
  storage: 'ok' | 'error' | 'no_bucket'
  storageError?: string
  authUser: 'deleted' | 'error'
  authUserError?: string
  storageFilesDeleted: number
}

const DEFAULT_BUCKET = 'knowledge-files'

/**
 * Deletes a user account and all downstream data. Ordering:
 *   1. Cancel Stripe subscription (if any) — best-effort, failure logged.
 *   2. Delete Storage folder under user.id — best-effort.
 *   3. Delete auth.users row → cascades profiles → cascades sites →
 *      cascades pages/embeddings/leads/conversations/chat_sessions and
 *      also cascades supplementary_files / custom_responses /
 *      escalation_rules / usage_counters / sent_emails (all on
 *      delete cascade at their respective FK).
 *
 * Returns a structured log instead of throwing so callers can render a
 * single toast even on partial failure. The auth.users deletion is the
 * authoritative "account is gone" signal.
 */
export async function deleteUserAccount({
  admin,
  userId,
  storageBucket = DEFAULT_BUCKET,
  cancelStripeSubscription,
  deleteAuthUser,
}: DeleteAccountInput): Promise<DeleteAccountLog> {
  const log: DeleteAccountLog = {
    stripe: 'none',
    storage: 'ok',
    authUser: 'error',
    storageFilesDeleted: 0,
  }

  // 1. Stripe
  try {
    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_subscription_id')
      .eq('id', userId)
      .maybeSingle<{ stripe_subscription_id: string | null }>()
    const subId = profile?.stripe_subscription_id
    if (subId && cancelStripeSubscription) {
      await cancelStripeSubscription(subId)
      log.stripe = 'canceled'
    }
  } catch (err) {
    log.stripe = 'error'
    log.stripeError = (err as Error).message
  }

  // 2. Storage — delete every object under `{userId}/*`
  try {
    const storage = admin.storage.from(storageBucket)
    const { data: entries, error: listErr } = await storage.list(userId, {
      limit: 1000,
    })
    if (listErr) {
      log.storage = 'error'
      log.storageError = listErr.message
    } else if (entries && entries.length > 0) {
      const paths = entries.map((e) => `${userId}/${e.name}`)
      const { error: delErr } = await storage.remove(paths)
      if (delErr) {
        log.storage = 'error'
        log.storageError = delErr.message
      } else {
        log.storageFilesDeleted = paths.length
      }
    }
  } catch (err) {
    log.storage = 'error'
    log.storageError = (err as Error).message
  }

  // 3. auth.users — cascades everything else
  try {
    if (deleteAuthUser) {
      const res = await deleteAuthUser(userId)
      if (res?.error) {
        log.authUser = 'error'
        log.authUserError = res.error
      } else {
        log.authUser = 'deleted'
      }
    } else {
      const res = await admin.auth.admin.deleteUser(userId)
      if (res.error) {
        log.authUser = 'error'
        log.authUserError = res.error.message
      } else {
        log.authUser = 'deleted'
      }
    }
  } catch (err) {
    log.authUser = 'error'
    log.authUserError = (err as Error).message
  }

  return log
}
