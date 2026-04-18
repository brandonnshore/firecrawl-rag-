import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { checkSubscription } from '@/lib/subscription'
import { validateCrawlUrl } from '@/lib/crawl/validate-url'
import Firecrawl from '@mendable/firecrawl-js'
import crypto from 'crypto'

const STARTER_CRAWL_PAGES_LIMIT_FALLBACK = 500

async function checkCrawlQuota(
  supabase: SupabaseClient,
  userId: string
): Promise<{ allowed: true } | { allowed: false; used: number; limit: number }> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan_id')
    .eq('id', userId)
    .maybeSingle<{ plan_id: string | null }>()

  const { data: plan } = profile?.plan_id
    ? await supabase
        .from('plans')
        .select('id, monthly_crawl_page_limit')
        .eq('id', profile.plan_id)
        .maybeSingle<{ id: string; monthly_crawl_page_limit: number }>()
    : { data: null }

  const limit =
    plan?.monthly_crawl_page_limit ?? STARTER_CRAWL_PAGES_LIMIT_FALLBACK

  const { data: counter } = await supabase
    .from('usage_counters')
    .select('crawl_pages_used')
    .eq('user_id', userId)
    .maybeSingle<{ crawl_pages_used: number }>()

  const used = counter?.crawl_pages_used ?? 0

  if (used >= limit) {
    return { allowed: false, used, limit }
  }
  return { allowed: true }
}

export async function POST(request: Request) {
  // 1. Authenticate user
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse and validate URL
  let body: { url?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const validation = validateCrawlUrl(body.url)
  if (!validation.valid || !validation.normalizedUrl) {
    return Response.json({ error: validation.error }, { status: 400 })
  }

  // Always crawl the root — users often paste a subpage by accident.
  const url = validation.normalizedUrl

  // 3. Check subscription
  const subscription = await checkSubscription(user.id)
  if (!subscription.active) {
    return Response.json(
      {
        error: 'subscription_inactive',
        reason: subscription.reason,
        upgrade_url: subscription.upgradeUrl ?? '/dashboard/billing',
      },
      { status: 402 }
    )
  }

  // 3b. Crawl-pages quota gate (M3F3).
  const crawlCheck = await checkCrawlQuota(supabase, user.id)
  if (!crawlCheck.allowed) {
    return Response.json(
      {
        error: 'crawl_quota_exceeded',
        upgrade_url: '/dashboard/billing',
        used: crawlCheck.used,
        limit: crawlCheck.limit,
      },
      { status: 402 }
    )
  }

  // 4. Enforce one-site-per-account
  const { data: existingSite, error: siteQueryError } = await supabase
    .from('sites')
    .select('id, url')
    .eq('user_id', user.id)
    .maybeSingle()

  if (siteQueryError) {
    return Response.json(
      { error: 'Failed to check existing sites' },
      { status: 500 }
    )
  }

  if (existingSite) {
    return Response.json(
      { error: 'You already have a site. Only one site per account is allowed.' },
      { status: 409 }
    )
  }

  // 5. Create sites row
  const siteKey = `sk_${crypto.randomBytes(16).toString('hex')}`

  const { data: site, error: insertError } = await supabase
    .from('sites')
    .insert({
      user_id: user.id,
      url,
      site_key: siteKey,
      crawl_status: 'crawling',
    })
    .select()
    .single()

  if (insertError || !site) {
    return Response.json(
      { error: 'Failed to create site' },
      { status: 500 }
    )
  }

  // 6. Call Firecrawl startCrawl()
  const firecrawl = new Firecrawl({
    apiKey: process.env.FIRECRAWL_API_KEY!,
  })

  let crawlJobId: string
  try {
    const crawlResult = await firecrawl.startCrawl(url, {
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
      // Cleanup: mark site as failed
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
    // Cleanup: mark site as failed
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

  // 7. Store crawl_job_id
  await supabase
    .from('sites')
    .update({ crawl_job_id: crawlJobId })
    .eq('id', site.id)

  return Response.json(
    {
      site_id: site.id,
      site_key: site.site_key,
      crawl_job_id: crawlJobId,
      crawl_status: 'crawling',
    },
    { status: 200 }
  )
}
