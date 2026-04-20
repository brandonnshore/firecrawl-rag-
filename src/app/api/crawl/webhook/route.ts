import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { processCrawlData, markCrawlFailed } from '@/lib/crawl/process'
import type { CrawledPage } from '@/lib/crawl/process'
import Firecrawl from '@mendable/firecrawl-js'

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
  // Normalize Firecrawl event type names. Firecrawl v1 API used dotted
  // names ('crawl.completed', 'crawl.failed'); SDK v4 / API v2 uses
  // bare names ('completed', 'failed', 'page', 'started'). Strip the
  // optional 'crawl.' prefix so the handler works against both.
  const eventType = (payload.type ?? '').replace(/^crawl\./, '')

  // Live progress: Firecrawl fires one `page` event per scraped page
  // BEFORE the final `completed` event. Bump crawl_page_count so the
  // setup page can show a live counter instead of a frozen "0 pages"
  // all the way through. We don't persist anything else from the page
  // payload here — the authoritative page + markdown data is still
  // pulled in bulk via getCrawlStatus on the `completed` event.
  if (eventType === 'page') {
    after(async () => {
      try {
        const { data: current } = await supabase
          .from('sites')
          .select('crawl_page_count')
          .eq('id', siteId)
          .maybeSingle<{ crawl_page_count: number }>()
        const next = (current?.crawl_page_count ?? 0) + 1
        await supabase
          .from('sites')
          .update({ crawl_page_count: next, updated_at: new Date().toISOString() })
          .eq('id', siteId)
      } catch (err) {
        console.error('[webhook] page-event increment failed:', err)
      }
    })
    return Response.json({ received: true })
  }

  // Handle different event types
  if (eventType === 'failed') {
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

  if (eventType === 'completed') {
    // The webhook payload may or may not include page data — Firecrawl
    // doesn't guarantee it.  Always fetch results via checkCrawlStatus
    // to get the full dataset reliably.
    console.log(
      `[webhook] crawl.completed for site ${siteId}, job ${crawlJobId}. Fetching results via API.`
    )

    after(async () => {
      try {
        console.log(`[webhook] after() running for site ${siteId}, job ${crawlJobId}`)

        if (!process.env.FIRECRAWL_API_KEY) {
          throw new Error('FIRECRAWL_API_KEY env var is missing')
        }

        const firecrawl = new Firecrawl({
          apiKey: process.env.FIRECRAWL_API_KEY,
        })

        console.log(`[webhook] Calling getCrawlStatus for job ${crawlJobId}`)
        const result = await firecrawl.getCrawlStatus(crawlJobId)

        console.log(
          `[webhook] getCrawlStatus response: status=${result.status}, total=${result.total}, completed=${result.completed}, dataLength=${result.data?.length ?? 'undefined'}`
        )

        // Log the shape of the first page to verify field mapping
        if (result.data && result.data.length > 0) {
          const first = result.data[0] as Record<string, unknown>
          console.log(
            `[webhook] First page keys: ${Object.keys(first).join(', ')}`
          )
          console.log(
            `[webhook] First page markdown length: ${(first.markdown as string)?.length ?? 'undefined'}`
          )
          const meta = first.metadata as Record<string, unknown> | undefined
          if (meta) {
            console.log(
              `[webhook] First page metadata keys: ${Object.keys(meta).join(', ')}`
            )
            console.log(
              `[webhook] First page sourceURL: ${meta.sourceURL ?? meta.url ?? 'not found'}`
            )
          }
        }

        const pages: CrawledPage[] = (result.data ?? []).map((doc) => {
          const d = doc as Record<string, unknown>
          const meta = d.metadata as Record<string, unknown> | undefined
          return {
            markdown: (d.markdown as string) ?? undefined,
            metadata: {
              title: (meta?.title as string) ?? undefined,
              sourceURL:
                (meta?.sourceURL as string) ??
                (meta?.url as string) ??
                undefined,
              statusCode: (meta?.statusCode as number) ?? undefined,
            },
          }
        })

        const totalChars = pages.reduce(
          (n, p) => n + (p.markdown?.length ?? 0),
          0
        )
        console.log(
          `[webhook] Mapped ${pages.length} pages, ${totalChars} chars for site ${siteId}`
        )

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
