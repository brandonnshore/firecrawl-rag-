# M2: Crawl Pipeline — Execution Document

## Prerequisites
- M1 Foundation is complete (auth, dashboard shell, DB schema deployed)
- `.env.local` has: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, FIRECRAWL_API_KEY, NEXT_PUBLIC_APP_URL=http://localhost:3000
- Supabase project ref: `luznxhpadjblwnkfzjhn`
- pnpm as package manager, Vitest for tests, Next.js 16.2.3

## What Already Exists

These files are ALREADY BUILT and committed. The crawl webhook/processing files exist as WIP (uncommitted). Review them, fix issues if any, write tests, and verify end-to-end.

### Already committed:
- `src/lib/supabase/server.ts` — Server Supabase client (uses cookies)
- `src/lib/supabase/client.ts` — Browser Supabase client
- `src/lib/subscription.ts` — Stub that always returns `{ active: true, status: 'active' }`
- `src/proxy.ts` — Next.js 16 proxy (was middleware.ts) for session refresh + route protection
- `src/app/login/page.tsx` — Magic link login
- `src/app/auth/callback/route.ts` — Auth code exchange
- `src/app/api/auth/signout/route.ts` — Sign out
- `src/app/dashboard/layout.tsx` — Dashboard layout with sidebar
- `src/app/dashboard/sidebar.tsx` — Client component sidebar
- `src/app/dashboard/nav-items.ts` — Nav link config
- `src/app/dashboard/page.tsx` — Placeholder dashboard
- `src/lib/auth/redirect.ts` — Redirect path sanitization
- `src/lib/crawl/validate-url.ts` — URL validation (HTTPS, SSRF protection)
- `src/app/api/crawl/start/route.ts` — POST /api/crawl/start (fully working)

### Already created as WIP (review and complete):
- `src/app/api/crawl/webhook/route.ts` — Firecrawl webhook handler
- `src/lib/crawl/process.ts` — Content processing pipeline
- `src/lib/crawl/chunk.ts` — Two-layer markdown chunking
- `src/lib/crawl/clean.ts` — Markdown cleaning
- `src/__tests__/crawl-webhook.test.ts` — WIP tests
- `src/__tests__/crawl-process.test.ts` — WIP tests
- `src/__tests__/chunk-markdown.test.ts` — WIP tests
- `src/__tests__/clean-markdown.test.ts` — WIP tests

### Config files:
- `vitest.config.ts` — jsdom environment, @/ alias
- `tsconfig.json` — strict, paths @/* -> ./src/*
- `package.json` — dependencies: @supabase/supabase-js, @supabase/ssr, openai, @mendable/firecrawl-js, ai, @ai-sdk/openai, ioredis, p-limit

---

## DB Schema (Key Tables)

```sql
-- sites table
create table sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  url text not null,
  name text,
  site_key text unique default encode(gen_random_bytes(16), 'hex'),
  crawl_status text default 'pending'
    check (crawl_status in ('pending', 'crawling', 'indexing', 'ready', 'failed')),
  crawl_job_id text,
  crawl_page_count int default 0,
  active_crawl_batch int not null default 0,
  last_crawled_at timestamptz,
  crawl_error_message text,
  calendly_url text,
  google_maps_url text,
  greeting_message text default 'Hi! How can I help you today?',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint sites_user_id_unique unique (user_id)
);

-- pages table
create table pages (
  id bigint primary key generated always as identity,
  site_id uuid not null references sites(id) on delete cascade,
  url text not null,
  title text,
  content text not null,
  content_hash text,
  crawl_batch int not null default 1,
  created_at timestamptz default now(),
  constraint pages_site_url_batch_unique unique (site_id, url, crawl_batch)
);

-- embeddings table
create table embeddings (
  id bigint primary key generated always as identity,
  site_id uuid not null references sites(id) on delete cascade,
  page_id bigint not null references pages(id) on delete cascade,
  chunk_text text not null,
  source_url text not null,
  embedding extensions.vector(1536),
  text_search tsvector generated always as (to_tsvector('english', chunk_text)) stored,
  crawl_batch int not null default 1,
  created_at timestamptz default now()
);

-- Hybrid search function
create or replace function match_chunks(
  query_embedding extensions.vector(1536),
  query_text text,
  p_site_id uuid,
  match_threshold float default 0.5,
  match_count int default 5
)
returns table (
  id bigint,
  chunk_text text,
  source_url text,
  similarity float
)
language sql stable
as $$
  select e.id, e.chunk_text, e.source_url,
    (0.7 * (1 - (e.embedding <=> query_embedding))) +
    (0.3 * coalesce(ts_rank(e.text_search, websearch_to_tsquery('english', query_text)), 0))
      as similarity
  from embeddings e
  join sites s on s.id = e.site_id
  where e.site_id = p_site_id
    and s.crawl_status = 'ready'
    and e.crawl_batch = s.active_crawl_batch
    and (1 - (e.embedding <=> query_embedding)) > match_threshold
  order by similarity desc
  limit least(match_count, 20);
$$;
```

---

## Feature 1: Crawl Webhook & Processing

### Status: WIP — Review, complete tests, verify E2E

The webhook handler and processing pipeline are already written. Your job is to:
1. Review the existing code for correctness
2. Ensure tests are comprehensive and passing
3. Verify the full pipeline works end-to-end with a real crawl

### Service Role Client Pattern

The webhook uses a service role client (bypasses RLS). This pattern is used because webhooks have no user session:

```typescript
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
```

### Key Architecture Decisions

1. **after() API**: The webhook returns 200 immediately and uses `after()` from `next/server` to process in the background. `export const maxDuration = 300` gives 5 minutes.

2. **Blue-green batch swap**: New data stored with `crawl_batch = active_crawl_batch + 1`. Only after ALL embeddings stored, atomic swap via `UPDATE sites SET active_crawl_batch = newBatch, crawl_status = 'ready'`. Old batch cleaned up after.

3. **Chunking**: Two-layer — split by markdown headers first (preserves topic boundaries), then RecursiveCharacterTextSplitter at 512 tokens (~2048 chars) for oversized sections.

4. **Embedding**: OpenAI text-embedding-3-small (1536 dims). Batches of 100 chunks. `p-limit(3)` for concurrency control.

5. **Deduplication**: SHA-256 hash of cleaned content. Pages with identical hashes are deduplicated.

### Firecrawl Webhook Payload Shape

```typescript
interface FirecrawlWebhookPayload {
  success: boolean
  type: string        // 'crawl.started' | 'crawl.page' | 'crawl.completed' | 'crawl.failed'
  id: string          // crawl job ID
  data?: Array<{
    markdown: string
    metadata: { title: string; sourceURL: string; statusCode: number }
  }>
  metadata?: { site_id?: string; user_id?: string }
  error?: string | null
}
```

### Verification Steps

After reviewing and fixing the code:

```bash
# 1. Run all tests
pnpm vitest run

# 2. Typecheck
pnpm run typecheck

# 3. Lint
pnpm run lint

# 4. Start dev server
pnpm dev

# 5. Trigger a real crawl (you need an authenticated session for this)
# Option A: Use the setup page UI (Feature 2)
# Option B: Manually insert a test site and simulate a webhook:
curl -X POST http://localhost:3000/api/crawl/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "success": true,
    "type": "crawl.completed",
    "id": "YOUR_CRAWL_JOB_ID",
    "data": [
      {
        "markdown": "# Test Page\n\nThis is test content about a plumbing business in Portland.",
        "metadata": { "title": "Test Page", "sourceURL": "https://example.com/test", "statusCode": 200 }
      }
    ]
  }'

# 6. Verify embeddings exist with correct dimensions
# Use Supabase dashboard SQL editor:
# SELECT id, site_id, vector_dims(embedding) as dims, source_url, crawl_batch FROM embeddings LIMIT 5;

# 7. Verify match_chunks works
# SELECT * FROM match_chunks(
#   (SELECT embedding FROM embeddings LIMIT 1),
#   'plumbing',
#   'YOUR_SITE_ID'::uuid
# );

# 8. Verify site status
# SELECT crawl_status, active_crawl_batch, crawl_page_count, last_crawled_at FROM sites;
```

### Validation Assertions (must satisfy)

- **VAL-CRAWL-008**: Embeddings have 1536 dimensions, non-null vectors, populated source_url, correct crawl_batch
- **VAL-CRAWL-009**: After completion, crawl_status='ready', active_crawl_batch > 0, last_crawled_at is recent
- **VAL-CRAWL-010**: match_chunks() returns results for relevant queries from the active batch
- **VAL-CRAWL-011**: On failure, crawl_status='failed' with human-readable crawl_error_message

---

## Feature 2: Setup Page with Realtime

### Create: `src/app/dashboard/setup/page.tsx`

This is a 'use client' page that:
1. Shows "Your AI chatbot is 3 minutes away" headline with a URL input
2. On submit, POSTs to `/api/crawl/start`
3. Subscribes to Supabase Realtime for crawl_status changes on the sites row
4. Shows step-by-step progress
5. On failure, shows error and retry button
6. After ready, shows CTA to preview page

```tsx
'use client'

import { createClient } from '@/lib/supabase/client'
import { useState, useEffect, useCallback } from 'react'
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

  // Check if user already has a site
  useEffect(() => {
    async function checkExistingSite() {
      const { data: { user } } = await supabase.auth.getUser()
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

  // Subscribe to Realtime for crawl_status changes
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
    // For retry, we need to reset the site and start a new crawl
    // This could either update the existing site or use a re-crawl endpoint
    setError(null)
    setErrorMessage(null)
    setCrawlStatus('idle')
    // Reset the site by deleting and re-creating
    // Or implement a re-crawl API that updates the existing site
    // For now, show the URL form again
  }

  // Render based on state
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
          <ProgressStep
            label="Website found"
            done={true}
          />
          <ProgressStep
            label={pageCount > 0 ? `Reading your pages... (Found ${pageCount} pages)` : 'Reading your pages...'}
            done={crawlStatus === 'indexing' || crawlStatus === 'ready'}
            active={crawlStatus === 'crawling'}
          />
          <ProgressStep
            label="Training on your content..."
            done={crawlStatus === 'ready'}
            active={crawlStatus === 'indexing'}
          />
          <ProgressStep
            label="Chatbot ready!"
            done={crawlStatus === 'ready'}
          />
        </div>
      </div>
    )
  }

  // Default: show URL input form
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="mb-2 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
        Your AI chatbot is 3 minutes away
      </h1>
      <p className="mb-8 text-zinc-600 dark:text-zinc-400">
        Paste your website URL and we'll build a chatbot that knows everything about your business.
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

function ProgressStep({ label, done, active }: { label: string; done: boolean; active?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
        done
          ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
          : active
            ? 'bg-zinc-200 text-zinc-700 animate-pulse dark:bg-zinc-700 dark:text-zinc-300'
            : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600'
      }`}>
        {done ? '✓' : active ? '...' : '○'}
      </div>
      <span className={`text-sm ${
        done
          ? 'text-green-700 dark:text-green-300'
          : active
            ? 'text-zinc-900 font-medium dark:text-zinc-100'
            : 'text-zinc-400 dark:text-zinc-600'
      }`}>
        {label}
      </span>
    </div>
  )
}
```

### Supabase Realtime Pattern

The key pattern for subscribing to row changes:

```typescript
const channel = supabase
  .channel('unique-channel-name')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',       // or 'INSERT', 'DELETE', '*'
      schema: 'public',
      table: 'sites',
      filter: `id=eq.${siteId}`,  // only this row
    },
    (payload) => {
      // payload.new has the updated row
      // payload.old has the previous values
    }
  )
  .subscribe()

// Cleanup
supabase.removeChannel(channel)
```

**IMPORTANT**: Supabase Realtime requires that the table has Realtime enabled in the Supabase Dashboard. Go to Database > Realtime and enable it for the `sites` table. Alternatively, run:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE sites;
```

### Test File: `src/__tests__/setup-page.test.tsx`

Test that the component renders correctly in each state. Mock the Supabase client.

### Verification

```bash
pnpm vitest run
pnpm run typecheck
pnpm run lint

# Manual: navigate to /dashboard/setup, enter a URL, watch progress
# Verify WebSocket connection in browser Network tab
```

### Validation Assertions

- **VAL-CRAWL-007**: Dashboard uses Supabase Realtime (WebSocket visible in Network tab), not polling. UI updates without page refresh.
- **VAL-CRAWL-012**: Retry button on failed crawl resets status to 'crawling', starts new Firecrawl job, and updates crawl_job_id.

---

## Firecrawl SDK Reference

```typescript
import Firecrawl from '@mendable/firecrawl-js'

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! })

// Async crawl (non-blocking)
const { id } = await firecrawl.startCrawl('https://example.com', {
  limit: 100,
  maxDiscoveryDepth: 3,
  scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
  webhook: {
    url: 'https://your-app.com/api/crawl/webhook',
    events: ['page', 'completed', 'failed'],
    metadata: { site_id: '...', user_id: '...' },
  },
})
```

Webhook events: `crawl.started`, `crawl.page`, `crawl.completed`, `crawl.failed`

---

## after() API Reference

```typescript
import { after } from 'next/server'

export const maxDuration = 300 // seconds

export async function POST(request: Request) {
  // Return response immediately
  after(async () => {
    // Background work here — runs after response sent
    // Has up to maxDuration seconds total (shared with response time)
  })
  return Response.json({ received: true })
}
```

---

## Final Checklist

- [ ] All tests pass: `pnpm vitest run`
- [ ] TypeScript clean: `pnpm run typecheck`
- [ ] Lint clean: `pnpm run lint`
- [ ] Crawl webhook processes pages correctly
- [ ] Embeddings have 1536 dimensions
- [ ] match_chunks() returns results
- [ ] Setup page shows realtime progress via WebSocket
- [ ] Failure state shows error and retry button
- [ ] Ready state shows CTA to preview
- [ ] Enable Realtime on sites table in Supabase Dashboard
- [ ] Commit all changes
