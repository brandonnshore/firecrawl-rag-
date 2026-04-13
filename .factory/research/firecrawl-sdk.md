# Firecrawl SDK v2 — Node.js

> **Package:** `@mendable/firecrawl-js` (latest: v4.18.x)
> **Docs:** https://docs.firecrawl.dev/sdks/node | https://docs.firecrawl.dev/features/crawl
> **Last verified:** 2026-04-13

## Install

```bash
npm install @mendable/firecrawl-js
```

## Initialize

```typescript
import Firecrawl from '@mendable/firecrawl-js'

const firecrawl = new Firecrawl({
  apiKey: process.env.FIRECRAWL_API_KEY!,
})
```

---

## `crawl()` vs `startCrawl()` — Which to Use

| Method | Behavior | Use Case |
|--------|----------|----------|
| `crawl(url, opts)` | **Blocks** until crawl completes. Auto-paginates. Returns all results. | Scripts, one-off jobs, dev testing |
| `startCrawl(url, opts)` | Returns **immediately** with a job ID. You poll or use webhooks. | **Production web apps** — non-blocking |

### For RubyCrawl: Use `startCrawl()` + Webhook

The user clicks "Crawl My Site" → API route calls `startCrawl()` → returns immediately → Firecrawl sends webhook when done → webhook handler processes pages.

---

## `startCrawl()` — Async Crawl (Recommended for RubyCrawl)

```typescript
import Firecrawl from '@mendable/firecrawl-js'

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! })

// Start a crawl — returns immediately
const { id } = await firecrawl.startCrawl('https://example.com', {
  limit: 100,                    // Max pages to crawl (default: 10,000)
  maxDiscoveryDepth: 3,          // Max link-discovery hops from root
  scrapeOptions: {
    formats: ['markdown'],       // Output format(s): 'markdown', 'html', 'json'
    onlyMainContent: true,       // Strip nav/footer/sidebar
  },
  webhook: {
    url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/firecrawl`,
    events: ['started', 'page', 'completed'],
    metadata: {
      site_id: 'site_abc123',   // Custom data passed back in webhook payload
      user_id: 'user_xyz',
    },
  },
})

console.log('Crawl started, job ID:', id)
// → { success: true, id: "123-456-789", url: "https://api.firecrawl.dev/v2/crawl/123-456-789" }
```

## `crawl()` — Synchronous Crawl (Blocks Until Done)

```typescript
// Blocks until complete — good for scripts, NOT for web request handlers
const result = await firecrawl.crawl('https://docs.firecrawl.dev', {
  limit: 50,
  scrapeOptions: {
    formats: ['markdown', 'html'],
  },
  pollInterval: 5, // seconds between status checks (default varies)
})

console.log(result.status)  // 'completed'
console.log(result.data)    // Array of Document objects

for (const doc of result.data) {
  console.log(doc.metadata.sourceURL)
  console.log(doc.markdown?.substring(0, 200))
}
```

---

## Checking Crawl Status (Manual Polling)

```typescript
const status = await firecrawl.getCrawlStatus(jobId)

console.log(status.status)     // 'scraping' | 'completed' | 'failed'
console.log(status.completed)  // number of pages done
console.log(status.total)      // total pages discovered
console.log(status.data)       // array of scraped documents (so far)
```

## Cancelling a Crawl

```typescript
const ok = await firecrawl.cancelCrawl(jobId)
console.log('Cancelled:', ok)
```

---

## Webhook Setup

### Webhook Configuration Object

```typescript
webhook: {
  url: 'https://your-domain.com/api/webhooks/firecrawl', // HTTPS required
  headers: { 'X-Custom-Header': 'value' },               // Optional custom headers
  metadata: { site_id: '...', user_id: '...' },           // Passed back in every event
  events: ['started', 'page', 'completed', 'failed'],     // Filter which events to receive
}
```

### Webhook Event Types

| Event | Description |
|-------|-------------|
| `crawl.started` | Fires when the crawl begins |
| `crawl.page` | Fires for **each page** successfully scraped |
| `crawl.completed` | Fires when the entire crawl finishes |
| `crawl.failed` | Fires if the crawl encounters a fatal error |

### Webhook Payload Shape

```json
{
  "success": true,
  "type": "crawl.page",
  "id": "crawl-job-id",
  "data": [
    {
      "markdown": "# Page Title\n\nContent...",
      "metadata": {
        "title": "Page Title",
        "sourceURL": "https://example.com/page",
        "statusCode": 200
      }
    }
  ],
  "metadata": { "site_id": "site_abc123", "user_id": "user_xyz" },
  "error": null
}
```

### Webhook Signature Verification (CRITICAL)

Every webhook includes `X-Firecrawl-Signature` header with HMAC-SHA256 signature.

```typescript
import crypto from 'crypto'

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('x-firecrawl-signature')

  if (!signature) {
    return new Response('Missing signature', { status: 401 })
  }

  // Get your webhook secret from Firecrawl Dashboard → Settings → Advanced
  const secret = process.env.FIRECRAWL_WEBHOOK_SECRET!
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  // Timing-safe comparison
  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )

  if (!isValid) {
    return new Response('Invalid signature', { status: 401 })
  }

  const payload = JSON.parse(body)
  // Process the webhook...
}
```

### Webhook Retry Policy

- Your endpoint must respond `2xx` within **10 seconds**
- Retries: 1st after 1 min, 2nd after 5 min, 3rd after 15 min
- After 3 failures, webhook is marked failed

---

## Real-Time Updates via WebSocket Watcher

Alternative to webhooks — useful for dashboard progress UI:

```typescript
const { id } = await firecrawl.startCrawl('https://example.com', {
  limit: 50,
})

const watcher = firecrawl.watcher(id, {
  kind: 'crawl',
  pollInterval: 2,  // seconds
  timeout: 120,     // seconds
})

watcher.on('document', (doc) => {
  console.log('Page scraped:', doc.metadata?.sourceURL)
})

watcher.on('done', (state) => {
  console.log('Crawl finished:', state.status)
})

watcher.on('error', (err) => {
  console.error('Crawl error:', err)
})

await watcher.start()
```

---

## Configuration Reference

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `string` | required | Starting URL |
| `limit` | `integer` | `10000` | Max pages to crawl |
| `maxDiscoveryDepth` | `integer` | none | Max hops from root (0 = root + sitemap only) |
| `includePaths` | `string[]` | none | Regex patterns to include |
| `excludePaths` | `string[]` | none | Regex patterns to exclude |
| `crawlEntireDomain` | `boolean` | `false` | Follow sibling/parent paths |
| `allowSubdomains` | `boolean` | `false` | Follow subdomain links |
| `allowExternalLinks` | `boolean` | `false` | Follow external links |
| `sitemap` | `string` | `"include"` | `"include"`, `"skip"`, or `"only"` |
| `scrapeOptions.formats` | `string[]` | `['markdown']` | `'markdown'`, `'html'`, `'json'` |
| `scrapeOptions.onlyMainContent` | `boolean` | `true` | Strip nav/footer |
| `webhook` | `object` | none | Webhook configuration |

---

## RubyCrawl-Specific Usage Pattern

```typescript
// POST /api/sites/[siteId]/crawl — route handler
import { after } from 'next/server'
import Firecrawl from '@mendable/firecrawl-js'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request, { params }: { params: { siteId: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { siteId } = params
  const { data: site } = await supabase
    .from('sites')
    .select('url')
    .eq('id', siteId)
    .eq('user_id', user.id)
    .single()

  if (!site) return new Response('Not found', { status: 404 })

  const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! })

  const { id: crawlJobId } = await firecrawl.startCrawl(site.url, {
    limit: 100,
    maxDiscoveryDepth: 3,
    scrapeOptions: {
      formats: ['markdown'],
      onlyMainContent: true,
    },
    webhook: {
      url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/firecrawl`,
      events: ['page', 'completed'],
      metadata: { site_id: siteId, user_id: user.id },
    },
  })

  // Update site with crawl job ID
  await supabase
    .from('sites')
    .update({ crawl_job_id: crawlJobId, crawl_status: 'crawling' })
    .eq('id', siteId)

  return Response.json({ crawlJobId })
}
```

---

## Key Gotchas

1. **Credit usage:** Each page crawled costs 1 credit. JSON mode adds 4 credits/page.
2. **Result expiration:** API results are only available for **24 hours** after completion.
3. **Non-deterministic results:** Concurrent crawling means different runs may discover different pages near depth boundaries.
4. **`data` array only includes successes:** Use the separate "Get Crawl Errors" endpoint for failures.
5. **Default limit is 10,000:** Always set a `limit` to control costs.
6. **`onlyMainContent` defaults to `true`:** Good for RAG use cases (strips nav/footer).
