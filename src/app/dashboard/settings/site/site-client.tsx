'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { IconCheck, IconSpinner } from '@/components/icons'

interface Site {
  id: string
  url: string
  site_key: string
  calendly_url: string | null
  google_maps_url: string | null
  greeting_message: string | null
  crawl_status: string
}

export default function SiteClient({ site }: { site: Site }) {
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
        'Re-crawl your website? Your current chatbot keeps working during the new crawl.'
      )
    )
      return
    await fetch('/api/crawl/retry', { method: 'POST' })
    window.location.href = '/dashboard/setup'
  }

  const handleRotateKey = async () => {
    if (
      !confirm(
        'Generate a new site key? Your existing embed code will stop working until you update it on your site.'
      )
    )
      return
    const res = await fetch('/api/sites/rotate-key', { method: 'POST' })
    if (!res.ok) {
      alert('Failed to rotate key — please try again.')
      return
    }
    const body = (await res.json()) as { site_key?: string }
    if (body.site_key) setSiteKey(body.site_key)
  }

  return (
    <div className="rc-enter">
      <header className="mb-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Site
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Tune your chatbot.
        </h1>
      </header>

      <section className="space-y-6">
        <h2 className="border-b border-[color:var(--border-hairline)] pb-2 text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--ink-tertiary)]">
          Integrations
        </h2>

        <Field
          label="Calendly URL"
          hint="Shared when visitors ask to book a call or meeting."
        >
          <input
            value={calendly}
            onChange={(e) => setCalendly(e.target.value)}
            placeholder="https://calendly.com/you/30min"
            className="focus-ring block w-full rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-[14px] text-[color:var(--ink-primary)] placeholder:text-[color:var(--ink-tertiary)]"
          />
        </Field>

        <Field
          label="Google Maps URL"
          hint="Shared when visitors ask for directions or location."
        >
          <input
            value={maps}
            onChange={(e) => setMaps(e.target.value)}
            placeholder="https://maps.google.com/…"
            className="focus-ring block w-full rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-[14px] text-[color:var(--ink-primary)] placeholder:text-[color:var(--ink-tertiary)]"
          />
        </Field>

        <Field
          label="Greeting"
          hint="The first message visitors see when they open the chat."
        >
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={2}
            className="focus-ring block w-full resize-none rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-[14px] text-[color:var(--ink-primary)] placeholder:text-[color:var(--ink-tertiary)]"
          />
        </Field>

        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-press focus-ring inline-flex items-center gap-2 rounded-lg bg-[color:var(--ink-primary)] px-4 py-2 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? (
            <>
              <IconSpinner width={13} height={13} />
              <span>Saving…</span>
            </>
          ) : saved ? (
            <>
              <IconCheck width={13} height={13} />
              <span>Saved</span>
            </>
          ) : (
            <span>Save settings</span>
          )}
        </button>
      </section>

      <section className="mt-12 space-y-6">
        <h2 className="border-b border-[color:var(--border-hairline)] pb-2 text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--ink-tertiary)]">
          Advanced
        </h2>

        <Field
          label="Site key"
          hint="Embedded in your widget script. Rotating invalidates the current embed."
        >
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-inset)] px-3 py-2 font-mono text-xs text-[color:var(--ink-primary)]">
              {siteKey.slice(0, 10)}…{siteKey.slice(-6)}
            </code>
            <button
              onClick={handleRotateKey}
              className="btn-press focus-ring rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-xs font-medium text-[color:var(--accent-danger)] hover:border-[color:var(--accent-danger)]/30"
            >
              Rotate key
            </button>
          </div>
        </Field>

        <Field
          label="Re-crawl website"
          hint="Pulls your site again. The current chatbot keeps answering while the new index is built."
        >
          <button
            onClick={handleRecrawl}
            disabled={site.crawl_status !== 'ready'}
            className="btn-press focus-ring rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-4 py-2 text-sm font-medium text-[color:var(--ink-primary)] hover:bg-[color:var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start a new crawl
          </button>
        </Field>
      </section>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium tracking-tight text-[color:var(--ink-secondary)]">
        {label}
      </label>
      {children}
      {hint && (
        <p className="mt-1.5 text-xs text-[color:var(--ink-tertiary)]">
          {hint}
        </p>
      )}
    </div>
  )
}
