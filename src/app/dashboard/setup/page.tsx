'use client'

import { createClient } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mb-6 text-6xl">🎉</div>
        <h1 className="mb-4 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
          Your chatbot is ready!
        </h1>
        <p className="mb-8 text-zinc-600 dark:text-zinc-400">
          We crawled {pageCount} pages and trained your chatbot on your website content.
        </p>
        <button
          onClick={() => router.push('/dashboard/preview')}
          className="rounded-lg bg-zinc-900 px-6 py-3 font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Preview your chatbot →
        </button>
      </div>
    )
  }

  if (crawlStatus === 'failed') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mb-6 text-6xl">😞</div>
        <h1 className="mb-4 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Something went wrong
        </h1>
        <p className="mb-4 text-zinc-600 dark:text-zinc-400">
          {errorMessage || 'The crawl failed. Please try again.'}
        </p>
        {error && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <button
          onClick={handleRetry}
          className="rounded-lg bg-zinc-900 px-6 py-3 font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Try again
        </button>
      </div>
    )
  }

  if (crawlStatus === 'crawling' || crawlStatus === 'indexing') {
    return (
      <div className="mx-auto max-w-lg py-16">
        <h1 className="mb-8 text-center text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Building your chatbot...
        </h1>
        <div className="space-y-4">
          <ProgressStep label="Website found" done={true} />
          <ProgressStep
            label={
              pageCount > 0
                ? `Reading your pages... (Found ${pageCount} pages)`
                : 'Reading your pages...'
            }
            done={crawlStatus === 'indexing'}
            active={crawlStatus === 'crawling'}
          />
          <ProgressStep
            label="Training on your content..."
            done={false}
            active={crawlStatus === 'indexing'}
          />
          <ProgressStep label="Chatbot ready!" done={false} />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="mb-2 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
        Your AI chatbot is 3 minutes away
      </h1>
      <p className="mb-8 text-zinc-600 dark:text-zinc-400">
        Paste your website URL and we&apos;ll build a chatbot that knows everything
        about your business.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://yourbusiness.com"
          required
          className="block w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-zinc-900 px-6 py-3 font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {loading ? 'Starting...' : 'Build my chatbot'}
        </button>
      </form>
    </div>
  )
}

function ProgressStep({
  label,
  done,
  active,
}: {
  label: string
  done: boolean
  active?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
          done
            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
            : active
              ? 'bg-zinc-200 text-zinc-700 animate-pulse dark:bg-zinc-700 dark:text-zinc-300'
              : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600'
        }`}
      >
        {done ? '✓' : active ? '...' : '○'}
      </div>
      <span
        className={`text-sm ${
          done
            ? 'text-green-700 dark:text-green-300'
            : active
              ? 'text-zinc-900 font-medium dark:text-zinc-100'
              : 'text-zinc-400 dark:text-zinc-600'
        }`}
      >
        {label}
      </span>
    </div>
  )
}
