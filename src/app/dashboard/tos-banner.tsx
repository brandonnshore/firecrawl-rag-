'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'

/**
 * Banner shown to legacy users whose profiles predate the ToS requirement
 * (tos_accepted_at IS NULL). Click the button to stamp acceptance via
 * POST /api/account/accept-tos. Blocks billing upgrades until accepted
 * — server-side checks in /api/stripe/checkout and /api/stripe/change-plan
 * return 403 tos_required even if this banner is dismissed client-side.
 */
export function TosBanner() {
  const [accepting, setAccepting] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const router = useRouter()

  if (dismissed) return null

  async function accept() {
    setAccepting(true)
    try {
      const res = await fetch('/api/account/accept-tos', { method: 'POST' })
      if (!res.ok) {
        toast.error('Could not record acceptance — please retry.')
        return
      }
      toast.success('Thanks — preferences saved.')
      setDismissed(true)
      router.refresh()
    } catch {
      toast.error('Network error — please retry.')
    } finally {
      setAccepting(false)
    }
  }

  return (
    <section
      role="region"
      aria-label="Terms of Service acceptance"
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900"
    >
      <p className="text-sm font-medium">Please accept the updated Terms of Service.</p>
      <p className="mt-1 text-xs">
        We updated our terms. You&rsquo;ll need to accept them before
        upgrading or changing your plan.{' '}
        <Link
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-amber-950"
        >
          Read the terms
        </Link>
        .
      </p>
      <div className="mt-3">
        <button
          type="button"
          onClick={accept}
          disabled={accepting}
          className="btn-press focus-ring inline-flex items-center rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-950 disabled:opacity-60"
        >
          {accepting ? 'Saving…' : 'I accept the terms'}
        </button>
      </div>
    </section>
  )
}
