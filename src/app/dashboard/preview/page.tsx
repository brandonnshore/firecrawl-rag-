import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PreviewClient from './preview-client'

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
      <div className="py-16 text-center">
        <h2 className="mb-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          No chatbot yet
        </h2>
        <p className="mb-4 text-zinc-500">
          Set up your website first to preview the chatbot.
        </p>
        <a
          href="/dashboard/setup"
          className="text-indigo-600 hover:underline"
        >
          Go to setup →
        </a>
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
