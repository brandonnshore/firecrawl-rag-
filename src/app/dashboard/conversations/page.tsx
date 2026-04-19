import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { IconArrowRight } from '@/components/icons'

export default async function ConversationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!site) {
    return (
      <div className="rc-enter py-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Conversations
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Set up your chatbot first.
        </h1>
      </div>
    )
  }

  const { data: conversations } = await supabase
    .from('conversations')
    .select(
      'id, visitor_id, message_count, last_message_at, created_at, needs_human'
    )
    .eq('site_id', site.id)
    .order('last_message_at', { ascending: false })

  if (!conversations || conversations.length === 0) {
    return (
      <div className="rc-enter py-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Conversations
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          No conversations yet.
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-[color:var(--ink-secondary)]">
          Once your chatbot is live on your site, every question a visitor asks
          shows up here with the full transcript.
        </p>
      </div>
    )
  }

  return (
    <div className="rc-enter">
      <header className="mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Conversations
        </p>
        <h1 className="mt-2 flex items-baseline gap-3 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          <span>All sessions</span>
          <span className="font-mono text-base font-normal text-[color:var(--ink-tertiary)]">
            {conversations.length}
          </span>
        </h1>
      </header>

      <ul className="surface-hairline divide-y divide-[color:var(--border-hairline)] overflow-hidden rounded-xl">
        {conversations.map((c, i) => (
          <li
            key={c.id}
            className="rc-enter"
            style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
          >
            <Link
              href={`/dashboard/conversations/${c.id}`}
              className="btn-press focus-ring group flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-[color:var(--bg-subtle)]"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate font-mono text-[12px] text-[color:var(--ink-primary)]">
                  {c.needs_human && (
                    <span
                      title="Flagged for human handoff"
                      aria-label="Flagged for human handoff"
                      className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
                    >
                      ⚑ handoff
                    </span>
                  )}
                  <span className="truncate">{c.visitor_id}</span>
                </p>
                <p className="text-xs text-[color:var(--ink-tertiary)]">
                  {c.message_count}{' '}
                  {c.message_count === 1 ? 'message' : 'messages'} · started{' '}
                  {new Date(c.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-[11px] text-[color:var(--ink-tertiary)]">
                  {new Date(c.last_message_at).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                <IconArrowRight
                  width={14}
                  height={14}
                  className="text-[color:var(--ink-tertiary)] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[color:var(--ink-secondary)]"
                />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
