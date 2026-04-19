# RubyCrawl

AI chatbot-as-a-service for small business websites. Owners paste a URL, we crawl it, embed the content, and hand back a one-line `<script>` snippet that loads a chat widget on any page. Visitors ask questions; the widget answers grounded in the owner's own content with citations, falls back through custom keyword responses, and escalates to lead capture (ask-email / ask-phone / show-form / Calendly link / human handoff) when rules fire.

## What's in the box

- **Crawl + embed pipeline** — Firecrawl scrapes up to 100 pages, OpenAI `text-embedding-3-small` builds chunk embeddings, pgvector stores them behind Supabase RLS.
- **Hybrid-retrieval chat** — `/api/chat/session` + `/api/chat/stream` over gpt-4o-mini, with keyword custom-responses that short-circuit the RAG path and turn-count / keyword / intent escalation rules.
- **Knowledge files** — PDF / DOCX / PPTX / XLSX / CSV / MD / TXT upload, parsed with adversarial-safe bounds (100MB extracted-text cap, encrypted-PDF reject, macro skip).
- **Stripe billing** — checkout → webhook → `profiles.subscription_status`; message + crawl + file-count quotas gated via idempotent atomic RPCs; reset on `invoice.paid`.
- **Legal, email, observability, CI** — `/privacy`, `/terms`, `/dpa`; transactional email via Resend (welcome, trial-ending, quota-warning, payment-failed); Sentry capture gated by `SENTRY_DSN`; three-job GitHub Actions workflow (static → unit → e2e).
- **Widget** — shadow-DOM chat UI with graceful degradation (402 → silent, 5xx → retry-with-timeout, escalation action renderers).

The system architecture is documented in `.factory/library/architecture.md`. Mission scope and boundaries live under `docs/mission/`.

## Setup

```bash
# Prerequisites: pnpm, Node 22+, Docker Desktop, Supabase CLI, git
pnpm install                 # also wires the pre-commit secret scan via prepare
supabase start               # spins up local Postgres + Auth + Storage
supabase status --output env # copy ANON/SECRET keys into .env.local
cp .env.example .env.local   # then fill in real keys (see below)
```

### Required environment variables

```bash
# Supabase (from `supabase status --output env`)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<PUBLISHABLE_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SECRET_KEY>

# OpenAI + Firecrawl (real keys for dev; tests stub these)
OPENAI_API_KEY=sk-...
FIRECRAWL_API_KEY=fc-...

# Stripe (test-mode in dev; webhook secret from `stripe listen`)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# App base URL (for Firecrawl webhooks + Stripe redirects)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional
UPSTASH_REDIS_REST_URL=...   # M8: persistent rate-limit store (prod only)
UPSTASH_REDIS_REST_TOKEN=...
SENTRY_DSN=https://...       # M8: observability — absent ⇒ Sentry disabled
RESEND_API_KEY=re_...        # M8: transactional email — absent ⇒ no-op
```

### Secrets

Never commit `.env.local`. The pre-commit hook at `.githooks/pre-commit` scans staged diffs for `sk_live_`, `whsec_`, private-key markers, etc. Production secrets live only in Vercel → Settings → Environment Variables; rotate a key there and redeploy.

## Running it

```bash
pnpm dev                         # Next.js dev server on :3000
cd widget && pnpm dev            # widget-only dev (optional; public/rubycrawl-loader.js is the prod artefact)
docker run -d -p 12111:12111 stripe/stripe-mock  # Stripe unit tests only
```

## Testing

```bash
# Unit + integration (Vitest) — full suite 649 passing / 1 skipped / 79 files
pnpm vitest run
pnpm test:coverage               # 80% line threshold on src/lib/**

# End-to-end (Playwright) — 72 tests across 11 specs
pnpm exec playwright test
pnpm exec playwright test e2e/<spec>.spec.ts --reporter=list  # single spec
```

Playwright requires the Supabase stack running (`supabase start`) and the env vars above. The test harness seeds users via the real `POST /auth/v1/signup` endpoint and cleans up via service-role in `afterEach`. Rate-limited routes (`/api/leads`, `/api/chat/session`) rotate `x-forwarded-for` per test to avoid the 1-req/3s-per-IP limit.

## Deploy

Target: Vercel. Production database + Storage: Supabase cloud project. Domain: configured via Vercel.

1. Push a tagged commit to `main` — CI runs static → unit → e2e gates.
2. Vercel auto-deploys. Set env vars in the Vercel dashboard (Settings → Environment Variables → Production).
3. In the Stripe dashboard, add the `/api/stripe/webhook` endpoint and set `STRIPE_WEBHOOK_SECRET` to the resulting `whsec_`.
4. In the Firecrawl dashboard, the crawl webhook URL is discovered dynamically from `NEXT_PUBLIC_APP_URL` — no extra config.
5. For production rate-limiting, create an Upstash Redis and set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. Absent ⇒ in-memory limiter (fine for staging, resets on cold start).
6. For production observability, set `SENTRY_DSN`. For transactional email, set `RESEND_API_KEY`.

## Layout

```
src/app/               # Next.js App Router — dashboard, marketing, /api routes
src/lib/               # crawl pipeline, files, chat, subscription, email, sentry
supabase/migrations/   # schema — append-only, YYYYMMDDHHMMSS_<desc>.sql
widget/                # standalone widget source; builds into public/rubycrawl-widget.js
public/rubycrawl-loader.js  # the owner's <script> tag points here
e2e/                   # Playwright specs + fixtures
src/__tests__/         # Vitest unit + integration
.factory/              # mission scaffolding (services.yaml, architecture, validation)
docs/mission/          # mission contract, features, assertions, handoffs
```

See `AGENTS.md` for coding conventions — TypeScript strict, no `any`, append-only migrations, TDD mandatory.
