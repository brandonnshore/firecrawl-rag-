import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from './send'
import {
  renderWelcome,
  renderTrialEnding,
  renderQuotaWarning,
  renderPaymentFailed,
  type WelcomeProps,
  type TrialEndingProps,
  type QuotaWarningProps,
  type PaymentFailedProps,
} from './templates'

export type TransactionalTemplate =
  | 'welcome'
  | 'trial_ending'
  | 'quota_warning'
  | 'payment_failed'

export interface SendOnceInput {
  admin: SupabaseClient
  userId: string
  template: TransactionalTemplate
  period: string
  to: string
  render: () => { subject: string; html: string; text: string }
}

export type SendOnceOutcome =
  | { status: 'sent'; id?: string }
  | { status: 'duplicate' }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; error: string }

/**
 * Sends a transactional email at most once per (user_id, template, period).
 * The unique index on sent_emails is the authority — we insert first,
 * ignoring 23505 conflicts, and only call Resend when the insert succeeds.
 * This ensures two concurrent triggers can't double-send.
 */
export async function sendOnce({
  admin,
  userId,
  template,
  period,
  to,
  render,
}: SendOnceInput): Promise<SendOnceOutcome> {
  const { error: insertErr } = await admin
    .from('sent_emails')
    .insert({ user_id: userId, template, period })

  if (insertErr) {
    if (insertErr.code === '23505') return { status: 'duplicate' }
    return { status: 'error', error: insertErr.message }
  }

  const payload = render()
  const result = await sendEmail({ to, ...payload })
  if (!result.ok) {
    // Leave the ledger row in place — Resend transport errors shouldn't
    // cause the next run to re-send either, because the ledger is our
    // idempotency key. Operators can manually delete the row to retry.
    return { status: 'error', error: result.error ?? 'send_failed' }
  }
  return { status: 'sent', id: result.id }
}

export function sendWelcomeEmail(
  admin: SupabaseClient,
  userId: string,
  props: WelcomeProps
): Promise<SendOnceOutcome> {
  return sendOnce({
    admin,
    userId,
    template: 'welcome',
    period: 'initial',
    to: props.email,
    render: () => renderWelcome(props),
  })
}

export function sendTrialEndingEmail(
  admin: SupabaseClient,
  userId: string,
  props: TrialEndingProps
): Promise<SendOnceOutcome> {
  const endsAt =
    typeof props.trialEndsAt === 'string'
      ? props.trialEndsAt
      : props.trialEndsAt.toISOString()
  // Period = date (YYYY-MM-DD) of trial end so cron reruns on the same
  // day don't re-send, and a user whose trial shifts doesn't double-fire.
  const period = endsAt.slice(0, 10)
  return sendOnce({
    admin,
    userId,
    template: 'trial_ending',
    period,
    to: props.email,
    render: () => renderTrialEnding(props),
  })
}

export function sendQuotaWarningEmail(
  admin: SupabaseClient,
  userId: string,
  periodStartIso: string,
  props: QuotaWarningProps
): Promise<SendOnceOutcome> {
  return sendOnce({
    admin,
    userId,
    template: 'quota_warning',
    period: periodStartIso,
    to: props.email,
    render: () => renderQuotaWarning(props),
  })
}

export function sendPaymentFailedEmail(
  admin: SupabaseClient,
  userId: string,
  invoiceId: string,
  props: PaymentFailedProps
): Promise<SendOnceOutcome> {
  return sendOnce({
    admin,
    userId,
    template: 'payment_failed',
    period: invoiceId,
    to: props.email,
    render: () => renderPaymentFailed(props),
  })
}
