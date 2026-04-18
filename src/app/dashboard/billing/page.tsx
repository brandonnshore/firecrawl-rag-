import { createClient } from '@/lib/supabase/server'
import { stripeClient } from '@/lib/stripe/client'
import {
  buildBillingViewModel,
  type InvoiceSummary,
  type Plan,
  type ProfileInput,
} from '@/lib/billing/page-model'
import { BillingAction } from './client-actions'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Layout redirects guests — presence asserted here for TS narrowing.
  if (!user) return null

  const [profileRes, plansRes] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'plan_id, subscription_status, trial_ends_at, current_period_end, cancel_at_period_end, stripe_customer_id'
      )
      .eq('id', user.id)
      .single(),
    supabase
      .from('plans')
      .select(
        'id, display_name, price_cents, monthly_message_limit, monthly_crawl_page_limit, supplementary_file_limit, stripe_price_id'
      )
      .order('price_cents', { ascending: true }),
  ])

  const profile = (profileRes.data ?? {
    plan_id: null,
    subscription_status: null,
    trial_ends_at: null,
    current_period_end: null,
    cancel_at_period_end: false,
    stripe_customer_id: null,
  }) as ProfileInput & { stripe_customer_id: string | null }

  const plans = (plansRes.data ?? []) as Plan[]

  const invoices = await fetchInvoices(profile.stripe_customer_id)

  const vm = buildBillingViewModel({ profile, plans, invoices })

  return (
    <div className="mx-auto max-w-3xl rc-enter">
      <header className="mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Billing
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Your subscription.
        </h1>
      </header>

      {vm.trialCountdownDays !== null ? (
        <section className="surface-hairline mb-6 rounded-xl p-4">
          <p className="text-sm text-[color:var(--ink-primary)]">
            <strong>Trial</strong> — {vm.trialCountdownDays}{' '}
            {vm.trialCountdownDays === 1 ? 'day' : 'days'} remaining.
          </p>
          <p className="mt-1 text-xs text-[color:var(--ink-tertiary)]">
            Pick a plan below to keep chat live once your trial ends.
          </p>
        </section>
      ) : null}

      <section className="surface-hairline rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
              Current plan
            </p>
            <p className="mt-2 text-xl font-medium tracking-tight text-[color:var(--ink-primary)]">
              {vm.currentPlan?.display_name ?? 'No plan yet'}
            </p>
            {vm.currentPlan ? (
              <p className="mt-1 font-mono text-sm text-[color:var(--ink-secondary)]">
                ${(vm.currentPlan.price_cents / 100).toFixed(2)}
                <span className="text-[color:var(--ink-tertiary)]">/month</span>
              </p>
            ) : null}
          </div>
          <StatusPill label={vm.statusPill.label} tone={vm.statusPill.tone} />
        </div>

        {vm.nextInvoiceIso ? (
          <p className="mt-6 text-xs text-[color:var(--ink-tertiary)]">
            Next invoice: {formatDate(vm.nextInvoiceIso)}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {vm.showPortalCta ? (
            <BillingAction kind="portal" label="Manage billing" variant="secondary" />
          ) : null}
          {vm.showUpgradeCta && vm.availablePlans.length > 0 ? (
            <BillingAction
              kind="checkout"
              planId={vm.currentPlan?.id === 'pro' ? 'scale' : 'pro'}
              label={vm.currentPlan ? 'Upgrade' : 'Start a plan'}
              variant="primary"
            />
          ) : null}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-[color:var(--ink-primary)]">
          Plans
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {vm.availablePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={plan.id === vm.currentPlan?.id}
              canChange={!!vm.currentPlan && plan.id !== vm.currentPlan.id}
              canStart={!vm.currentPlan}
            />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium text-[color:var(--ink-primary)]">
          Invoices
        </h2>
        {vm.invoices.length === 0 ? (
          <p className="surface-hairline rounded-xl p-4 text-sm text-[color:var(--ink-tertiary)]">
            No invoices yet.
          </p>
        ) : (
          <div className="surface-hairline rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border-hairline)] text-left text-[color:var(--ink-tertiary)]">
                  <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                    Date
                  </th>
                  <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                    Amount
                  </th>
                  <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">
                    PDF
                  </th>
                </tr>
              </thead>
              <tbody>
                {vm.invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-[color:var(--border-hairline)] last:border-b-0"
                  >
                    <td className="px-4 py-2 text-[color:var(--ink-primary)]">
                      {formatDate(new Date(inv.created_sec * 1000).toISOString())}
                    </td>
                    <td className="px-4 py-2 font-mono text-[color:var(--ink-primary)]">
                      ${(inv.amount_paid_cents / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-[color:var(--ink-secondary)]">
                      {inv.status ?? '—'}
                    </td>
                    <td className="px-4 py-2">
                      {inv.pdf_url ? (
                        <a
                          href={inv.pdf_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[color:var(--ink-primary)] underline"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-[color:var(--ink-tertiary)]">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

interface PlanCardProps {
  plan: Plan
  isCurrent: boolean
  canChange: boolean
  canStart: boolean
}

function PlanCard({ plan, isCurrent, canChange, canStart }: PlanCardProps) {
  return (
    <div className="surface-hairline rounded-xl p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-[color:var(--ink-primary)]">
          {plan.display_name}
        </p>
        <p className="font-mono text-sm text-[color:var(--ink-secondary)]">
          ${(plan.price_cents / 100).toFixed(2)}
          <span className="text-[color:var(--ink-tertiary)]">/mo</span>
        </p>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-[color:var(--ink-secondary)]">
        <li>{plan.monthly_message_limit.toLocaleString()} messages</li>
        <li>{plan.monthly_crawl_page_limit.toLocaleString()} crawl pages</li>
        <li>{plan.supplementary_file_limit} files</li>
      </ul>
      <div className="mt-4">
        {isCurrent ? (
          <span className="text-xs text-[color:var(--ink-tertiary)]">
            Current plan
          </span>
        ) : canChange ? (
          <BillingAction kind="change" planId={plan.id} label="Switch" variant="secondary" />
        ) : canStart ? (
          <BillingAction
            kind="checkout"
            planId={plan.id}
            label={`Start ${plan.display_name}`}
            variant="primary"
          />
        ) : null}
      </div>
    </div>
  )
}

function StatusPill({
  label,
  tone,
}: {
  label: string
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
}) {
  const toneStyles: Record<typeof tone, string> = {
    success:
      'bg-[color:var(--accent-success-bg)] text-[color:var(--accent-success)]',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
    info: 'bg-blue-50 text-blue-700',
    neutral:
      'bg-[color:var(--surface-inset)] text-[color:var(--ink-secondary)]',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${toneStyles[tone]}`}
    >
      {label}
    </span>
  )
}

async function fetchInvoices(
  customerId: string | null
): Promise<InvoiceSummary[]> {
  if (!customerId) return []
  if (!process.env.STRIPE_SECRET_KEY) return []

  try {
    const stripe = stripeClient()
    const list = await stripe.invoices.list({ customer: customerId, limit: 12 })
    return list.data.map((inv) => ({
      id: inv.id ?? 'unknown',
      number: inv.number ?? null,
      amount_paid_cents: inv.amount_paid ?? 0,
      currency: inv.currency ?? 'usd',
      status: inv.status ?? null,
      created_sec: inv.created,
      pdf_url: inv.invoice_pdf ?? null,
    }))
  } catch (err) {
    console.error('[billing] invoice list fetch failed:', err)
    return []
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
