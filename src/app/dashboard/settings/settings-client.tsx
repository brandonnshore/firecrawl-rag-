'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Site {
  id: string
  url: string
  site_key: string
  calendly_url: string | null
  google_maps_url: string | null
  greeting_message: string | null
  crawl_status: string
}

export default function SettingsClient({ site }: { site: Site }) {
  const [calendly, setCalendly] = useState(site.calendly_url || '')
  const [maps, setMaps] = useState(site.google_maps_url || '')
  const [greeting, setGreeting] = useState(
    site.greeting_message || 'Hi! How can I help you today?'
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [siteKey, setSiteKey] = useState(site.site_key)
  const supabase = createClient()

  const handleSave = async () => {
    setSaving(true)
    await supabase
      .from('sites')
      .update({
        calendly_url: calendly.trim() || null,
        google_maps_url: maps.trim() || null,
        greeting_message:
          greeting.trim() || 'Hi! How can I help you today?',
      })
      .eq('id', site.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleRecrawl = async () => {
    if (
      !confirm(
        'This will re-crawl your website. Your current chatbot will keep working during the process. Continue?'
      )
    )
      return
    await fetch('/api/crawl/retry', { method: 'POST' })
    window.location.href = '/dashboard/setup'
  }

  const handleRotateKey = async () => {
    if (
      !confirm(
        'This will generate a new site key. Your existing widget embed code will stop working. Continue?'
      )
    )
      return
    const newKey =
      'sk_' +
      Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    await supabase.from('sites').update({ site_key: newKey }).eq('id', site.id)
    setSiteKey(newKey)
  }

  return (
    <div className="mx-auto max-w-xl py-8">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>
      <div className="space-y-6">
        <div>
          <label className="mb-1 block text-sm font-medium">Calendly URL</label>
          <input
            value={calendly}
            onChange={(e) => setCalendly(e.target.value)}
            placeholder="https://calendly.com/you/30min"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            Google Maps URL
          </label>
          <input
            value={maps}
            onChange={(e) => setMaps(e.target.value)}
            placeholder="https://maps.google.com/..."
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            Greeting message
          </label>
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
        >
          {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save settings'}
        </button>

        <hr className="border-zinc-200 dark:border-zinc-700" />

        <div>
          <label className="mb-1 block text-sm font-medium">Site key</label>
          <div className="flex items-center gap-2">
            <code className="rounded bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
              {siteKey.slice(0, 8)}...{siteKey.slice(-4)}
            </code>
            <button
              onClick={handleRotateKey}
              className="text-xs text-red-500 hover:underline"
            >
              Rotate key
            </button>
          </div>
        </div>

        <div>
          <button
            onClick={handleRecrawl}
            disabled={site.crawl_status !== 'ready'}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600"
          >
            Re-crawl website
          </button>
        </div>
      </div>
    </div>
  )
}
