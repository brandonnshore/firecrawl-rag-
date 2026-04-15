import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { processCrawlData, markCrawlFailed } from '@/lib/crawl/process'
import type { CrawledPage } from '@/lib/crawl/process'

/**
 * Webhook payload shape from Firecrawl
 */
interface FirecrawlWebhookPayload {
  success: boolean
  type: string // 'crawl.started' | 'crawl.page' | 'crawl.completed' | 'crawl.failed'
  id: string // crawl job ID
  data?: CrawledPage[]
  metadata?: {
    site_id?: string
    user_id?: string
  }
  error?: string | null
}

export const maxDuration = 300 // 5 minutes for background processing

export async function POST(request: Request) {
  // Parse the webhook payload
  let payload: FirecrawlWebhookPayload
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const crawlJobId = payload.id
  if (!crawlJobId || typeof crawlJobId !== 'string') {
    return Response.json({ error: 'Missing crawl job ID' }, { status: 400 })
  }

  // Validate crawl_job_id matches a site in 'crawling' status
  const supabase = createServiceClient()

  const { data: site } = await supabase
    .from('sites')
    .select('id, crawl_status')
    .eq('crawl_job_id', crawlJobId)
    .maybeSingle()

  // Return 200 immediately even for fabricated IDs (prevents probing)
  // but don't process anything
  if (!site || site.crawl_status !== 'crawling') {
    return Response.json({ received: true })
  }

  const siteId = site.id
  const eventType = payload.type

  // Handle different event types
  if (eventType === 'crawl.failed') {
    const errorMsg = payload.error ?? 'Crawl failed for unknown reason'

    after(async () => {
      try {
        await markCrawlFailed(siteId, errorMsg)
      } catch (err) {
        console.error('[webhook] Failed to mark crawl as failed:', err)
      }
    })

    return Response.json({ received: true })
  }

  if (eventType === 'crawl.completed') {
    const pages = payload.data ?? []

    after(async () => {
      try {
        await processCrawlData(siteId, pages)
      } catch (err) {
        console.error('[webhook] Processing failed:', err)
        const errorMessage =
          err instanceof Error ? err.message : 'Processing failed'
        await markCrawlFailed(siteId, errorMessage).catch((e) =>
          console.error('[webhook] Failed to mark as failed:', e)
        )
      }
    })

    return Response.json({ received: true })
  }

  // For other event types (crawl.started, crawl.page), just acknowledge
  return Response.json({ received: true })
}
