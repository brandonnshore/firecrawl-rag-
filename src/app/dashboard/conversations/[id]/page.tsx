import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'

export default async function ConversationDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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
  if (!site) notFound()

  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .eq('site_id', site.id)
    .maybeSingle()

  if (!conversation) notFound()

  const messages = conversation.messages as Array<{
    role: string
    content: string
  }>

  return (
    <div className="mx-auto max-w-2xl py-8">
      <Link
        href="/dashboard/conversations"
        className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-700"
      >
        ← Back to conversations
      </Link>
      <h1 className="mb-1 text-xl font-bold">Conversation</h1>
      <p className="mb-6 text-sm text-zinc-500">
        {conversation.visitor_id} ·{' '}
        {new Date(conversation.created_at).toLocaleString()}
      </p>
      <div className="space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-indigo-500 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
