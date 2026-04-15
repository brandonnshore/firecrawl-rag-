'use client'

import { createClient } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  IconArrowRight,
  IconCheck,
  IconAlert,
  IconSparkle,
  IconSpinner,
} from '@/components/icons'

type CrawlStatus = 'idle' | 'crawling' | 'indexing' | 'ready' | 'failed'

export default function SetupPage() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [crawlStatus, setCrawlStatus] = useState<CrawlStatus>('idle')
  const [siteId, setSiteId] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function checkExistingSite() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data: site } = await supabase
        .from('sites')
        .select('id, crawl_status, crawl_page_count, crawl_error_message')
        .eq('user_id', user.id)
        .maybeSingle()

      if (site) {
        setSiteId(site.id)
        setCrawlStatus(site.crawl_status as CrawlStatus)
        setPageCount(site.crawl_page_count ?? 0)
        if (site.crawl_error_message) {
          setErrorMessage(site.crawl_error_message)
        }
      }
    }
    checkExistingSite()
  }, [supabase])

  useEffect(() => {
    if (!siteId) return

    const channel = supabase
      .channel(`site-${siteId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sites',
          filter: `id=eq.${siteId}`,
        },
        (payload) => {
          const newRecord = payload.new as {
            crawl_status: string
            crawl_page_count: number
            crawl_error_message: string | null
          }
          setCrawlStatus(newRecord.crawl_status as CrawlStatus)
          setPageCount(newRecord.crawl_page_count ?? 0)
          if (newRecord.crawl_error_message) {
            setErrorMessage(newRecord.crawl_error_message)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [siteId, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setErrorMessage(null)

    try {
      const res = await fetch('/api/crawl/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to start crawl')
        setLoading(false)
        return
      }
      setSiteId(data.site_id)
      setCrawlStatus('crawling')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleRetry = async () => {
    setError(null)
    setErrorMessage(null)
    setCrawlStatus('idle')
    try {
      const res = await fetch('/api/crawl/retry', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to retry crawl')
        return
      }
      setCrawlStatus('crawling')
    } catch {
      setError('Network error. Please try again.')
    }
  }

  if (crawlStatus === 'ready') {
    return (
      <div className="mx-auto max-w-xl py-16 rc-enter">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--accent-success)]">
          Crawl complete
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Your chatbot
          <br />
          is ready.
        </h1>
        <p className="mt-6 text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
          We read{' '}
          <span className="font-mono text-[color:var(--ink-primary)]">
            {pageCount}
          </span>{' '}
          {pageCount === 1 ? 'page' : 'pages'} and trained the chatbot on your
          content. Try it, then embed it.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <button
            onClick={() => router.push('/dashboard/preview')}
            className="btn-press focus-ring group inline-flex items-center gap-2 rounded-lg bg-[color:var(--ink-primary)] px-5 py-2.5 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)]"
          >
            <span>Preview your chatbot</span>
            <IconArrowRight
              width={14}
              height={14}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </button>
          <button
            onClick={() => router.push('/dashboard/embed')}
            className="btn-press focus-ring rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-surface)] px-5 py-2.5 text-sm font-medium text-[color:var(--ink-primary)] hover:bg-[color:var(--bg-subtle)]"
          >
            Embed it
          </button>
        </div>
      </div>
    )
  }

  if (crawlStatus === 'failed') {
    return (
      <div className="mx-auto max-w-xl py-16 rc-enter">
        <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--accent-danger)]/30 bg-[color:var(--accent-danger-bg)] text-[color:var(--accent-danger)]">
          <IconAlert width={18} height={18} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Crawl didn&apos;t finish.
        </h1>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
          {errorMessage ||
            'Something went wrong while reading your site. You can try again.'}
        </p>
        {error && (
          <p className="mt-3 text-sm text-[color:var(--accent-danger)]">
            {error}
          </p>
        )}
        <button
          onClick={handleRetry}
          className="btn-press focus-ring mt-8 inline-flex items-center gap-2 rounded-lg bg-[color:var(--ink-primary)] px-5 py-2.5 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)]"
        >
          Try again
        </button>
      </div>
    )
  }

  if (crawlStatus === 'crawling' || crawlStatus === 'indexing') {
    return (
      <div className="mx-auto max-w-xl py-16 rc-enter">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          In progress
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Building your chatbot.
        </h1>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
          This usually takes 2–3 minutes. You can safely leave this
          page — we&apos;ll keep working.
        </p>

        <ol className="mt-10 space-y-0">
          <StepRow label="Website found" state="done" />
          <StepRow
            label={
              pageCount > 0
                ? `Reading your pages · ${pageCount} so far`
                : 'Reading your pages'
            }
            state={crawlStatus === 'crawling' ? 'active' : 'done'}
          />
          <StepRow
            label="Training on your content"
            state={
              crawlStatus === 'indexing'
                ? 'active'
                : crawlStatus === 'crawling'
                  ? 'pending'
                  : 'done'
            }
          />
          <StepRow label="Chatbot ready" state="pending" />
        </ol>
      </div>
    )
  }

  // Default: URL input form
  return (
    <div className="mx-auto max-w-xl py-16 rc-enter">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
        Step 1 · Paste a URL
      </p>
      <h1 className="mt-3 text-4xl font-semibold leading-[1.05] tracking-tight text-[color:var(--ink-primary)] md:text-5xl">
        Your AI chatbot
        <br />
        is 3 minutes away.
      </h1>
      <p className="mt-6 max-w-md text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
        We crawl every page, embed the content, and hand you a chatbot that
        knows your business.
      </p>

      <form onSubmit={handleSubmit} className="mt-10 space-y-4">
        <div>
          <label
            htmlFor="url"
            className="mb-1.5 block text-xs font-medium tracking-tight text-[color:var(--ink-secondary)]"
          >
            Website URL
          </label>
          <input
            id="url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourbusiness.com"
            required
            className="focus-ring block w-full rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3.5 py-2.5 text-[15px] text-[color:var(--ink-primary)] placeholder:text-[color:var(--ink-tertiary)]"
          />
          <p className="mt-1.5 text-xs text-[color:var(--ink-tertiary)]">
            Must be public and reachable. We crawl up to 100 pages.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-[color:var(--accent-danger)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-press focus-ring group inline-flex items-center gap-2 rounded-lg bg-[color:var(--ink-primary)] px-5 py-2.5 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <>
              <IconSpinner width={14} height={14} />
              <span>Starting crawl…</span>
            </>
          ) : (
            <>
              <IconSparkle width={14} height={14} />
              <span>Build my chatbot</span>
              <IconArrowRight
                width={14}
                height={14}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </>
          )}
        </button>
      </form>
    </div>
  )
}

function StepRow({
  label,
  state,
}: {
  label: string
  state: 'pending' | 'active' | 'done'
}) {
  return (
    <li className="flex items-center gap-3 border-t border-[color:var(--border-hairline)] py-3 first:border-t-0">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border ${
          state === 'done'
            ? 'border-[color:var(--accent-success)] bg-[color:var(--accent-success-bg)] text-[color:var(--accent-success)]'
            : state === 'active'
              ? 'border-[color:var(--ink-primary)] text-[color:var(--ink-primary)]'
              : 'border-[color:var(--border-strong)] text-[color:var(--ink-tertiary)]'
        }`}
      >
        {state === 'done' ? (
          <IconCheck width={11} height={11} />
        ) : state === 'active' ? (
          <span className="h-1.5 w-1.5 rounded-full bg-current rc-pulse" />
        ) : null}
      </span>
      <span
        className={`text-sm ${
          state === 'active'
            ? 'font-medium text-[color:var(--ink-primary)]'
            : state === 'done'
              ? 'text-[color:var(--ink-secondary)]'
              : 'text-[color:var(--ink-tertiary)]'
        }`}
      >
        {label}
      </span>
    </li>
  )
}
