# Architecture

How the RubyCrawl system works — components, relationships, data flows, and invariants.

## System Overview

RubyCrawl is a SaaS product: SMB owners paste their website URL, it gets crawled and indexed, and they get an embeddable AI chatbot widget that answers visitor questions using their site's content.

**Major components:**
- **Next.js App** (App Router) — Dashboard UI + API routes
- **Supabase** — Auth (magic link), Postgres with pgvector, RLS, Realtime
- **Firecrawl** — External crawling service (async via webhooks)
- **OpenAI** — Embeddings (text-embedding-3-small) and chat (gpt-4o-mini)
- **Widget** — Preact IIFE bundle, Shadow DOM, embeddable on any site
- **Redis** — Local, for rate limiting the public chat API

## Data Flow

```
User enters URL
  -> POST /api/crawl/start (validates, creates site row)
  -> Firecrawl startCrawl() with webhook URL
  -> Firecrawl crawls site asynchronously
  -> POST /api/crawl/webhook (Firecrawl calls back)
  -> after() background processing:
      -> Clean markdown (strip nav, footer, breadcrumbs)
      -> Chunk (header split -> 512-token recursive)
      -> Deduplicate (SHA-256)
      -> Batch embed via OpenAI (100 chunks/batch, p-limit(3))
      -> Store pages + embeddings with crawl_batch = current + 1
      -> Atomic swap: UPDATE sites SET active_crawl_batch += 1, crawl_status = 'ready'
      -> Cleanup old batch data

Visitor asks question via widget:
  -> POST /api/chat/session { message, history, site_key }
      -> Validate site_key -> lookup site (service role client)
      -> Rate limit check (Redis)
      -> Contextual query rewriting (if follow-up)
      -> Embed query (text-embedding-3-small)
      -> Hybrid search: match_chunks() RPC (0.7 semantic + 0.3 keyword)
      -> Build system prompt with numbered citations
      -> Store session in Redis KV (60s TTL)
      -> Return { sessionId }
  -> GET /api/chat/stream?sid=sessionId
      -> Retrieve session from Redis
      -> Stream gpt-4o-mini response via SSE
      -> Store completed conversation in DB
```

## Component Architecture

### Next.js App Router
- **Pages** (app/): login, dashboard (setup, preview, embed, leads, conversations, settings, billing), landing page
- **API Routes** (app/api/): crawl/start, crawl/webhook, chat/session, chat/stream, leads, leads/export
- **Middleware**: Session refresh, protect /dashboard/* routes
- **Edge Runtime**: Chat session + stream routes only (0ms cold start)

### Supabase
- **Auth**: Magic link via signInWithOtp, @supabase/ssr for server/browser clients
- **Database**: Postgres with pgvector extension, 7 tables (profiles, sites, pages, embeddings, leads, conversations, processed_stripe_events)
- **RLS**: All tables have row-level security. Authenticated users access own data. Public APIs (chat, leads) use service role client after validating site_key.
- **Realtime**: Dashboard subscribes to sites table changes for crawl_status updates

### External APIs
- **Firecrawl**: startCrawl() -> webhook callback. Async, non-blocking. 100-page limit, markdown format.
- **OpenAI**: text-embedding-3-small (1536 dims) for embeddings, gpt-4o-mini (temp 0.0) for chat.

### Widget
- Two-file architecture: loader (~3KB) + full panel (~15-20KB)
- Preact with Vite IIFE build, Shadow DOM for style isolation
- dialog element for focus trapping, aria-live for accessibility
- Two-step fetch: POST session -> GET SSE stream
- States: loading -> not-ready (hidden) -> ready (bubble) -> open (panel)

### Redis
- Local Redis on port 6379 for development
- Rate limiting: 1 msg/3s per visitor, 20 msgs/session, 500 msgs/day per site

## Key Invariants

1. **Blue-green embedding swap**: New crawl data stored with crawl_batch = active_crawl_batch + 1. Only after all embeddings stored, atomic swap via UPDATE. Old batch cleaned up after. Chat always queries active_crawl_batch only.
2. **One site per account** (V1): Enforced by UNIQUE constraint on sites.user_id.
3. **Service role key isolation**: Used in exactly 3 API routes: chat/session, leads, crawl/webhook. Every other route uses user session client.
4. **Widget visibility**: Only renders bubble when crawl_status = 'ready'. If not ready, no bubble. If API returns 402, widget hides.
5. **Subscription stub**: Check always returns "active". Single function to replace when adding Stripe.

## Security Boundaries

| Surface | Auth Mechanism | Data Access |
|---------|---------------|-------------|
| Dashboard pages | Supabase JWT (middleware) | RLS (user's own data) |
| Dashboard APIs | Supabase JWT | RLS (user's own data) |
| Chat API | site_key validation | Service role (site's embeddings) |
| Lead capture API | site_key validation | Service role (insert only) |
| Crawl webhook | crawl_job_id validation | Service role (site's data) |
| Widget | None (public JS) | Via chat/lead APIs only |
