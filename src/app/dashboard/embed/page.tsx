import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import EmbedClient from './embed-client'
import { IconArrowRight } from '@/components/icons'

export default async function EmbedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase
    .from('sites')
    .select('site_key, url, crawl_status')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!site) {
    return (
      <div className="rc-enter py-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Embed
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          No chatbot to embed yet.
        </h1>
        <p className="mt-2 max-w-md text-sm text-[color:var(--ink-secondary)]">
          Build your chatbot first, then we&apos;ll give you the embed code.
        </p>
        <Link
          href="/dashboard/setup"
          className="btn-press focus-ring group mt-6 inline-flex items-center gap-2 rounded-lg bg-[color:var(--ink-primary)] px-4 py-2 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)]"
        >
          <span>Go to setup</span>
          <IconArrowRight
            width={14}
            height={14}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </Link>
      </div>
    )
  }

  return <EmbedClient siteKey={site.site_key} />
}
