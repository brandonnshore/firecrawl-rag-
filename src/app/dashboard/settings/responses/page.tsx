import { createClient } from '@/lib/supabase/server'
import { ResponsesClient, type ResponseRuleRow } from './responses-client'

export const dynamic = 'force-dynamic'

export default async function ResponsesPage() {
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
          Responses
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Set up your chatbot first.
        </h1>
        <p className="mt-3 max-w-md text-sm text-[color:var(--ink-secondary)]">
          Crawl your website, then come back to add custom responses.
        </p>
      </div>
    )
  }

  const { data: rules } = await supabase
    .from('custom_responses')
    .select(
      'id, trigger_type, triggers, response, priority, is_active, created_at'
    )
    .eq('site_id', site.id)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })

  return (
    <ResponsesClient
      initialRules={(rules as ResponseRuleRow[]) ?? []}
      siteId={site.id}
    />
  )
}
