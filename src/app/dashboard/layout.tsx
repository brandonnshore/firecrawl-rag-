import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from './sidebar'
import { TosBanner } from './tos-banner'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Legacy-user ToS prompt (VAL-TOS-004). Renders a banner above every
  // dashboard page when profiles.tos_accepted_at is NULL.
  const { data: profile } = await supabase
    .from('profiles')
    .select('tos_accepted_at')
    .eq('id', user.id)
    .maybeSingle<{ tos_accepted_at: string | null }>()
  const needsTos = !profile?.tos_accepted_at

  return (
    <div className="flex h-[100dvh] bg-[color:var(--bg-canvas)]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-8 py-10">
          {needsTos ? <TosBanner /> : null}
          {children}
        </div>
      </main>
    </div>
  )
}
