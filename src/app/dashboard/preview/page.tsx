import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import PreviewClient from './preview-client'
import { IconArrowRight } from '@/components/icons'

export default async function PreviewPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase
    .from('sites')
    .select(
      'id, site_key, url, name, crawl_status, active_crawl_batch, calendly_url, google_maps_url'
    )
    .eq('user_id', user.id)
    .maybeSingle()

  if (!site || site.crawl_status !== 'ready') {
    return (
      <div className="rc-enter py-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Preview
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          No chatbot to preview yet.
        </h1>
        <p className="mt-2 max-w-md text-sm text-[color:var(--ink-secondary)]">
          Build your chatbot first. We&apos;ll crawl your site and come back
          here in a few minutes.
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

  const { data: sampleChunks } = await supabase
    .from('embeddings')
    .select('chunk_text, source_url')
    .eq('site_id', site.id)
    .eq('crawl_batch', site.active_crawl_batch ?? 1)
    .limit(6)

  return (
    <PreviewClient
      site={{
        id: site.id,
        site_key: site.site_key,
        url: site.url,
        name: site.name,
      }}
      sampleChunks={sampleChunks || []}
    />
  )
}
