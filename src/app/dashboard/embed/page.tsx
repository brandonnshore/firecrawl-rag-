import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EmbedClient from './embed-client'

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
      <div className="py-16 text-center">
        <h2 className="mb-2 text-xl font-semibold">No chatbot yet</h2>
        <p className="mb-4 text-zinc-500">Set up your website first.</p>
        <a href="/dashboard/setup" className="text-indigo-600 hover:underline">
          Go to setup →
        </a>
      </div>
    )
  }

  return <EmbedClient siteKey={site.site_key} />
}
