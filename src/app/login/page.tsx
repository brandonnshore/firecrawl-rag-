'use client'

import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import Link from 'next/link'
import { IconArrowRight, IconMail, IconSpinner } from '@/components/icons'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setLoading(false)

    if (signInError) {
      setError('Something went wrong. Please try again.')
      return
    }

    setSubmitted(true)
  }

  return (
    <div className="relative grid min-h-[100dvh] grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      {/* Left: brand side — editorial type, quiet texture */}
      <aside className="relative hidden overflow-hidden border-r border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-12 py-10 lg:flex lg:flex-col lg:justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium tracking-tight text-[color:var(--ink-primary)]"
        >
          <span className="text-lg">RubyCrawl</span>
        </Link>

        <div className="max-w-md">
          <p className="mb-6 inline-block rounded-full border border-[color:var(--border-hairline)] bg-[color:var(--bg-canvas)] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-[color:var(--ink-secondary)]">
            An AI chatbot in 3 minutes
          </p>
          <h1 className="text-[2.75rem] font-semibold leading-[1.05] tracking-tight text-[color:var(--ink-primary)]">
            Your website,
            <br />
            <span className="text-[color:var(--ink-secondary)]">
              answering back.
            </span>
          </h1>
          <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
            Paste a URL. We crawl every page, train a chatbot on your content,
            and give you one line of code to embed. Built for small
            businesses — not enterprises with six figures for a custom build.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6 text-sm">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-tertiary)]">
              Trains on
            </dt>
            <dd className="mt-1 font-medium">Your site</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-tertiary)]">
              Goes live in
            </dt>
            <dd className="mt-1 font-medium">~3 minutes</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-tertiary)]">
              Price
            </dt>
            <dd className="mt-1 font-medium">$24.99/mo</dd>
          </div>
        </dl>
      </aside>

      {/* Right: form */}
      <main className="flex items-center justify-center px-6 py-16 lg:px-12">
        <div className="w-full max-w-sm rc-enter">
          {submitted ? (
            <div>
              <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] text-[color:var(--ink-primary)]">
                <IconMail width={18} height={18} />
              </div>
              <h2 className="mb-2 text-2xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
                Check your email
              </h2>
              <p className="text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
                We sent a magic link to{' '}
                <span className="font-medium text-[color:var(--ink-primary)]">
                  {email}
                </span>
                . The link opens in a new tab and signs you in instantly.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSubmitted(false)
                  setEmail('')
                }}
                className="btn-press focus-ring mt-8 text-sm font-medium text-[color:var(--ink-secondary)] underline-offset-4 hover:text-[color:var(--ink-primary)] hover:underline"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <h2 className="mb-2 text-2xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
                Sign in
              </h2>
              <p className="mb-8 text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
                Enter your email. We&apos;ll send you a magic link — no
                passwords.
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-xs font-medium tracking-tight text-[color:var(--ink-secondary)]"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="focus-ring block w-full rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3.5 py-2.5 text-[15px] text-[color:var(--ink-primary)] placeholder:text-[color:var(--ink-tertiary)]"
                  />
                </div>

                {error && (
                  <p
                    role="alert"
                    className="text-sm text-[color:var(--accent-danger)]"
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-press focus-ring group flex w-full items-center justify-between rounded-lg bg-[color:var(--ink-primary)] px-4 py-2.5 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>{loading ? 'Sending link…' : 'Send magic link'}</span>
                  {loading ? (
                    <IconSpinner width={16} height={16} />
                  ) : (
                    <IconArrowRight
                      width={16}
                      height={16}
                      className="transition-transform duration-200 group-hover:translate-x-0.5"
                    />
                  )}
                </button>
              </form>

              <p className="mt-8 text-xs text-[color:var(--ink-tertiary)]">
                By signing in you agree to RubyCrawl&apos;s terms. One site per
                account.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
