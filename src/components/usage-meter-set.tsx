'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  buildMeterSet,
  type MeterCaps,
  type UsageCounter,
  type MeterSet,
} from '@/lib/billing/usage-meter-model'

interface Props {
  userId: string
  initialCounter: UsageCounter | null
  caps: MeterCaps | null
  /** Optional title rendered above the bars. */
  title?: string
}

/**
 * Mounts on /dashboard overview and /dashboard/billing. Initial render
 * comes from server-fetched props; a Supabase Realtime channel pushes
 * UPDATE events on the caller's usage_counters row so chat messages sent
 * in one tab update the bar in another within ~1s.
 */
export function UsageMeterSet({ userId, initialCounter, caps, title }: Props) {
  const [counter, setCounter] = useState<UsageCounter | null>(initialCounter)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`usage_counters:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'usage_counters',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as Partial<UsageCounter> | undefined
          if (!next) return
          setCounter((prev) => ({
            messages_used: next.messages_used ?? prev?.messages_used ?? 0,
            crawl_pages_used:
              next.crawl_pages_used ?? prev?.crawl_pages_used ?? 0,
            files_stored: next.files_stored ?? prev?.files_stored ?? 0,
          }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  const set: MeterSet = buildMeterSet({ counter, caps })

  return (
    <div className="space-y-3">
      {title ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          {title}
        </p>
      ) : null}
      <ul className="space-y-3">
        {set.rows.map((row) => (
          <li key={row.key}>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-[color:var(--ink-primary)]">
                {row.label}
              </span>
              <span className="font-mono text-xs text-[color:var(--ink-tertiary)]">
                {row.used.toLocaleString()} / {row.max.toLocaleString()}
              </span>
            </div>
            <div
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-inset,#eee)]"
              role="progressbar"
              aria-valuenow={row.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${row.label} usage`}
            >
              <div
                className="h-full bg-[color:var(--ink-primary)] transition-[width] duration-500 ease-out"
                style={{ width: `${row.percent}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
