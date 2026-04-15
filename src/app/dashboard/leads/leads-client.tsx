'use client'

import { useState } from 'react'

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
      <div className="py-16 text-center">
        <div className="mb-4 text-4xl">📧</div>
        <h2 className="mb-2 text-xl font-semibold">No leads yet</h2>
        <p className="text-zinc-500">
          Once your chatbot is live, visitor emails will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Leads ({leads.length})</h1>
        <a
          href="/api/leads/export"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-600"
        >
          Export CSV
        </a>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800">
            <tr>
              <th
                className="cursor-pointer px-4 py-3 text-left hover:bg-zinc-100"
                onClick={() => handleSort('name')}
              >
                Name {sortKey === 'name' && (sortAsc ? '↑' : '↓')}
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-left hover:bg-zinc-100"
                onClick={() => handleSort('email')}
              >
                Email {sortKey === 'email' && (sortAsc ? '↑' : '↓')}
              </th>
              <th className="px-4 py-3 text-left">Message</th>
              <th className="px-4 py-3 text-left">Source</th>
              <th
                className="cursor-pointer px-4 py-3 text-left hover:bg-zinc-100"
                onClick={() => handleSort('created_at')}
              >
                Date {sortKey === 'created_at' && (sortAsc ? '↑' : '↓')}
              </th>
              <th className="px-4 py-3 text-left">Chat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sorted.map((lead) => (
              <tr
                key={lead.id}
                className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <td className="px-4 py-3">{lead.name || '—'}</td>
                <td className="px-4 py-3 font-mono text-xs">{lead.email}</td>
                <td className="max-w-[200px] truncate px-4 py-3">
                  {lead.message || '—'}
                </td>
                <td className="max-w-[150px] truncate px-4 py-3 text-zinc-500">
                  {lead.source_page || '—'}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {new Date(lead.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  {lead.conversation_id ? (
                    <a
                      href={`/dashboard/conversations/${lead.conversation_id}`}
                      className="text-indigo-500 hover:underline"
                    >
                      View
                    </a>
                  ) : (
                    '—'
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
