import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

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
      <div className="py-16 text-center">
        <p className="text-zinc-500">Set up your chatbot first.</p>
      </div>
    )
  }

  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, visitor_id, message_count, last_message_at, created_at')
    .eq('site_id', site.id)
    .order('last_message_at', { ascending: false })

  if (!conversations || conversations.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="mb-4 text-4xl">💬</div>
        <h2 className="mb-2 text-xl font-semibold">No conversations yet</h2>
        <p className="text-zinc-500">
          Once your chatbot is live, you&apos;ll see every question visitors ask.
        </p>
      </div>
    )
  }

  return (
    <div className="py-8">
      <h1 className="mb-6 text-2xl font-bold">
        Conversations ({conversations.length})
      </h1>
      <div className="space-y-2">
        {conversations.map((c) => (
          <Link
            key={c.id}
            href={`/dashboard/conversations/${c.id}`}
            className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <div>
              <p className="text-sm font-medium">{c.visitor_id}</p>
              <p className="text-xs text-zinc-500">
                {c.message_count} messages
              </p>
            </div>
            <p className="text-xs text-zinc-400">
              {new Date(c.last_message_at).toLocaleString()}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
