import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {user.email}
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 text-4xl">💬</div>
        <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          No site yet
        </h2>
        <p className="mb-6 max-w-sm text-zinc-600 dark:text-zinc-400">
          Set up your chatbot to get started. Paste your website URL and
          we&apos;ll train an AI chatbot on your content in minutes.
        </p>
        <Link
          href="/dashboard/setup"
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Build your chatbot
        </Link>
      </div>
    </div>
  )
}
