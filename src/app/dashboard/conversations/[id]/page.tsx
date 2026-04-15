import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { IconChevronLeft } from '@/components/icons'

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
    <div className="mx-auto max-w-2xl rc-enter">
      <Link
        href="/dashboard/conversations"
        className="btn-press focus-ring inline-flex items-center gap-1 text-xs font-medium text-[color:var(--ink-tertiary)] hover:text-[color:var(--ink-primary)]"
      >
        <IconChevronLeft width={12} height={12} />
        <span>Back to conversations</span>
      </Link>

      <header className="mt-6 mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Transcript
        </p>
        <h1 className="mt-2 font-mono text-base font-medium tracking-tight text-[color:var(--ink-primary)]">
          {conversation.visitor_id}
        </h1>
        <p className="mt-1 text-xs text-[color:var(--ink-tertiary)]">
          Started{' '}
          {new Date(conversation.created_at).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}{' '}
          · {messages.length} {messages.length === 1 ? 'message' : 'messages'}
        </p>
      </header>

      <div className="space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex rc-enter ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            style={{ animationDelay: `${Math.min(i * 25, 300)}ms` }}
          >
            <div
              className={`max-w-[78%] rounded-xl px-3.5 py-2 text-[14px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-[color:var(--ink-primary)] text-[color:var(--bg-surface)]'
                  : 'surface-hairline text-[color:var(--ink-primary)]'
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
