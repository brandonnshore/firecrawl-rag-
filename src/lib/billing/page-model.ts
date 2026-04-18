/**
 * Pure view-model helper for the /dashboard/billing server component.
 * Keeps all branching logic unit-testable and out of the JSX.
 */

export interface Plan {
  id: string
  display_name: string
  price_cents: number
  monthly_message_limit: number
  monthly_crawl_page_limit: number
  supplementary_file_limit: number
  stripe_price_id: string | null
}

export interface ProfileInput {
  plan_id: string | null
  subscription_status: string | null
  trial_ends_at: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
}

export interface InvoiceSummary {
  id: string
  number: string | null
  amount_paid_cents: number
  currency: string
  status: string | null
  created_sec: number
  pdf_url: string | null
}

export type BillingState =
  | 'no_subscription'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled_active' // canceled but paid-through
  | 'canceled_expired'
  | 'other_inactive'

export interface StatusPill {
  label: string
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
}

export interface BillingViewModel {
  state: BillingState
  currentPlan: Plan | null
  availablePlans: Plan[]
  statusPill: StatusPill
  trialCountdownDays: number | null
  nextInvoiceIso: string | null
  invoices: InvoiceSummary[]
  showUpgradeCta: boolean
  showPortalCta: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

export function buildBillingViewModel(input: {
  profile: ProfileInput
  plans: Plan[]
  invoices: InvoiceSummary[]
  nowMs?: number
}): BillingViewModel {
  const now = input.nowMs ?? Date.now()
  const { profile, plans, invoices } = input

  const currentPlan = profile.plan_id
    ? plans.find((p) => p.id === profile.plan_id) ?? null
    : null

  const state = deriveState(profile, now)
  const statusPill = deriveStatusPill(state, profile.cancel_at_period_end ?? false)
  const trialCountdownDays =
    state === 'trialing' && profile.trial_ends_at
      ? Math.max(
          0,
          Math.ceil(
            (new Date(profile.trial_ends_at).getTime() - now) / DAY_MS
          )
        )
      : null

  const nextInvoiceIso =
    state === 'active' || state === 'trialing' || state === 'canceled_active'
      ? profile.current_period_end
      : null

  const showUpgradeCta =
    state === 'no_subscription' ||
    state === 'trialing' ||
    state === 'past_due' ||
    state === 'canceled_expired' ||
    state === 'other_inactive'

  const showPortalCta =
    state === 'active' ||
    state === 'trialing' ||
    state === 'canceled_active' ||
    state === 'past_due'

  return {
    state,
    currentPlan,
    availablePlans: plans,
    statusPill,
    trialCountdownDays,
    nextInvoiceIso,
    invoices: invoices.slice(0, 12),
    showUpgradeCta,
    showPortalCta,
  }
}

function deriveState(profile: ProfileInput, nowMs: number): BillingState {
  if (!profile.subscription_status) return 'no_subscription'

  const periodEndMs = profile.current_period_end
    ? new Date(profile.current_period_end).getTime()
    : null
  const trialEndMs = profile.trial_ends_at
    ? new Date(profile.trial_ends_at).getTime()
    : null

  switch (profile.subscription_status) {
    case 'trialing':
      if (trialEndMs !== null && trialEndMs > nowMs) return 'trialing'
      return 'other_inactive' // expired trial
    case 'active':
      return 'active'
    case 'past_due':
      return 'past_due'
    case 'canceled':
      if (periodEndMs !== null && periodEndMs > nowMs) return 'canceled_active'
      return 'canceled_expired'
    default:
      return 'other_inactive'
  }
}

function deriveStatusPill(state: BillingState, cancelAtPeriodEnd: boolean): StatusPill {
  switch (state) {
    case 'no_subscription':
      return { label: 'No subscription', tone: 'neutral' }
    case 'trialing':
      return { label: 'Trial', tone: 'info' }
    case 'active':
      return cancelAtPeriodEnd
        ? { label: 'Canceling', tone: 'warning' }
        : { label: 'Active', tone: 'success' }
    case 'past_due':
      return { label: 'Past due', tone: 'danger' }
    case 'canceled_active':
      return { label: 'Canceled — paid through', tone: 'warning' }
    case 'canceled_expired':
      return { label: 'Canceled', tone: 'danger' }
    case 'other_inactive':
      return { label: 'Inactive', tone: 'danger' }
  }
}
