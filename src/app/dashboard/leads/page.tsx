import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LeadsClient from './leads-client'

export default async function LeadsPage() {
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

  if (!site) {
    return (
      <div className="py-16 text-center">
        <p className="text-zinc-500">
          Set up your chatbot first to start capturing leads.
        </p>
        <a
          href="/dashboard/setup"
          className="mt-2 inline-block text-indigo-600 hover:underline"
        >
          Go to setup →
        </a>
      </div>
    )
  }

  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, email, message, source_page, conversation_id, created_at')
    .eq('site_id', site.id)
    .order('created_at', { ascending: false })

  return <LeadsClient leads={leads || []} />
}
