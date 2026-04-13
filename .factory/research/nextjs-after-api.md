# Next.js 15+ `after()` API

> **Import:** `import { after } from 'next/server'`
> **Docs:** https://nextjs.org/docs/app/api-reference/functions/after
> **Stable since:** Next.js v15.1.0
> **Last verified:** 2026-04-13

## What It Does

`after()` schedules work to be executed **after** a response (or prerender) is finished. This is ideal for tasks and side effects that should not block the response, such as:

- Logging and analytics
- Background processing (e.g., triggering a crawl)
- Database writes that don't affect the response
- Cache invalidation
- Webhook dispatching

---

## Basic Usage

```typescript
import { after } from 'next/server'

export async function POST(request: Request) {
  const body = await request.json()

  // Do the main work — return response immediately
  const result = await processRequest(body)

  // Schedule background work AFTER response is sent
  after(async () => {
    await saveToAnalytics(body)
    await sendNotification(result)
  })

  return Response.json(result)
}
```

---

## Where It Can Be Used

| Context | Supported | Notes |
|---------|-----------|-------|
| Route Handlers | ✅ | Full access to `cookies()`, `headers()` inside callback |
| Server Functions (Actions) | ✅ | Full access to `cookies()`, `headers()` inside callback |
| Server Components | ✅ | **Cannot** use `cookies()`/`headers()` inside callback — read them before `after()` |
| Proxy (Middleware) | ✅ | |
| `generateMetadata` | ✅ | Same restrictions as Server Components |

---

## Usage in Route Handlers (Full Request API Access)

```typescript
import { after } from 'next/server'
import { cookies, headers } from 'next/headers'

export async function POST(request: Request) {
  // Perform mutation
  const body = await request.json()
  await doWork(body)

  // Log user activity AFTER response — has full request access
  after(async () => {
    const userAgent = (await headers()).get('user-agent') || 'unknown'
    const sessionCookie = (await cookies()).get('session-id')?.value || 'anonymous'
    await logUserAction({ sessionCookie, userAgent })
  })

  return Response.json({ status: 'success' })
}
```

---

## Usage in Server Components (Read Data Before `after()`)

```typescript
import { after } from 'next/server'
import { cookies, headers } from 'next/headers'

export default async function Page() {
  // ✅ Read request data BEFORE after() — during component render
  const userAgent = (await headers()).get('user-agent') || 'unknown'
  const sessionCookie = (await cookies()).get('session-id')?.value || 'anonymous'

  after(() => {
    // ✅ Use the values read above via closure
    logUserAction({ sessionCookie, userAgent })
  })

  // ❌ WRONG — calling cookies()/headers() inside after() in a Server Component
  // after(async () => {
  //   const ua = (await headers()).get('user-agent')  // THROWS RUNTIME ERROR
  // })

  return <h1>My Page</h1>
}
```

---

## Timeout / Duration Limits

`after()` runs for the platform's default or configured max duration of your route.

### Configure with `maxDuration` Route Segment Config

```typescript
// app/api/crawl/route.ts
export const maxDuration = 60  // seconds

export async function POST(request: Request) {
  // ...
  after(async () => {
    // This callback has up to 60 seconds to complete
    await heavyBackgroundWork()
  })
  return Response.json({ ok: true })
}
```

### Platform Limits

| Platform | Default | Max |
|----------|---------|-----|
| Vercel Hobby | 10s | 60s |
| Vercel Pro | 15s | 300s (5 min) |
| Vercel Enterprise | 15s | 900s (15 min) |
| Self-hosted Node.js | No limit | Configurable |
| Docker | No limit | Configurable |
| Static export | ❌ Not supported | N/A |

> **Important:** The `maxDuration` applies to the TOTAL time (response + after callback). For Vercel Hobby, this means after() must complete within 60s from the start of the request, not from when the response was sent.

---

## Key Behaviors

1. **Runs even on errors**: `after()` executes even if the response didn't complete successfully, including when an error is thrown, `notFound()` is called, or `redirect()` is called.

2. **Nesting is allowed**: You can call `after()` inside another `after()` callback, and create utility functions that wrap `after()`.

3. **Deduplication with `cache`**: You can use React `cache` to deduplicate functions called inside `after()`.

4. **Not a Request-time API**: Calling `after()` does NOT cause a route to become dynamic. If used within a static page, the callback executes at build time or on revalidation.

---

## RubyCrawl-Specific Pattern: Triggering Crawl Processing

```typescript
// POST /api/sites/[siteId]/crawl
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Firecrawl from '@mendable/firecrawl-js'

export const maxDuration = 60

export async function POST(
  request: Request,
  { params }: { params: { siteId: string } }
) {
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

  // Return immediately — user sees "Crawling started"
  // Use after() to trigger Firecrawl without blocking the response
  after(async () => {
    const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! })

    try {
      const { id: crawlJobId } = await firecrawl.startCrawl(site.url, {
        limit: 100,
        maxDiscoveryDepth: 3,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        webhook: {
          url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/firecrawl`,
          events: ['page', 'completed'],
          metadata: { site_id: siteId, user_id: user.id },
        },
      })

      await supabase
        .from('sites')
        .update({ crawl_job_id: crawlJobId, crawl_status: 'crawling' })
        .eq('id', siteId)
    } catch (error) {
      console.error('Failed to start crawl:', error)
      await supabase
        .from('sites')
        .update({ crawl_status: 'failed' })
        .eq('id', siteId)
    }
  })

  // Respond immediately
  return Response.json({ status: 'crawling' })
}
```

---

## Serverless Platform Support (`waitUntil`)

On Vercel, `after()` works out of the box. For custom serverless platforms, you need to implement `waitUntil`:

```typescript
// Custom platform integration
const RequestContext = globalThis[Symbol.for('@next/request-context')]

// The platform must provide:
type NextRequestContext = {
  get(): { waitUntil?: (promise: Promise<any>) => void } | undefined
}
```

> On Vercel, this is handled automatically. On self-hosted Node.js/Docker, it also works natively. Only custom serverless platforms need the `waitUntil` implementation.

---

## Key Gotchas

1. **`after()` is NOT `waitUntil()`**: It's a higher-level API. On Vercel, it uses `waitUntil` under the hood, but you don't need to manage it yourself.

2. **Shared timeout**: The `maxDuration` covers both the response AND the after callback. If your response takes 5s and `maxDuration` is 10s, the after callback only has ~5s.

3. **No return value**: `after()` doesn't return anything. You can't use it to pass data back to the client.

4. **Error handling**: Errors in `after()` callbacks don't affect the already-sent response, but they should be caught and logged to avoid silent failures.

5. **Static pages**: If `after()` is used in a statically generated page, the callback runs at build time, not on each request. Be careful with this.

6. **Edge Runtime**: `after()` works on Edge Runtime too, but the same timeout limits apply.
