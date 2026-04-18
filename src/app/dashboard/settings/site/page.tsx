import { createClient } from '@/lib/supabase/server'
import SiteClient from './site-client'

export const dynamic = 'force-dynamic'

export default async function SiteSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Parent /dashboard layout redirects guests — presence asserted for TS.
  if (!user) return null

  const { data: site } = await supabase
    .from('sites')
    .select(
      'id, url, site_key, calendly_url, google_maps_url, greeting_message, crawl_status'
    )
    .eq('user_id', user.id)
    .maybeSingle()

  if (!site) {
    return (
      <div className="rc-enter py-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Site
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Set up your chatbot first.
        </h1>
      </div>
    )
  }

  return <SiteClient site={site} />
}
