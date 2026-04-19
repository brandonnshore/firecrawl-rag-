import { createClient } from '@/lib/supabase/server'
import { KnowledgeClient } from './knowledge-client'

export const dynamic = 'force-dynamic'

export default async function KnowledgePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Parent /dashboard layout redirects guests; null-check satisfies TS.
  if (!user) return null

  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle<{ id: string }>()

  if (!site) {
    return (
      <div className="rc-enter py-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Knowledge
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Set up your chatbot first.
        </h1>
        <p className="mt-3 max-w-md text-sm text-[color:var(--ink-secondary)]">
          Crawl your website, then come back to add supplementary files.
        </p>
      </div>
    )
  }

  const [filesRes, profileRes] = await Promise.all([
    supabase
      .from('supplementary_files')
      .select(
        'id, filename, bytes, status, error_message, chunks_count, created_at'
      )
      .eq('site_id', site.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('plan_id')
      .eq('id', user.id)
      .maybeSingle<{ plan_id: string | null }>(),
  ])

  const planId = profileRes.data?.plan_id
  const { data: planRow } = planId
    ? await supabase
        .from('plans')
        .select('supplementary_file_limit')
        .eq('id', planId)
        .maybeSingle<{ supplementary_file_limit: number }>()
    : { data: null }

  const fileLimit = planRow?.supplementary_file_limit ?? 25

  return (
    <KnowledgeClient
      initialFiles={(filesRes.data as Parameters<typeof KnowledgeClient>[0]['initialFiles']) ?? []}
      siteId={site.id}
      userId={user.id}
      fileLimit={fileLimit}
    />
  )
}
