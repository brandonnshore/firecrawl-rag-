# M5: Dashboard + Polish — Execution Document

## Prerequisites
- M4 complete: widget working, chat API working, lead capture API working
- All prior files exist (auth, crawl, chat, widget, leads)
- A test site with data (conversations, leads) for dashboard to display

## What to Build

8 features: Preview, Embed, Leads, Conversations, Settings, Main Dashboard with Metrics, Landing Page, Cross-Area Integration fixes.

---

## Existing Dashboard Structure

The dashboard layout already exists:
- `src/app/dashboard/layout.tsx` — Layout with sidebar
- `src/app/dashboard/sidebar.tsx` — Client component with nav links
- `src/app/dashboard/nav-items.ts` — Nav config: Dashboard, Preview, Embed, Leads, Conversations, Settings, Billing
- `src/app/dashboard/page.tsx` — Placeholder (will be replaced)

All new pages go under `src/app/dashboard/*/page.tsx`.

---

## Feature 1: Preview Page

### `src/app/dashboard/preview/page.tsx`

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import PreviewClient from './preview-client'

export default async function PreviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase
    .from('sites')
    .select('id, site_key, url, name, crawl_status, calendly_url, google_maps_url')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!site || site.crawl_status !== 'ready') {
    return (
      <div className="py-16 text-center">
        <h2 className="text-xl font-semibold mb-2">No chatbot yet</h2>
        <p className="text-zinc-500 mb-4">Set up your website first to preview the chatbot.</p>
        <a href="/dashboard/setup" className="text-indigo-600 hover:underline">Go to setup →</a>
      </div>
    )
  }

  // Generate suggested questions by fetching a few diverse embeddings
  const { data: sampleChunks } = await supabase
    .from('embeddings')
    .select('chunk_text, source_url')
    .eq('site_id', site.id)
    .eq('crawl_batch', site.crawl_status === 'ready' ? 1 : 0) // Use active batch
    .limit(6)

  return <PreviewClient site={site} sampleChunks={sampleChunks || []} />
}
```

### `src/app/dashboard/preview/preview-client.tsx`

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'

interface Site {
  id: string
  site_key: string
  url: string
  name: string | null
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function PreviewClient({
  site,
  sampleChunks,
}: {
  site: Site
  sampleChunks: Array<{ chunk_text: string; source_url: string }>
}) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! How can I help you today?' },
  ])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)

  // Generate suggested questions from sample chunks
  const suggestedQuestions = generateSuggestions(sampleChunks)

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return
    setInput('')
    const userMsg: Message = { role: 'user', content: text.trim() }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setIsStreaming(true)

    try {
      const sessionRes = await fetch('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          history: updated.slice(1, -1), // exclude greeting and current
          site_key: site.site_key,
        }),
      })
      if (!sessionRes.ok) throw new Error('Session failed')
      const { sessionId } = await sessionRes.json()

      const streamRes = await fetch(`/api/chat/stream?sid=${sessionId}`)
      if (!streamRes.ok || !streamRes.body) throw new Error('Stream failed')

      const reader = streamRes.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
        setMessages(prev => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: 'assistant', content: fullText }
          return copy
        })
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="text-2xl font-bold mb-2">Preview your chatbot</h1>
      <p className="text-zinc-500 mb-6">Test your chatbot before adding it to your website.</p>

      {/* Suggested questions */}
      {messages.length <= 1 && suggestedQuestions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {suggestedQuestions.map((q, i) => (
            <button
              key={i}
              onClick={() => sendMessage(q)}
              className="rounded-full border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Chat area */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        <div className="h-96 overflow-y-auto p-4 space-y-3 bg-white dark:bg-zinc-900">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-indigo-500 text-white'
                  : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
              }`}>
                {msg.content || '...'}
              </div>
            </div>
          ))}
          <div ref={messagesEnd} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(input) }} className="flex border-t border-zinc-200 dark:border-zinc-700">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            disabled={isStreaming}
            className="flex-1 px-4 py-3 text-sm bg-transparent outline-none"
          />
          <button type="submit" disabled={isStreaming || !input.trim()} className="px-4 text-indigo-500 font-medium text-sm disabled:opacity-50">
            Send
          </button>
        </form>
      </div>

      {/* CTA */}
      <div className="mt-6 text-center">
        <a
          href="/dashboard/embed"
          className="inline-block rounded-lg bg-indigo-500 px-6 py-3 font-medium text-white hover:bg-indigo-600"
        >
          Love it? Add it to your website →
        </a>
      </div>
    </div>
  )
}

function generateSuggestions(chunks: Array<{ chunk_text: string; source_url: string }>): string[] {
  if (chunks.length === 0) return []
  // Simple heuristic: extract potential questions from chunk content
  const suggestions: string[] = []
  const topics = new Set<string>()

  for (const chunk of chunks) {
    const text = chunk.chunk_text.toLowerCase()
    if (!topics.has('services') && (text.includes('service') || text.includes('offer') || text.includes('provide'))) {
      suggestions.push('What services do you offer?')
      topics.add('services')
    }
    if (!topics.has('hours') && (text.includes('hour') || text.includes('open') || text.includes('schedule'))) {
      suggestions.push('What are your hours?')
      topics.add('hours')
    }
    if (!topics.has('contact') && (text.includes('contact') || text.includes('phone') || text.includes('email') || text.includes('address'))) {
      suggestions.push('How can I contact you?')
      topics.add('contact')
    }
    if (!topics.has('pricing') && (text.includes('price') || text.includes('cost') || text.includes('rate') || text.includes('fee'))) {
      suggestions.push('What are your prices?')
      topics.add('pricing')
    }
    if (!topics.has('area') && (text.includes('area') || text.includes('serve') || text.includes('location') || text.includes('region'))) {
      suggestions.push('What areas do you serve?')
      topics.add('area')
    }
    if (suggestions.length >= 3) break
  }

  // Fallback if no heuristic matches
  if (suggestions.length === 0) {
    suggestions.push('Tell me about your business')
  }

  return suggestions.slice(0, 3)
}
```

---

## Feature 2: Embed Page

### `src/app/dashboard/embed/page.tsx`

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import EmbedClient from './embed-client'

export default async function EmbedPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase
    .from('sites')
    .select('site_key, url, crawl_status')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!site) {
    return (
      <div className="py-16 text-center">
        <h2 className="text-xl font-semibold mb-2">No chatbot yet</h2>
        <p className="text-zinc-500 mb-4">Set up your website first.</p>
        <a href="/dashboard/setup" className="text-indigo-600 hover:underline">Go to setup →</a>
      </div>
    )
  }

  return <EmbedClient siteKey={site.site_key} />
}
```

### `src/app/dashboard/embed/embed-client.tsx`

```tsx
'use client'

import { useState } from 'react'

const platforms = ['WordPress', 'Squarespace', 'Wix', 'Shopify', 'Webflow', 'HTML / Custom']

const platformInstructions: Record<string, string> = {
  WordPress: '1. Go to Appearance → Editor (or use a plugin like "Insert Headers and Footers")\n2. Paste the code before the closing </body> tag\n3. Save and publish',
  Squarespace: '1. Go to Settings → Advanced → Code Injection\n2. Paste the code in the "Footer" section\n3. Save',
  Wix: '1. Go to Settings → Custom Code\n2. Click "Add Code"\n3. Paste the code, set placement to "Body - end"\n4. Apply',
  Shopify: '1. Go to Online Store → Themes → Actions → Edit code\n2. Open theme.liquid\n3. Paste the code before </body>\n4. Save',
  Webflow: '1. Go to Project Settings → Custom Code\n2. Paste in the "Footer Code" section\n3. Publish your site',
  'HTML / Custom': '1. Open your HTML file\n2. Paste the code before the closing </body> tag\n3. Save and deploy',
}

export default function EmbedClient({ siteKey }: { siteKey: string }) {
  const [platform, setPlatform] = useState('HTML / Custom')
  const [copied, setCopied] = useState(false)

  const embedCode = `<!-- RubyCrawl Chat Widget -->
<script
  src="${window.location.origin}/rubycrawl-loader.js"
  data-site-key="${siteKey}"
  data-api-base="${window.location.origin}"
  async
></script>`

  const handleCopy = async () => {
    await navigator.clipboard.writeText(embedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const emailSubject = encodeURIComponent('Add RubyCrawl chatbot to our website')
  const emailBody = encodeURIComponent(`Hi,\n\nPlease add this chat widget to our website. Paste the following code before the closing </body> tag:\n\n${embedCode}\n\n${platformInstructions[platform] || ''}\n\nCSP Note: If the site uses a Content Security Policy, add:\nscript-src ${window.location.origin};\nconnect-src ${window.location.origin};\n\nThanks!`)

  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="text-2xl font-bold mb-2">Add to your website</h1>
      <p className="text-zinc-500 mb-6">Choose your platform and follow the instructions.</p>

      {/* Platform selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {platforms.map((p) => (
          <button
            key={p}
            onClick={() => setPlatform(p)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              platform === p
                ? 'bg-indigo-500 text-white'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Instructions */}
      <div className="mb-6 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800">
        <h3 className="font-medium mb-2">Instructions for {platform}</h3>
        <pre className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
          {platformInstructions[platform]}
        </pre>
      </div>

      {/* Embed code */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Embed code</label>
        <pre className="rounded-lg bg-zinc-900 p-4 text-sm text-green-400 overflow-x-auto">
          {embedCode}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          onClick={handleCopy}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
        >
          {copied ? '✓ Copied!' : 'Copy code'}
        </button>
        <a
          href={`mailto:?subject=${emailSubject}&body=${emailBody}`}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300"
        >
          Email to developer
        </a>
      </div>

      {/* CSP note */}
      <details className="text-sm text-zinc-500">
        <summary className="cursor-pointer hover:text-zinc-700">Content Security Policy (CSP) requirements</summary>
        <p className="mt-2">If your website uses a Content Security Policy, add these directives:</p>
        <code className="block mt-1 bg-zinc-100 p-2 rounded text-xs dark:bg-zinc-800">
          script-src {typeof window !== 'undefined' ? window.location.origin : 'https://your-app.com'}; connect-src {typeof window !== 'undefined' ? window.location.origin : 'https://your-app.com'};
        </code>
      </details>
    </div>
  )
}
```

---

## Feature 3: Leads Page

### `src/app/dashboard/leads/page.tsx`

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LeadsClient from './leads-client'

export default async function LeadsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!site) {
    return (
      <div className="py-16 text-center">
        <p className="text-zinc-500">Set up your chatbot first to start capturing leads.</p>
        <a href="/dashboard/setup" className="text-indigo-600 hover:underline mt-2 inline-block">Go to setup →</a>
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
```

### `src/app/dashboard/leads/leads-client.tsx`

```tsx
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
    else { setSortKey(key); setSortAsc(true) }
  }

  if (leads.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="text-4xl mb-4">📧</div>
        <h2 className="text-xl font-semibold mb-2">No leads yet</h2>
        <p className="text-zinc-500">Once your chatbot is live, visitor emails will appear here.</p>
      </div>
    )
  }

  return (
    <div className="py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Leads ({leads.length})</h1>
        <a href="/api/leads/export" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-600">
          Export CSV
        </a>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-800">
            <tr>
              <th className="px-4 py-3 text-left cursor-pointer hover:bg-zinc-100" onClick={() => handleSort('name')}>Name {sortKey === 'name' && (sortAsc ? '↑' : '↓')}</th>
              <th className="px-4 py-3 text-left cursor-pointer hover:bg-zinc-100" onClick={() => handleSort('email')}>Email {sortKey === 'email' && (sortAsc ? '↑' : '↓')}</th>
              <th className="px-4 py-3 text-left">Message</th>
              <th className="px-4 py-3 text-left">Source</th>
              <th className="px-4 py-3 text-left cursor-pointer hover:bg-zinc-100" onClick={() => handleSort('created_at')}>Date {sortKey === 'created_at' && (sortAsc ? '↑' : '↓')}</th>
              <th className="px-4 py-3 text-left">Chat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sorted.map((lead) => (
              <tr key={lead.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <td className="px-4 py-3">{lead.name || '—'}</td>
                <td className="px-4 py-3 font-mono text-xs">{lead.email}</td>
                <td className="px-4 py-3 max-w-[200px] truncate">{lead.message || '—'}</td>
                <td className="px-4 py-3 max-w-[150px] truncate text-zinc-500">{lead.source_page || '—'}</td>
                <td className="px-4 py-3 text-zinc-500">{new Date(lead.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  {lead.conversation_id ? (
                    <a href={`/dashboard/conversations/${lead.conversation_id}`} className="text-indigo-500 hover:underline">View</a>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

---

## Feature 4: Conversations Page

### `src/app/dashboard/conversations/page.tsx`

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function ConversationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase.from('sites').select('id').eq('user_id', user.id).maybeSingle()
  if (!site) {
    return <div className="py-16 text-center"><p className="text-zinc-500">Set up your chatbot first.</p></div>
  }

  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, visitor_id, message_count, last_message_at, created_at')
    .eq('site_id', site.id)
    .order('last_message_at', { ascending: false })

  if (!conversations || conversations.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="text-4xl mb-4">💬</div>
        <h2 className="text-xl font-semibold mb-2">No conversations yet</h2>
        <p className="text-zinc-500">Once your chatbot is live, you'll see every question visitors ask.</p>
      </div>
    )
  }

  return (
    <div className="py-8">
      <h1 className="text-2xl font-bold mb-6">Conversations ({conversations.length})</h1>
      <div className="space-y-2">
        {conversations.map((c) => (
          <Link key={c.id} href={`/dashboard/conversations/${c.id}`}
            className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <div>
              <p className="font-medium text-sm">{c.visitor_id}</p>
              <p className="text-xs text-zinc-500">{c.message_count} messages</p>
            </div>
            <p className="text-xs text-zinc-400">{new Date(c.last_message_at).toLocaleString()}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

### `src/app/dashboard/conversations/[id]/page.tsx`

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'

export default async function ConversationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase.from('sites').select('id').eq('user_id', user.id).maybeSingle()
  if (!site) notFound()

  const { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', id)
    .eq('site_id', site.id)
    .maybeSingle()

  if (!conversation) notFound()

  const messages = conversation.messages as Array<{ role: string; content: string }>

  return (
    <div className="py-8 mx-auto max-w-2xl">
      <Link href="/dashboard/conversations" className="text-sm text-zinc-500 hover:text-zinc-700 mb-4 inline-block">← Back to conversations</Link>
      <h1 className="text-xl font-bold mb-1">Conversation</h1>
      <p className="text-sm text-zinc-500 mb-6">{conversation.visitor_id} · {new Date(conversation.created_at).toLocaleString()}</p>
      <div className="space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
              msg.role === 'user' ? 'bg-indigo-500 text-white' : 'bg-zinc-100 dark:bg-zinc-800'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## Feature 5: Settings Page

### `src/app/dashboard/settings/page.tsx`

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SettingsClient from './settings-client'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase
    .from('sites')
    .select('id, url, site_key, calendly_url, google_maps_url, greeting_message, crawl_status')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!site) {
    return <div className="py-16 text-center"><p className="text-zinc-500">Set up your chatbot first.</p></div>
  }

  return <SettingsClient site={site} />
}
```

### `src/app/dashboard/settings/settings-client.tsx`

```tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Site {
  id: string; url: string; site_key: string; calendly_url: string | null
  google_maps_url: string | null; greeting_message: string | null; crawl_status: string
}

export default function SettingsClient({ site }: { site: Site }) {
  const [calendly, setCalendly] = useState(site.calendly_url || '')
  const [maps, setMaps] = useState(site.google_maps_url || '')
  const [greeting, setGreeting] = useState(site.greeting_message || 'Hi! How can I help you today?')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [siteKey, setSiteKey] = useState(site.site_key)
  const supabase = createClient()

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('sites').update({
      calendly_url: calendly.trim() || null,
      google_maps_url: maps.trim() || null,
      greeting_message: greeting.trim() || 'Hi! How can I help you today?',
    }).eq('id', site.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleRecrawl = async () => {
    if (!confirm('This will re-crawl your website. Your current chatbot will keep working during the process. Continue?')) return
    await fetch('/api/crawl/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: site.url }),
    })
    window.location.href = '/dashboard/setup'
  }

  const handleRotateKey = async () => {
    if (!confirm('This will generate a new site key. Your existing widget embed code will stop working. Continue?')) return
    const newKey = 'sk_' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('')
    await supabase.from('sites').update({ site_key: newKey }).eq('id', site.id)
    setSiteKey(newKey)
  }

  return (
    <div className="py-8 mx-auto max-w-xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-1">Calendly URL</label>
          <input value={calendly} onChange={e => setCalendly(e.target.value)} placeholder="https://calendly.com/you/30min"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Google Maps URL</label>
          <input value={maps} onChange={e => setMaps(e.target.value)} placeholder="https://maps.google.com/..."
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Greeting message</label>
          <textarea value={greeting} onChange={e => setGreeting(e.target.value)} rows={2}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <button onClick={handleSave} disabled={saving}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50">
          {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save settings'}
        </button>

        <hr className="border-zinc-200 dark:border-zinc-700" />

        <div>
          <label className="block text-sm font-medium mb-1">Site key</label>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-zinc-100 px-2 py-1 rounded dark:bg-zinc-800">{siteKey.slice(0, 8)}...{siteKey.slice(-4)}</code>
            <button onClick={handleRotateKey} className="text-xs text-red-500 hover:underline">Rotate key</button>
          </div>
        </div>

        <div>
          <button onClick={handleRecrawl} disabled={site.crawl_status !== 'ready'}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600">
            Re-crawl website
          </button>
        </div>
      </div>
    </div>
  )
}
```

---

## Feature 6: Main Dashboard with Metrics

### Replace `src/app/dashboard/page.tsx`

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: site } = await supabase
    .from('sites')
    .select('id, url, crawl_status, site_key')
    .eq('user_id', user.id)
    .maybeSingle()

  // Setup checklist state
  const hasSite = !!site && site.crawl_status === 'ready'
  const { count: convCount } = await supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('site_id', site?.id || '')
  const hasConversations = (convCount ?? 0) > 0

  if (!site) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Welcome to RubyCrawl</h1>
        <p className="text-zinc-500 mb-6">Let's get your AI chatbot set up.</p>
        <Link href="/dashboard/setup" className="rounded-lg bg-indigo-500 px-6 py-3 font-medium text-white hover:bg-indigo-600">
          Build your chatbot →
        </Link>
      </div>
    )
  }

  // Get metrics
  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, visitor_id, message_count, last_message_at, messages')
    .eq('site_id', site.id)
    .order('last_message_at', { ascending: false })
    .limit(5)

  const { count: totalConvos } = await supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('site_id', site.id)
  const { count: totalLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('site_id', site.id)

  const totalMessages = conversations?.reduce((sum, c) => sum + (c.message_count || 0), 0) || 0
  const uniqueVisitors = new Set(conversations?.map(c => c.visitor_id) || []).size

  return (
    <div className="py-8">
      {/* Setup checklist (collapses when all done) */}
      {(!hasSite || !hasConversations) && (
        <div className="mb-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <h3 className="font-medium mb-3">Getting started</h3>
          <div className="space-y-2">
            <ChecklistItem done={hasSite} label="Build your chatbot" href="/dashboard/setup" />
            <ChecklistItem done={hasSite} label="Add to your website" href="/dashboard/embed" />
            <ChecklistItem done={hasConversations} label="Test with a question" href="/dashboard/preview" />
          </div>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
        <MetricCard label="People your chatbot helped" value={uniqueVisitors} />
        <MetricCard label="Questions answered" value={totalMessages} />
        <MetricCard label="Leads captured" value={totalLeads ?? 0} />
      </div>

      {/* Recent conversations */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Recent conversations</h2>
        {conversations && conversations.length > 0 ? (
          <div className="space-y-2">
            {conversations.map((c) => (
              <Link key={c.id} href={`/dashboard/conversations/${c.id}`}
                className="flex justify-between items-center rounded-lg border border-zinc-200 p-3 text-sm hover:bg-zinc-50 dark:border-zinc-700"
              >
                <span>{c.visitor_id} · {c.message_count} messages</span>
                <span className="text-zinc-400 text-xs">{new Date(c.last_message_at).toLocaleString()}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-zinc-500 text-sm">No conversations yet. Once your chatbot is live, you'll see every question visitors ask.</p>
        )}
      </div>

      {/* Billing stub */}
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Subscription</p>
            <p className="text-sm text-zinc-500">$24.99/month</p>
          </div>
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">Active</span>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm text-zinc-500">{label}</p>
    </div>
  )
}

function ChecklistItem({ done, label, href }: { done: boolean; label: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-sm hover:underline">
      <span className={done ? 'text-green-500' : 'text-zinc-400'}>{done ? '✓' : '○'}</span>
      <span className={done ? 'text-zinc-500 line-through' : ''}>{label}</span>
    </Link>
  )
}
```

---

## Feature 7: Landing Page

### Replace `src/app/page.tsx`

```tsx
import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto">
        <span className="text-xl font-bold">RubyCrawl</span>
        <Link href="/login" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400">Sign in</Link>
      </nav>

      {/* Hero */}
      <section className="px-6 py-20 text-center max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl mb-6">
          An AI chatbot for your website in 3 minutes
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400 mb-8 max-w-xl mx-auto">
          Paste your website URL. We'll crawl it and give you an embeddable chatbot that knows everything about your business. Answer visitor questions, capture leads, and book appointments — 24/7.
        </p>
        <Link href="/login"
          className="inline-block rounded-lg bg-indigo-500 px-8 py-4 text-lg font-medium text-white hover:bg-indigo-600 transition-colors">
          Start free trial →
        </Link>
        <p className="mt-3 text-sm text-zinc-500">7-day free trial. No credit card required.</p>
      </section>

      {/* How it works */}
      <section className="px-6 py-16 bg-zinc-50 dark:bg-zinc-900">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-12">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            <Step num="1" title="Paste your URL" desc="Enter your website address. That's it." />
            <Step num="2" title="We crawl & train" desc="We read every page and train an AI chatbot on your content." />
            <Step num="3" title="Embed & go live" desc="Copy one line of code to your site. Your chatbot is live." />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 py-16 max-w-2xl mx-auto text-center">
        <h2 className="text-2xl font-bold mb-4">Simple pricing</h2>
        <div className="rounded-xl border border-zinc-200 p-8 dark:border-zinc-700">
          <p className="text-4xl font-bold mb-2">$24.99<span className="text-lg text-zinc-500 font-normal">/month</span></p>
          <p className="text-zinc-500 mb-6">Everything included. 7-day free trial.</p>
          <ul className="text-left text-sm space-y-2 mb-6 max-w-xs mx-auto">
            <li>✓ Crawl up to 100 pages</li>
            <li>✓ 500 chat messages/month</li>
            <li>✓ Lead capture</li>
            <li>✓ Calendly & Maps integration</li>
            <li>✓ Dashboard analytics</li>
            <li>✓ Embeddable widget</li>
          </ul>
          <Link href="/login" className="inline-block rounded-lg bg-indigo-500 px-6 py-3 font-medium text-white hover:bg-indigo-600">
            Start free trial
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 text-center text-sm text-zinc-400 border-t border-zinc-100 dark:border-zinc-800">
        <p>© 2026 RubyCrawl. All rights reserved.</p>
      </footer>
    </div>
  )
}

function Step({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <div className="text-center">
      <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 font-bold flex items-center justify-center mx-auto mb-3">{num}</div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-zinc-500">{desc}</p>
    </div>
  )
}
```

---

## Feature 8: Billing Stub Page

### `src/app/dashboard/billing/page.tsx`

```tsx
export default function BillingPage() {
  return (
    <div className="py-8 mx-auto max-w-xl">
      <h1 className="text-2xl font-bold mb-6">Billing</h1>
      <div className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-700">
        <div className="flex items-center justify-between mb-4">
          <p className="font-medium">Current plan</p>
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">Active</span>
        </div>
        <p className="text-3xl font-bold">$24.99<span className="text-sm text-zinc-500 font-normal">/month</span></p>
        <p className="text-sm text-zinc-500 mt-1">Your subscription is active. Stripe integration coming soon.</p>
      </div>
    </div>
  )
}
```

---

## Feature 9: Cross-Area Integration Verification

After building all the above, walk through these end-to-end flows and fix any broken links, missing imports, or state issues:

1. **Full onboarding**: `/` → click CTA → `/login` → enter email → "Check email" → (simulate auth) → `/dashboard` → click "Build chatbot" → `/dashboard/setup` → enter URL → watch progress → "Chatbot ready" → click "Preview" → `/dashboard/preview` → test chat → click "Add to website" → `/dashboard/embed` → copy code

2. **Widget → Dashboard data**: Open test-widget.html → send message → provide email → check `/dashboard/leads` shows the lead → check `/dashboard/conversations` shows the conversation

3. **Settings → Widget**: Save Calendly URL in settings → ask widget about booking → verify Calendly link in response

4. **All sidebar links work**: Click each nav item, verify page loads

5. **Auth gates**: In incognito, try to access each `/dashboard/*` URL directly — all should redirect to `/login`

6. **Empty states**: New user (no site) should see appropriate empty states on every dashboard page

---

## Verification Checklist

```bash
pnpm vitest run
pnpm run typecheck
pnpm run lint
```

- [ ] Landing page loads at / with hero, pricing, CTA
- [ ] Login flow works
- [ ] Dashboard shows metrics or empty states
- [ ] Setup checklist reflects actual state
- [ ] Preview page has suggested questions and working chat
- [ ] Embed page has platform selector and copy button
- [ ] Leads table with sorting and CSV export
- [ ] Conversations list and transcript view
- [ ] Settings: save Calendly/Maps/greeting, re-crawl, rotate key
- [ ] Billing stub shows Active
- [ ] All sidebar links work
- [ ] All pages redirect to /login when unauthenticated
- [ ] Widget chat creates conversations visible in dashboard
- [ ] Mobile responsive (test at 375px)
- [ ] Commit all changes
