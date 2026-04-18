import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  IconArrowRight,
  IconCheck,
  IconSparkle,
} from '@/components/icons'
import { UsageMeterSet } from '@/components/usage-meter-set'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase
    .from('sites')
    .select('id, url, crawl_status, site_key')
    .eq('user_id', user.id)
    .maybeSingle()

  // First-run empty state — no site yet.
  if (!site) {
    return (
      <div className="rc-enter">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Welcome, {user.email}
        </p>
        <h1 className="mt-3 text-4xl font-semibold leading-[1.05] tracking-tight text-[color:var(--ink-primary)] md:text-5xl">
          Let&apos;s build your
          <br />
          chatbot.
        </h1>
        <p className="mt-6 max-w-md text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
          Paste a URL, we crawl every page, and three minutes later your site
          has an AI chatbot that knows your business. Embed with one line.
        </p>

        <Link
          href="/dashboard/setup"
          className="btn-press focus-ring group mt-10 inline-flex items-center gap-2.5 rounded-lg bg-[color:var(--ink-primary)] px-5 py-2.5 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)]"
        >
          <IconSparkle width={15} height={15} />
          <span>Start the build</span>
          <IconArrowRight
            width={14}
            height={14}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </Link>

        <div className="mt-16 grid max-w-2xl grid-cols-1 gap-6 sm:grid-cols-3">
          <Step n="01" title="Paste URL" body="We validate, kick off the crawl." />
          <Step n="02" title="Train" body="Every page embedded for retrieval." />
          <Step
            n="03"
            title="Embed"
            body="One script tag. Ship to your site."
          />
        </div>
      </div>
    )
  }

  const { count: convCount } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', site.id)

  const hasReady = site.crawl_status === 'ready'
  const hasConversations = (convCount ?? 0) > 0

  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, visitor_id, message_count, last_message_at')
    .eq('site_id', site.id)
    .order('last_message_at', { ascending: false })
    .limit(5)

  const { count: totalLeads } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', site.id)

  const totalMessages =
    conversations?.reduce((sum, c) => sum + (c.message_count || 0), 0) || 0
  const uniqueVisitors = new Set(conversations?.map((c) => c.visitor_id) || [])
    .size

  const [counterRes, profileRes] = await Promise.all([
    supabase
      .from('usage_counters')
      .select('messages_used, crawl_pages_used, files_stored')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('plan_id')
      .eq('id', user.id)
      .maybeSingle(),
  ])
  const ownerPlanId = (profileRes.data as { plan_id: string | null } | null)?.plan_id
  const { data: planRow } = ownerPlanId
    ? await supabase
        .from('plans')
        .select('monthly_message_limit, monthly_crawl_page_limit, supplementary_file_limit')
        .eq('id', ownerPlanId)
        .maybeSingle()
    : { data: null }
  const initialCounter = counterRes.data as {
    messages_used: number
    crawl_pages_used: number
    files_stored: number
  } | null
  const caps = planRow as {
    monthly_message_limit: number
    monthly_crawl_page_limit: number
    supplementary_file_limit: number
  } | null

  return (
    <div className="rc-enter space-y-12">
      {/* Header row */}
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
            Overview
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
            {hostnameOf(site.url)}
          </h1>
        </div>
        <StatusPill status={site.crawl_status} />
      </header>

      {/* Setup checklist — collapses when done */}
      {(!hasReady || !hasConversations) && (
        <section className="surface-hairline rounded-xl p-6">
          <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ink-primary)]">
            Getting started
          </h3>
          <ol className="mt-4 divide-y divide-[color:var(--border-hairline)]">
            <ChecklistItem
              done={hasReady}
              label="Build your chatbot"
              href="/dashboard/setup"
            />
            <ChecklistItem
              done={hasReady}
              label="Add it to your website"
              href="/dashboard/embed"
            />
            <ChecklistItem
              done={hasConversations}
              label="Test with a question"
              href="/dashboard/preview"
            />
          </ol>
        </section>
      )}

      {/* Metrics — asymmetric bento (big + two small + wide) */}
      <section className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-[color:var(--border-hairline)] bg-[color:var(--border-hairline)] sm:grid-cols-3">
        <MetricCard
          label="Visitors helped"
          value={uniqueVisitors}
          hint="Unique site visitors"
          span="sm:col-span-1 sm:row-span-2"
          emphasis
        />
        <MetricCard label="Messages answered" value={totalMessages} />
        <MetricCard label="Leads captured" value={totalLeads ?? 0} />
        <div className="col-span-full bg-[color:var(--bg-surface)] p-6 sm:col-span-2">
          <UsageMeterSet
            userId={user.id}
            initialCounter={initialCounter}
            caps={caps}
            title="Usage this period"
          />
        </div>
      </section>

      {/* Recent conversations */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-[color:var(--ink-primary)]">
            Recent conversations
          </h2>
          {conversations && conversations.length > 0 && (
            <Link
              href="/dashboard/conversations"
              className="btn-press focus-ring group inline-flex items-center gap-1 text-xs font-medium text-[color:var(--ink-secondary)] hover:text-[color:var(--ink-primary)]"
            >
              <span>View all</span>
              <IconArrowRight
                width={12}
                height={12}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Link>
          )}
        </div>
        {conversations && conversations.length > 0 ? (
          <ul className="surface-hairline divide-y divide-[color:var(--border-hairline)] overflow-hidden rounded-xl">
            {conversations.map((c, i) => (
              <li
                key={c.id}
                className="rc-enter"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <Link
                  href={`/dashboard/conversations/${c.id}`}
                  className="btn-press focus-ring flex items-center justify-between gap-4 px-5 py-3 hover:bg-[color:var(--bg-subtle)]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] text-[color:var(--ink-primary)]">
                      {c.visitor_id}
                    </p>
                    <p className="text-xs text-[color:var(--ink-tertiary)]">
                      {c.message_count}{' '}
                      {c.message_count === 1 ? 'message' : 'messages'}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-[color:var(--ink-tertiary)]">
                    {relTime(c.last_message_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="surface-hairline rounded-xl px-5 py-10 text-center">
            <p className="text-sm text-[color:var(--ink-secondary)]">
              Once your chatbot goes live, every question a visitor asks shows
              up here.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function relTime(iso: string) {
  const d = new Date(iso).getTime()
  const diff = Math.max(0, Date.now() - d)
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="border-t border-[color:var(--border-hairline)] pt-4">
      <p className="font-mono text-[10px] tracking-[0.16em] text-[color:var(--ink-tertiary)]">
        {n}
      </p>
      <p className="mt-1.5 text-sm font-medium text-[color:var(--ink-primary)]">
        {title}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        {body}
      </p>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; color: string; bg: string; dot: boolean }
  > = {
    ready: {
      label: 'Ready',
      color: 'var(--accent-success)',
      bg: 'var(--accent-success-bg)',
      dot: true,
    },
    crawling: {
      label: 'Crawling',
      color: 'var(--ink-primary)',
      bg: 'var(--bg-subtle)',
      dot: true,
    },
    indexing: {
      label: 'Indexing',
      color: 'var(--ink-primary)',
      bg: 'var(--bg-subtle)',
      dot: true,
    },
    failed: {
      label: 'Failed',
      color: 'var(--accent-danger)',
      bg: 'var(--accent-danger-bg)',
      dot: false,
    },
    pending: {
      label: 'Pending',
      color: 'var(--ink-secondary)',
      bg: 'var(--bg-subtle)',
      dot: false,
    },
  }
  const s = map[status] ?? map.pending
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      {s.dot && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${status === 'crawling' || status === 'indexing' ? 'rc-pulse' : ''}`}
          style={{ background: s.color }}
        />
      )}
      {s.label}
    </span>
  )
}

function MetricCard({
  label,
  value,
  hint,
  span,
  emphasis = false,
}: {
  label: string
  value: number
  hint?: string
  span?: string
  emphasis?: boolean
}) {
  return (
    <div className={`bg-[color:var(--bg-surface)] p-6 ${span ?? ''}`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
        {label}
      </p>
      <p
        className={`mt-2 font-mono tracking-tight text-[color:var(--ink-primary)] ${emphasis ? 'text-5xl' : 'text-3xl'}`}
      >
        {value.toLocaleString()}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-[color:var(--ink-tertiary)]">{hint}</p>
      )}
    </div>
  )
}

function ChecklistItem({
  done,
  label,
  href,
}: {
  done: boolean
  label: string
  href: string
}) {
  return (
    <li>
      <Link
        href={href}
        className="btn-press focus-ring group flex items-center justify-between gap-3 py-3"
      >
        <span className="flex items-center gap-3">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full border ${
              done
                ? 'border-[color:var(--accent-success)] bg-[color:var(--accent-success-bg)] text-[color:var(--accent-success)]'
                : 'border-[color:var(--border-strong)] text-[color:var(--ink-tertiary)]'
            }`}
          >
            {done ? <IconCheck width={11} height={11} /> : null}
          </span>
          <span
            className={`text-sm ${done ? 'text-[color:var(--ink-tertiary)] line-through' : 'text-[color:var(--ink-primary)]'}`}
          >
            {label}
          </span>
        </span>
        <IconArrowRight
          width={14}
          height={14}
          className="text-[color:var(--ink-tertiary)] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[color:var(--ink-secondary)]"
        />
      </Link>
    </li>
  )
}
