'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  IconArrowRight,
  IconCheck,
  IconMail,
  IconSpinner,
} from '@/components/icons'

export default function ContactPage() {
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const form = e.currentTarget
    const fd = new FormData(form)
    const payload = {
      name: String(fd.get('name') ?? '').trim(),
      email: String(fd.get('email') ?? '').trim(),
      website: String(fd.get('website') ?? '').trim(),
      message: String(fd.get('message') ?? '').trim(),
      // Honeypot. Real humans leave this blank; bots fill it.
      hp: String(fd.get('hp') ?? ''),
    }
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      setDone(true)
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-[100dvh] bg-[color:var(--bg-canvas)] px-6 py-20 text-[color:var(--ink-primary)]">
        <div className="mx-auto max-w-md rc-enter">
          <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--accent-success)]/30 bg-[color:var(--accent-success-bg)] text-[color:var(--accent-success)]">
            <IconCheck width={18} height={18} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Got it — we&apos;ll be in touch.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
            Brandon will reply within one business day with next steps. We
            usually need a quick 15-minute call to understand your site, then
            we set everything up and send you a link to go live.
          </p>
          <Link
            href="/"
            className="btn-press focus-ring mt-8 inline-flex items-center gap-2 text-sm font-medium text-[color:var(--ink-secondary)] hover:text-[color:var(--ink-primary)]"
          >
            <IconArrowRight width={14} height={14} className="rotate-180" />
            <span>Back to home</span>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-[color:var(--bg-canvas)] px-6 py-20 text-[color:var(--ink-primary)]">
      <div className="mx-auto max-w-xl rc-enter">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-tertiary)]">
          Done-for-you setup
        </p>
        <h1 className="mt-3 text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-tight">
          Tell us about your site.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
          We&apos;ll read the form, come back with any questions, and set
          everything up for you in under 24 hours. No setup fee — you just
          pay the monthly plan once it&apos;s live.
        </p>

        <form onSubmit={handleSubmit} className="mt-10 space-y-5">
          <Field label="Your name" name="name" required autoComplete="name" />
          <Field
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
          />
          <Field
            label="Website"
            name="website"
            type="text"
            placeholder="yourbusiness.com"
          />
          <div>
            <label
              htmlFor="message"
              className="mb-1.5 block text-xs font-medium tracking-tight text-[color:var(--ink-secondary)]"
            >
              Anything we should know?
            </label>
            <textarea
              id="message"
              name="message"
              rows={5}
              placeholder="Pages to prioritize, topics to avoid, a phone number to call you at…"
              className="focus-ring block w-full rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3.5 py-2.5 text-[15px] text-[color:var(--ink-primary)] placeholder:text-[color:var(--ink-tertiary)]"
            />
          </div>

          {/* Honeypot — positioned off-screen so real users never see it. */}
          <div aria-hidden className="absolute left-[-9999px] top-[-9999px]">
            <label>
              Leave this blank
              <input type="text" name="hp" tabIndex={-1} autoComplete="off" />
            </label>
          </div>

          {error && (
            <p role="alert" className="text-sm text-[color:var(--accent-danger)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn-press focus-ring group inline-flex items-center gap-2 rounded-full bg-[color:var(--ink-primary)] px-5 py-3 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <IconSpinner width={14} height={14} />
                <span>Sending…</span>
              </>
            ) : (
              <>
                <IconMail width={14} height={14} />
                <span>Send request</span>
                <IconArrowRight
                  width={14}
                  height={14}
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </>
            )}
          </button>
        </form>

        <p className="mt-8 text-xs text-[color:var(--ink-tertiary)]">
          Prefer email?{' '}
          <a
            href="mailto:brandon@rubyadvisory.com?subject=RubyCrawl done-for-you setup"
            className="underline underline-offset-2 hover:text-[color:var(--ink-primary)]"
          >
            brandon@rubyadvisory.com
          </a>
        </p>
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  name: string
  type?: string
  required?: boolean
  autoComplete?: string
  placeholder?: string
}

function Field({
  label,
  name,
  type = 'text',
  required,
  autoComplete,
  placeholder,
}: FieldProps) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-1.5 block text-xs font-medium tracking-tight text-[color:var(--ink-secondary)]"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="focus-ring block w-full rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3.5 py-2.5 text-[15px] text-[color:var(--ink-primary)] placeholder:text-[color:var(--ink-tertiary)]"
      />
    </div>
  )
}
