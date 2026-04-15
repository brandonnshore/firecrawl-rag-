import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

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

  if (!site) {
    return (
      <div className="py-16 text-center">
        <h1 className="mb-4 text-2xl font-bold">Welcome to RubyCrawl</h1>
        <p className="mb-6 text-zinc-500">Let&apos;s get your AI chatbot set up.</p>
        <Link
          href="/dashboard/setup"
          className="rounded-lg bg-indigo-500 px-6 py-3 font-medium text-white hover:bg-indigo-600"
        >
          Build your chatbot →
        </Link>
      </div>
    )
  }

  const { count: convCount } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', site.id)

  const hasSite = site.crawl_status === 'ready'
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

  return (
    <div className="py-8">
      {(!hasSite || !hasConversations) && (
        <div className="mb-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <h3 className="mb-3 font-medium">Getting started</h3>
          <div className="space-y-2">
            <ChecklistItem
              done={hasSite}
              label="Build your chatbot"
              href="/dashboard/setup"
            />
            <ChecklistItem
              done={hasSite}
              label="Add to your website"
              href="/dashboard/embed"
            />
            <ChecklistItem
              done={hasConversations}
              label="Test with a question"
              href="/dashboard/preview"
            />
          </div>
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="People your chatbot helped" value={uniqueVisitors} />
        <MetricCard label="Questions answered" value={totalMessages} />
        <MetricCard label="Leads captured" value={totalLeads ?? 0} />
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Recent conversations</h2>
        {conversations && conversations.length > 0 ? (
          <div className="space-y-2">
            {conversations.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/conversations/${c.id}`}
                className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 text-sm hover:bg-zinc-50 dark:border-zinc-700"
              >
                <span>
                  {c.visitor_id} · {c.message_count} messages
                </span>
                <span className="text-xs text-zinc-400">
                  {new Date(c.last_message_at).toLocaleString()}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            No conversations yet. Once your chatbot is live, you&apos;ll see
            every question visitors ask.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Subscription</p>
            <p className="text-sm text-zinc-500">$24.99/month</p>
          </div>
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            Active
          </span>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm text-zinc-500">{label}</p>
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
    <Link
      href={href}
      className="flex items-center gap-2 text-sm hover:underline"
    >
      <span className={done ? 'text-green-500' : 'text-zinc-400'}>
        {done ? '✓' : '○'}
      </span>
      <span className={done ? 'text-zinc-500 line-through' : ''}>{label}</span>
    </Link>
  )
}
