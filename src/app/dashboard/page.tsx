import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SignOutButton } from './sign-out-button'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md text-center">
        <h1 className="mb-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Dashboard
        </h1>
        <p className="mb-1 text-zinc-600 dark:text-zinc-400">
          Welcome back!
        </p>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-500">
          {user.email}
        </p>
        <p className="mb-8 text-zinc-600 dark:text-zinc-400">
          No site yet — set up your chatbot to get started.
        </p>
        <SignOutButton />
      </div>
    </div>
  )
}
