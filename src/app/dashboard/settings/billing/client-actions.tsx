'use client'

import { useState, useTransition } from 'react'

type ActionKind = 'checkout' | 'portal' | 'change'

interface Props {
  kind: ActionKind
  planId?: string
  label: string
  variant?: 'primary' | 'secondary' | 'ghost'
}

export function BillingAction({ kind, planId, label, variant = 'primary' }: Props) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    start(async () => {
      try {
        const res = await fetch(endpointFor(kind), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: planId ? JSON.stringify({ plan_id: planId }) : undefined,
        })
        const body: { url?: string; error?: string } = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(body.error || `Request failed (${res.status})`)
          return
        }
        if (body.url) {
          window.location.href = body.url
          return
        }
        // Change-plan has no URL — refresh server component state
        window.location.reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    })
  }

  const base =
    'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-60'
  const byVariant: Record<NonNullable<Props['variant']>, string> = {
    primary:
      'bg-[color:var(--ink-primary)] text-[color:var(--bg-canvas)] hover:opacity-90',
    secondary:
      'surface-hairline text-[color:var(--ink-primary)] hover:bg-[color:var(--surface-hover)]',
    ghost:
      'text-[color:var(--ink-secondary)] hover:text-[color:var(--ink-primary)]',
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={`${base} ${byVariant[variant]}`}
      >
        {pending ? 'Working…' : label}
      </button>
      {error ? (
        <p className="text-xs text-[color:var(--accent-danger,red)]">{error}</p>
      ) : null}
    </div>
  )
}

function endpointFor(kind: ActionKind): string {
  switch (kind) {
    case 'checkout':
      return '/api/stripe/checkout'
    case 'portal':
      return '/api/stripe/portal'
    case 'change':
      return '/api/stripe/change-plan'
  }
}
