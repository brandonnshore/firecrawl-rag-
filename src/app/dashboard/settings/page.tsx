import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SettingsClient from './settings-client'

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase
    .from('sites')
    .select(
      'id, url, site_key, calendly_url, google_maps_url, greeting_message, crawl_status'
    )
    .eq('user_id', user.id)
    .maybeSingle()

  if (!site) {
    return (
      <div className="py-16 text-center">
        <p className="text-zinc-500">Set up your chatbot first.</p>
      </div>
    )
  }

  return <SettingsClient site={site} />
}
