export default function BillingPage() {
  return (
    <div className="mx-auto max-w-xl rc-enter">
      <header className="mb-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Billing
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Your subscription.
        </h1>
      </header>

      <section className="surface-hairline rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
              Current plan
            </p>
            <p className="mt-2 text-xl font-medium tracking-tight text-[color:var(--ink-primary)]">
              RubyCrawl Standard
            </p>
            <p className="mt-1 font-mono text-sm text-[color:var(--ink-secondary)]">
              $24.99
              <span className="text-[color:var(--ink-tertiary)]">/month</span>
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--accent-success-bg)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--accent-success)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent-success)] rc-pulse" />
            Active
          </span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[color:var(--border-hairline)] pt-5">
          <Feature label="Pages crawled" value="up to 100" />
          <Feature label="Messages / month" value="500" />
          <Feature label="Lead capture" value="Included" />
          <Feature label="Integrations" value="Calendly, Maps" />
        </div>
      </section>

      <p className="mt-6 text-xs text-[color:var(--ink-tertiary)]">
        Stripe integration is in progress. For now your account is active on
        the standard plan.
      </p>
    </div>
  )
}

function Feature({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-tertiary)]">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-[color:var(--ink-primary)]">
        {value}
      </p>
    </div>
  )
}
