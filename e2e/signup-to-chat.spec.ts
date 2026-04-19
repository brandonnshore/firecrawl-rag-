import { test, expect } from './fixtures/auth'
import {
  seedSite,
  seedUsageCounter,
  setProfilePlan,
  setSubscriptionStatus,
  cleanupUserData,
} from './fixtures/seed'
import { createClient } from '@supabase/supabase-js'

// M9F13 e2e-signup-to-chat
// Fulfills: VAL-CROSS-001
//
// Full new-user journey: seeded signup → /dashboard → setup page shows
// crawling state → simulated crawl completion (crawl_status='ready')
// flips UI → /dashboard/embed renders snippet → widget loader on a test
// page (page.setContent) boots and shows the bubble → chat/session +
// chat/stream returns a citation-formatted canned response.
//
// Server-side OpenAI calls from /api/chat/stream cannot be intercepted
// by Playwright's page.route (which only sees browser-initiated traffic),
// so the "cited answer" is exercised via the canned custom_response path
// — the owner configures a response containing a citation marker and
// the widget surfaces it unchanged. This proves the whole end-to-end
// pipe (site_key lookup → subscription gate → quota RPC → matcher →
// stream route → browser) without requiring a live LLM.

const LOADER_SCRIPT = '/rubycrawl-loader.js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function ensurePlans() {
  await admin().from('plans').upsert([
    {
      id: 'starter',
      display_name: 'Starter',
      price_cents: 2499,
      monthly_message_limit: 2000,
      monthly_crawl_page_limit: 500,
      supplementary_file_limit: 25,
      stripe_price_id: null,
    },
  ])
}

async function enableBilling(userId: string): Promise<void> {
  await ensurePlans()
  await setProfilePlan(userId, 'starter')
  await setSubscriptionStatus(userId, 'active', {
    current_period_end: new Date(Date.now() + 28 * 86400_000).toISOString(),
    stripe_customer_id: `cus_signup_${Date.now()}`,
  })
  await seedUsageCounter(userId, { messages_used: 0 })
}

async function seedKeywordCannedResponse(
  siteId: string,
  opts: { triggers: string[]; response: string; priority?: number }
): Promise<void> {
  const { error } = await admin().from('custom_responses').insert({
    site_id: siteId,
    trigger_type: 'keyword',
    triggers: opts.triggers,
    response: opts.response,
    priority: opts.priority ?? 10,
    is_active: true,
  })
  if (error) throw new Error(`seed canned response failed: ${error.message}`)
}

async function seedPage(
  siteId: string,
  opts: { url: string; title: string; content: string; batch: number }
): Promise<void> {
  const { error } = await admin().from('pages').insert({
    site_id: siteId,
    url: opts.url,
    title: opts.title,
    content: opts.content,
    content_hash: `hash_${Math.random().toString(36).slice(2, 12)}`,
    crawl_batch: opts.batch,
  })
  if (error) throw new Error(`seed page failed: ${error.message}`)
}

test.describe('new-user signup-to-chat journey', () => {
  let siteId: string
  let siteKey: string

  test.beforeEach(async ({ seededUser }) => {
    const site = await seedSite({
      userId: seededUser.userId,
      crawlStatus: 'crawling',
    })
    siteId = site.id
    siteKey = site.site_key
  })

  test.afterEach(async ({ seededUser }) => {
    await admin().from('custom_responses').delete().eq('site_id', siteId)
    await admin().from('pages').delete().eq('site_id', siteId)
    await cleanupUserData(seededUser.userId)
  })

  test('seeded signup lands on /dashboard (not redirected to /login)', async ({
    authedPage,
  }) => {
    const res = await authedPage.goto('/dashboard')
    expect(res?.status()).toBeLessThan(400)
    expect(authedPage.url()).toContain('/dashboard')
    expect(authedPage.url()).not.toContain('/login')
  })

  test('setup page: crawling state flips to ready after simulated webhook', async ({
    authedPage,
    seededUser,
  }) => {
    await enableBilling(seededUser.userId)

    await authedPage.goto('/dashboard/setup')
    await expect(authedPage.getByText('Building your chatbot.')).toBeVisible({
      timeout: 10_000,
    })

    // Simulate the Firecrawl `crawl.completed` webhook outcome: flip the
    // site to 'ready' + record a page count (what processCrawlData does
    // at the end of its pipeline). The setup page polls every 3s, so we
    // give it a fallback reload for determinism.
    await admin()
      .from('sites')
      .update({
        crawl_status: 'ready',
        crawl_page_count: 3,
        last_crawled_at: new Date().toISOString(),
      })
      .eq('id', siteId)

    try {
      await expect(authedPage.getByText('Your chatbot')).toBeVisible({
        timeout: 10_000,
      })
    } catch {
      await authedPage.reload()
      await expect(authedPage.getByText('Your chatbot')).toBeVisible({
        timeout: 5000,
      })
    }
    await expect(authedPage.getByText('is ready.')).toBeVisible()
  })

  test('/dashboard/embed renders the snippet with the seeded site_key and loader src', async ({
    authedPage,
  }) => {
    // Embed page guards on site existing; bump to ready so the "no site"
    // empty state doesn't hijack.
    await admin()
      .from('sites')
      .update({ crawl_status: 'ready' })
      .eq('id', siteId)

    await authedPage.goto('/dashboard/embed')
    await expect(
      authedPage.getByRole('heading', { name: /Add it to your website/i })
    ).toBeVisible()
    const snippet = authedPage.locator('pre code').first()
    const text = await snippet.innerText()
    expect(text).toContain(`data-site-key="${siteKey}"`)
    expect(text).toContain(LOADER_SCRIPT)
    expect(text).toContain('data-api-base="')
  })

  test('widget loader on a test HTML page mounts the chat bubble', async ({
    authedPage,
    seededUser,
    baseURL,
  }) => {
    await enableBilling(seededUser.userId)
    await admin()
      .from('sites')
      .update({ crawl_status: 'ready' })
      .eq('id', siteId)
    // The loader posts `__healthcheck__` to /api/chat/session. Seed a
    // canned response that matches so the healthcheck returns 200 (non
    // 404/503) — which is what the loader gates the bubble on.
    await seedKeywordCannedResponse(siteId, {
      triggers: ['__healthcheck__'],
      response: 'ok',
    })

    const origin = baseURL ?? 'http://localhost:3000'
    await authedPage.goto(`${origin}/`)
    await authedPage.setContent(
      `<!DOCTYPE html><html><body>
        <h1>Host page</h1>
        <script
          src="${origin}${LOADER_SCRIPT}"
          data-site-key="${siteKey}"
          data-api-base="${origin}"
          async
        ></script>
      </body></html>`
    )

    const root = authedPage.locator('#rubycrawl-root')
    await expect(root).toBeAttached({ timeout: 10_000 })

    // The bubble lives inside an open shadow root. Query through the
    // host's shadowRoot with evaluate so it becomes observable.
    await authedPage.waitForFunction(
      () => {
        const host = document.getElementById('rubycrawl-root')
        return !!host?.shadowRoot?.querySelector('.rc-bubble')
      },
      undefined,
      { timeout: 10_000 }
    )
  })

  test('full journey: signup → ready site → canned citation response end-to-end', async ({
    authedPage,
    seededUser,
  }) => {
    await enableBilling(seededUser.userId)
    await admin()
      .from('sites')
      .update({ crawl_status: 'ready', crawl_page_count: 1 })
      .eq('id', siteId)
    await seedPage(siteId, {
      url: 'https://example.com/',
      title: 'Home',
      content: 'We are open Monday through Friday, 9 to 5.',
      batch: 1,
    })
    await seedKeywordCannedResponse(siteId, {
      triggers: ['hours'],
      response:
        'Our hours are Monday through Friday, 9am–5pm. [source: Home — https://example.com/]',
    })

    // Touch the embed page to confirm the journey lands where users
    // would actually click "copy snippet", then invoke the chat API
    // the same way the mounted widget would.
    await authedPage.goto('/dashboard/embed')
    await expect(authedPage.locator('pre code').first()).toContainText(
      siteKey
    )

    const sessionRes = await authedPage.request.post('/api/chat/session', {
      headers: {
        'x-forwarded-for': `10.13.${Math.floor(Math.random() * 255)}.${Math.floor(
          Math.random() * 255
        )}`,
      },
      data: { message: 'what are your hours?', site_key: siteKey, history: [] },
    })
    expect(sessionRes.ok()).toBeTruthy()
    const { sessionId } = (await sessionRes.json()) as { sessionId: string }

    const streamRes = await authedPage.request.get(
      `/api/chat/stream?sid=${sessionId}`
    )
    expect(streamRes.status()).toBe(200)
    const body = await streamRes.text()
    expect(body).toContain('Monday through Friday')
    // Citation marker surfaces verbatim from the canned response —
    // proves the end-to-end pipe carried the owner-authored answer
    // from DB through the stream route out to the widget-side caller.
    expect(body).toContain('[source: Home')
    expect(body).toContain('https://example.com/')
  })
})
