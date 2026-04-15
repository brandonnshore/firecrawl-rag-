'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { IconSignOut } from '@/components/icons'

export function SignOutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleSignOut = async () => {
    setLoading(true)
    const response = await fetch('/api/auth/signout', { method: 'POST' })
    if (response.redirected) router.push('/login')
    else router.push('/login')
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={loading}
      className="btn-press focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[color:var(--ink-secondary)] hover:bg-[color:var(--bg-subtle)] hover:text-[color:var(--ink-primary)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <IconSignOut
        width={15}
        height={15}
        className="text-[color:var(--ink-tertiary)]"
      />
      <span>{loading ? 'Signing out…' : 'Sign out'}</span>
    </button>
  )
}
