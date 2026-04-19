import type { Page } from '@playwright/test'

/**
 * External service stubs for Playwright. Each returns a counter so specs
 * can assert call counts (e.g. "OpenAI was never called because a
 * keyword rule handled the message").
 */

export interface StubCounter {
  count: () => number
}

export async function stubOpenAI(
  page: Page,
  opts: {
    embedding?: number[]
    chatText?: string
  } = {}
): Promise<StubCounter> {
  let count = 0
  const embedding = opts.embedding ?? new Array(1536).fill(0.01)
  const chatText = opts.chatText ?? "Hello from the stubbed chat model."

  await page.route('**/api.openai.com/**', async (route) => {
    count++
    const url = route.request().url()
    if (url.includes('/embeddings')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          object: 'list',
          data: [{ object: 'embedding', index: 0, embedding }],
          model: 'text-embedding-3-small',
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
      })
      return
    }
    // Chat completions — stream SSE
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        `data: ${JSON.stringify({
          choices: [{ delta: { content: chatText } }],
        })}\n\n` + `data: [DONE]\n\n`,
    })
  })

  return { count: () => count }
}

export async function stubFirecrawl(page: Page): Promise<StubCounter> {
  let count = 0
  await page.route('**/api.firecrawl.dev/**', async (route) => {
    count++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: `crawl_${Date.now()}`, status: 'scraping' }),
    })
  })
  return { count: () => count }
}

export async function stubStripe(page: Page): Promise<StubCounter> {
  let count = 0
  await page.route('**/api.stripe.com/**', async (route) => {
    count++
    const url = route.request().url()
    if (url.includes('/v1/checkout/sessions')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'cs_test_stub',
          url: 'https://checkout.stripe.com/test/cs_test_stub',
        }),
      })
      return
    }
    if (url.includes('/v1/billing_portal/sessions')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'bps_test_stub',
          url: 'https://billing.stripe.com/test/bps_test_stub',
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'stub', object: 'unknown' }),
    })
  })
  return { count: () => count }
}

/**
 * Installs all three stubs in a single call. Most specs want the "no
 * external services reachable" posture.
 */
export async function stubAllExternal(page: Page): Promise<{
  openai: StubCounter
  firecrawl: StubCounter
  stripe: StubCounter
}> {
  const [openai, firecrawl, stripe] = await Promise.all([
    stubOpenAI(page),
    stubFirecrawl(page),
    stubStripe(page),
  ])
  return { openai, firecrawl, stripe }
}
