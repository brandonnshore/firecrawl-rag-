import { createClient } from '@/lib/supabase/server'
import { checkSubscription } from '@/lib/subscription'
import { validateCrawlUrl } from '@/lib/crawl/validate-url'
import Firecrawl from '@mendable/firecrawl-js'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const subscription = await checkSubscription(user.id)
  if (!subscription.active) {
    return Response.json(
      { error: 'Active subscription required' },
      { status: 403 }
    )
  }

  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('id, url, crawl_status')
    .eq('user_id', user.id)
    .maybeSingle()

  if (siteError || !site) {
    return Response.json({ error: 'No site found' }, { status: 404 })
  }

  if (site.crawl_status === 'crawling' || site.crawl_status === 'indexing') {
    return Response.json(
      { error: 'Crawl already in progress' },
      { status: 409 }
    )
  }

  // Normalize the stored URL so retries always crawl the root — even
  // if the site was originally created with a subpage URL before the
  // start endpoint started normalizing.
  const normalization = validateCrawlUrl(site.url)
  const crawlUrl = normalization.normalizedUrl ?? site.url

  const { error: resetError } = await supabase
    .from('sites')
    .update({
      url: crawlUrl,
      crawl_status: 'crawling',
      crawl_error_message: null,
      crawl_page_count: 0,
      crawl_job_id: null,
    })
    .eq('id', site.id)

  if (resetError) {
    return Response.json({ error: 'Failed to reset site' }, { status: 500 })
  }

  const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! })

  let crawlJobId: string
  try {
    const crawlResult = await firecrawl.startCrawl(crawlUrl, {
      limit: 100,
      maxDiscoveryDepth: 5,
      crawlEntireDomain: true,
      sitemap: 'include',
      excludePaths: ['/sitemap.xml', '/robots.txt', '/404', '/cart', '/checkout'],
      scrapeOptions: {
        formats: ['markdown'],
        waitFor: 2000,
      },
      webhook: {
        url: `${process.env.NEXT_PUBLIC_APP_URL}/api/crawl/webhook`,
        events: ['page', 'completed', 'failed'],
        metadata: {
          site_id: site.id,
          user_id: user.id,
        },
      },
    })

    if (!crawlResult.id) {
      await supabase
        .from('sites')
        .update({
          crawl_status: 'failed',
          crawl_error_message: 'Failed to start crawl with Firecrawl',
        })
        .eq('id', site.id)

      return Response.json(
        { error: 'Failed to start website crawl' },
        { status: 502 }
      )
    }

    crawlJobId = crawlResult.id
  } catch (err) {
    await supabase
      .from('sites')
      .update({
        crawl_status: 'failed',
        crawl_error_message:
          err instanceof Error ? err.message : 'Failed to start crawl',
      })
      .eq('id', site.id)

    return Response.json(
      { error: 'Failed to start website crawl' },
      { status: 502 }
    )
  }

  await supabase
    .from('sites')
    .update({ crawl_job_id: crawlJobId })
    .eq('id', site.id)

  return Response.json({
    site_id: site.id,
    crawl_job_id: crawlJobId,
    crawl_status: 'crawling',
  })
}
