import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BillingAction } from '@/app/dashboard/settings/billing/client-actions'
import { IconCheck } from '@/components/icons'

/**
 * /subscribe — forced plan-picker for newly authenticated users who
 * haven't subscribed yet. The /proxy.ts paywall redirects any authed
 * request for /dashboard here when subscription_status isn't active.
 *
 * Unauthed hits are deflected to /login, and already-active accounts
 * bounce back to /dashboard — both handled in proxy.ts so the page
 * itself can assume it's being rendered for an authed-but-unpaid user.
 */

interface PlanRow {
  id: string
  display_name: string
  price_cents: number
  monthly_message_limit: number
  monthly_crawl_page_limit: number
  supplementary_file_limit: number
  stripe_price_id: string | null
}

function formatPrice(cents: number): string {
  const dollars = cents / 100
  return dollars % 1 === 0
    ? `$${dollars.toFixed(0)}`
    : `$${dollars.toFixed(2)}`
}

function numFmt(n: number): string {
  return n.toLocaleString('en-US')
}

function planTagline(id: string): string {
  switch (id) {
    case 'starter':
      return 'For single-site owners getting started.'
    case 'pro':
      return 'For busier sites and growing lead volume.'
    case 'scale':
      return 'For agencies and high-traffic storefronts.'
    default:
      return ''
  }
}

export default async function SubscribePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: planRows } = await supabase
    .from('plans')
    .select(
      'id, display_name, price_cents, monthly_message_limit, monthly_crawl_page_limit, supplementary_file_limit, stripe_price_id'
    )
    .order('price_cents', { ascending: true })
    .returns<PlanRow[]>()

  const plans = planRows ?? []
  const featuredId = 'pro'

  return (
    <div className="min-h-[100dvh] bg-[color:var(--bg-canvas)] px-6 py-14 text-[color:var(--ink-primary)]">
      <div className="mx-auto max-w-5xl">
        <header className="text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-tertiary)]">
            Almost there
          </p>
          <h1 className="mt-3 text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.05] tracking-tight">
            Pick a plan to activate your chatbot.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
            Subscribe to unlock crawling, the live chat widget, and the
            dashboard. Cancel anytime from settings.
          </p>
        </header>

        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {plans.map((plan) => {
            const featured = plan.id === featuredId
            return (
              <article
                key={plan.id}
                className={`surface-hairline relative flex flex-col rounded-2xl p-8 shadow-[var(--shadow-md)] ${
                  featured ? 'ring-2 ring-[color:var(--ink-primary)]' : ''
                }`}
              >
                {featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[color:var(--ink-primary)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--bg-surface)]">
                    Most popular
                  </span>
                )}
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
                  RubyCrawl {plan.display_name}
                </p>
                <p className="mt-3 flex items-baseline gap-1 font-mono tracking-tight text-[color:var(--ink-primary)]">
                  <span className="text-5xl">{formatPrice(plan.price_cents)}</span>
                  <span className="text-sm text-[color:var(--ink-tertiary)]">
                    /month
                  </span>
                </p>
                <p className="mt-1 text-xs text-[color:var(--ink-tertiary)]">
                  {planTagline(plan.id)}
                </p>

                <ul className="mt-8 flex-1 space-y-2.5 text-sm text-[color:var(--ink-secondary)]">
                  <FeatRow>
                    {numFmt(plan.monthly_message_limit)} chat messages / month
                  </FeatRow>
                  <FeatRow>
                    Crawl up to {numFmt(plan.monthly_crawl_page_limit)} pages
                  </FeatRow>
                  <FeatRow>
                    {numFmt(plan.supplementary_file_limit)} knowledge-file uploads
                  </FeatRow>
                  <FeatRow>Lead capture + CSV export</FeatRow>
                  <FeatRow>Calendly &amp; Google Maps integrations</FeatRow>
                  <FeatRow>Embeddable widget (any platform)</FeatRow>
                </ul>

                <div className="mt-10">
                  {plan.stripe_price_id ? (
                    <BillingAction
                      kind="checkout"
                      planId={plan.id}
                      label={`Subscribe to ${plan.display_name}`}
                      variant={featured ? 'primary' : 'secondary'}
                    />
                  ) : (
                    <p className="text-xs text-[color:var(--accent-danger)]">
                      Plan not configured — contact support.
                    </p>
                  )}
                </div>
              </article>
            )
          })}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-[color:var(--border-hairline)] pt-8 text-sm text-[color:var(--ink-tertiary)] sm:flex-row">
          <p>Not sure which to pick? We&apos;ll help.</p>
          <div className="flex items-center gap-4">
            <Link
              href="/contact"
              className="underline underline-offset-2 hover:text-[color:var(--ink-primary)]"
            >
              Done-for-you setup
            </Link>
            <span aria-hidden>·</span>
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                className="underline underline-offset-2 hover:text-[color:var(--ink-primary)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

function FeatRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <IconCheck
        width={13}
        height={13}
        className="mt-0.5 shrink-0 text-[color:var(--accent-success)]"
      />
      <span>{children}</span>
    </li>
  )
}
