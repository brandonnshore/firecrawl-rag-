'use client'

import { useState } from 'react'
import { IconDownload, IconExternal } from '@/components/icons'

interface Lead {
  id: number
  name: string | null
  email: string
  message: string | null
  source_page: string | null
  conversation_id: string | null
  created_at: string
}

type SortKey = 'name' | 'email' | 'created_at'

export default function LeadsClient({ leads }: { leads: Lead[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortAsc, setSortAsc] = useState(false)

  const sorted = [...leads].sort((a, b) => {
    const aVal = a[sortKey] || ''
    const bVal = b[sortKey] || ''
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
    return sortAsc ? cmp : -cmp
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  if (leads.length === 0) {
    return (
      <div className="rc-enter py-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Leads
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          No leads yet.
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-[color:var(--ink-secondary)]">
          Visitors drop their email inside the chat after a few messages — we
          collect it here with the conversation attached.
        </p>
      </div>
    )
  }

  return (
    <div className="rc-enter">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
            Leads
          </p>
          <h1 className="mt-2 flex items-baseline gap-3 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
            <span>Captured</span>
            <span className="font-mono text-base font-normal text-[color:var(--ink-tertiary)]">
              {leads.length}
            </span>
          </h1>
        </div>
        <a
          href="/api/leads/export"
          className="btn-press focus-ring inline-flex items-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-3.5 py-1.5 text-xs font-medium text-[color:var(--ink-primary)] hover:bg-[color:var(--bg-subtle)]"
        >
          <IconDownload width={13} height={13} />
          <span>Export CSV</span>
        </a>
      </header>

      <div className="surface-hairline overflow-hidden rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--border-hairline)]">
              <Th onClick={() => handleSort('name')} active={sortKey === 'name'} asc={sortAsc}>
                Name
              </Th>
              <Th
                onClick={() => handleSort('email')}
                active={sortKey === 'email'}
                asc={sortAsc}
              >
                Email
              </Th>
              <Th>Message</Th>
              <Th>Source</Th>
              <Th
                onClick={() => handleSort('created_at')}
                active={sortKey === 'created_at'}
                asc={sortAsc}
              >
                Date
              </Th>
              <Th>Chat</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border-hairline)]">
            {sorted.map((lead, i) => (
              <tr
                key={lead.id}
                className="rc-enter hover:bg-[color:var(--bg-subtle)]"
                style={{ animationDelay: `${Math.min(i * 15, 200)}ms` }}
              >
                <td className="px-4 py-3 align-top text-[color:var(--ink-primary)]">
                  {lead.name || (
                    <span className="text-[color:var(--ink-tertiary)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top font-mono text-[12px] text-[color:var(--ink-primary)]">
                  {lead.email}
                </td>
                <td className="max-w-[220px] truncate px-4 py-3 align-top text-[color:var(--ink-secondary)]">
                  {lead.message || (
                    <span className="text-[color:var(--ink-tertiary)]">—</span>
                  )}
                </td>
                <td className="max-w-[180px] truncate px-4 py-3 align-top">
                  {lead.source_page ? (
                    <a
                      href={lead.source_page}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-ring inline-flex items-center gap-1 text-[color:var(--ink-secondary)] hover:text-[color:var(--ink-primary)]"
                    >
                      <span className="truncate">
                        {lead.source_page.replace(/^https?:\/\//, '')}
                      </span>
                      <IconExternal width={11} height={11} />
                    </a>
                  ) : (
                    <span className="text-[color:var(--ink-tertiary)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top font-mono text-[11px] text-[color:var(--ink-tertiary)]">
                  {new Date(lead.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </td>
                <td className="px-4 py-3 align-top">
                  {lead.conversation_id ? (
                    <a
                      href={`/dashboard/conversations/${lead.conversation_id}`}
                      className="btn-press focus-ring inline-flex items-center gap-1 text-[color:var(--ink-primary)] underline-offset-4 hover:underline"
                    >
                      View
                      <IconExternal width={11} height={11} />
                    </a>
                  ) : (
                    <span className="text-[color:var(--ink-tertiary)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({
  children,
  onClick,
  active,
  asc,
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  asc?: boolean
}) {
  const cls =
    'px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-tertiary)]'
  if (!onClick) return <th className={cls}>{children}</th>
  return (
    <th className={cls}>
      <button
        onClick={onClick}
        className="focus-ring btn-press inline-flex items-center gap-1 hover:text-[color:var(--ink-primary)]"
      >
        {children}
        {active && (
          <span className="text-[color:var(--ink-secondary)]">
            {asc ? '↑' : '↓'}
          </span>
        )}
      </button>
    </th>
  )
}
