# Path to Production SaaS — Master Plan

_Last updated: 2026-04-18. Owner: Brandon._

**Jump to appendices** → [A: Design system](#appendix-a--design-system-snapshot) · [B: UI spec per page](#appendix-b--ui-spec-per-new-page) · [C: UI conventions](#appendix-c--ui-conventions-to-adopt) · [D: Test infra](#appendix-d--test-infrastructure-to-add) · [E: Test matrix](#appendix-e--per-feature-test-matrix) · [F: CI workflow](#appendix-f--ci-workflow)

## Where we are (audit summary)

- **Stack**: Next.js 16 + React 19, Supabase (Postgres + pgvector + Auth), OpenAI (chat + embeddings), Firecrawl for crawling, Preact widget built with Vite, Vercel hosting.
- **Working end-to-end today**: email OTP login → single-URL crawl → embeddings → hybrid search → streamed chat → lead capture after 3 messages → CSV export.
- **Clear gaps** blocking production:
  1. `lib/subscription.ts` returns `{active: true}` unconditionally — **no billing gate**.
  2. No usage counters, no quota enforcement, no "messages remaining" visible to users.
  3. One site per user is enforced by `sites.user_id UNIQUE` — fine for now, but data isolation needs a full RLS pass before we take real money.
  4. No supplementary knowledge upload path.
  5. No custom-response / escalation configuration — system prompt is the only knob.
  6. No dogfooding — our own site isn't running the widget.
  7. `.env.local` is **not** in `.gitignore` (audit caught this). Potential secret leak — fix before anything else.
- **Good news**: schema already has `profiles.stripe_customer_id / stripe_subscription_id / subscription_status / trial_ends_at` and a `processed_stripe_events` table. Scaffolding is there.

---

## Phase 0 — Safety fixes (do first, same day)

- [ ] Add `.env.local`, `.env*.local` to `.gitignore`; `git rm --cached .env.local` if tracked; rotate any keys that leaked.
- [ ] Confirm no secrets in git history (`git log -p -- .env.local`); rotate OpenAI/Firecrawl/Supabase service key if exposed.
- [ ] Add `SECURITY.md` note that production envs live only in Vercel dashboard.

## Phase 1 — Data isolation audit (half day)

Goal: **no user can ever see another user's data**, even if app code has a bug.

- [ ] Re-read every RLS policy in `supabase/schema.sql`. Write a test migration that spins up two users and confirms cross-read returns zero rows for: `sites`, `pages`, `embeddings`, `leads`, `conversations`, `chat_sessions`, `supplementary_files` (new), `usage_counters` (new), `custom_responses` (new), `escalation_rules` (new).
- [ ] Add integration test `src/__tests__/rls-isolation.test.ts` that uses two anon JWTs and asserts 0 rows leak.
- [ ] Audit every server route: confirm it uses the **anon client with user's JWT** for user-owned queries and only uses the **service-role client** for: Firecrawl webhooks, Stripe webhooks, embedding writes. Grep for `serviceRoleClient` and document each use.
- [ ] Add `site_key` rotation endpoint (currently fixed at creation — a leaked key is forever).

## Phase 2 — Stripe billing (2–3 days)

**Decision needed from Brandon — see "Open questions" below.** Plan assumes tiered pricing.

### 2.1 Schema
```sql
create table plans (
  id text primary key,              -- 'starter' | 'pro' | 'scale'
  stripe_price_id text not null,
  monthly_message_limit int not null,
  monthly_crawl_page_limit int not null,
  supplementary_file_limit int not null,
  display_name text,
  price_cents int
);

-- Seed:
-- ('starter', <price_id>, 2000,  500,  25,  'Starter', 2499)
-- ('pro',     <price_id>, 7500,  1500, 100, 'Pro',     4999)
-- ('scale',   <price_id>, 25000, 5000, 500, 'Scale',   9900)

alter table profiles
  add column plan_id text references plans(id),
  add column current_period_start timestamptz,
  add column current_period_end timestamptz,
  add column cancel_at_period_end boolean default false;

create table usage_counters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  messages_used int default 0,
  crawl_pages_used int default 0,
  files_stored int default 0
);
```
- [ ] Write migration + seed three plans (Starter / Pro / Scale).
- [ ] RLS: users can read their own `usage_counters`; only service role writes.

### 2.2 Stripe wiring
- [ ] Install `stripe` SDK. Create products + prices in Stripe dashboard (test mode first), store price IDs in the `plans` table.
- [ ] `POST /api/stripe/checkout` → returns Checkout Session URL; takes `{plan_id}`.
- [ ] `POST /api/stripe/webhook` → verify signature, handle `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.paid`, `invoice.payment_failed`. Use the existing `processed_stripe_events` table for idempotency.
- [ ] `POST /api/stripe/portal` → Billing Portal session for card updates / cancel.
- [ ] Replace `lib/subscription.ts` stub with real check against `profiles.subscription_status ∈ ('trialing','active')` + period window.
- [ ] Rewrite `/dashboard/billing` to show: current plan, usage bars, next invoice date, "Manage billing" (portal) button, "Upgrade/Downgrade" buttons.
- [ ] Gate crawl start and chat session routes on `checkSubscription` — return 402 with plan-comparison payload if expired.

### 2.3 Testing
- [ ] Stripe CLI `stripe listen --forward-to localhost:3000/api/stripe/webhook` for local.
- [ ] Vitest covers webhook signature rejection, idempotency, trial→active transition, cancel→revoke gating.

## Phase 3 — Usage tracking / token meter (1 day, slots into Phase 2)

- [ ] Increment `usage_counters.messages_used` atomically in `/api/chat/session` **before** the LLM call. Use a Postgres RPC `increment_message_counter(user_id, limit)` that returns `{ok, used, limit}` so we can reject at the DB level.
- [ ] If over limit: return 402 with `{error: 'quota_exceeded', upgrade_url}`. Widget renders a polite upgrade prompt.
- [ ] Reset counters on `invoice.paid` webhook (set `period_start/end` to the new invoice period).
- [ ] Show "X / Y messages used this month" on `/dashboard` and `/dashboard/settings/billing`, with a progress bar. Live-update via Supabase Realtime on `usage_counters`.
- [ ] Enforce `crawl_pages_used` on crawl start; subtract actual pages on webhook completion.

## Phase 4 — Supplementary knowledge uploads (1–2 days)

User ask: drag-and-drop area in settings, up to 100 files per site.

- [ ] Supabase Storage bucket `knowledge-files`, RLS keyed on `auth.uid() = (storage.foldername(name))[1]::uuid` so every user has their own folder.
- [ ] Schema:
  ```sql
  create table supplementary_files (
    id uuid primary key default gen_random_uuid(),
    site_id uuid references sites(id) on delete cascade,
    filename text,
    storage_path text,
    bytes int,
    content_hash text,
    status text check (status in ('queued','processing','ready','failed')),
    error_message text,
    chunks_count int default 0,
    created_at timestamptz default now()
  );
  create unique index on supplementary_files(site_id, content_hash);
  ```
- [ ] UI: `/dashboard/settings/knowledge` — `react-dropzone`, list of uploaded files with status badge, delete button. Enforce 100-file cap client- and server-side.
- [ ] Supported types: **PDF, DOCX, PPTX, XLSX, CSV, TXT, MD**. Parsers: `pdf-parse`, `mammoth` (DOCX), `officeparser` or `pptx2json` (PPTX), `xlsx` (XLSX + CSV), native (TXT/MD). Extract text → reuse `chunkMarkdown` → embed → insert into `embeddings` with `source_type='file'` and `source_url='file://<filename>'`.
- [ ] Include file-sourced chunks in `match_chunks()` RPC (no schema change needed — already blends per site_id). Update citation rendering in the widget to show file names differently from URLs.
- [ ] Delete file → delete storage object, delete row, delete its embeddings; re-run atomic batch swap not needed since embeddings have `source_type`.

## Phase 5 — Custom responses + lead escalation (2 days)

User ask: FAQ-style overrides ("What time do you open?" → hardcoded answer) **and** escalation rules (after N turns, or on specific intents, capture the email / show a form).

### 5.1 Schema
```sql
create table custom_responses (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id) on delete cascade,
  trigger_type text check (trigger_type in ('keyword','intent')),
  triggers text[],                    -- keyword list OR intent labels
  response text not null,
  priority int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table escalation_rules (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id) on delete cascade,
  rule_type text check (rule_type in ('turn_count','keyword','intent','llm_lead_score')),
  config jsonb not null,              -- e.g. {turns: 3} or {keywords: ['price','quote']}
  action text check (action in ('ask_email','ask_phone','show_form','calendly_link','handoff')),
  action_config jsonb,
  is_active boolean default true,
  priority int default 0
);
```

### 5.2 Runtime
- [ ] In `/api/chat/session`, before embedding/LLM:
  1. Normalize the user message.
  2. Check `custom_responses` for keyword/intent hits. If match + high confidence → skip LLM, return canned response directly (still saves to conversation).
  3. Check `escalation_rules` — if turn count / keyword / intent threshold met, tag the session with `pending_action` and include an instruction in the system prompt ("end with: would you like us to follow up? Ask for their email.").
- [ ] Intent classification: small OpenAI call (`gpt-4o-mini`) returning JSON `{intent: 'pricing'|'hours'|'booking'|'complaint'|...}`. Cache per session.
- [ ] Widget: when stream finishes with a `pending_action` flag, render the matching form (email / phone / calendar).

### 5.3 Dashboard
- [ ] `/dashboard/settings/responses` — table editor: trigger, response, priority, active toggle. "Test" button that runs a sample message through the matcher.
- [ ] `/dashboard/settings/escalation` — rule builder: pick trigger (turns / keyword / intent), pick action. Drag-to-reorder priority.
- [ ] Defaults pre-seeded on site creation so new customers get a sensible starting set (e.g. "after 3 turns, ask for email"; "keyword: pricing → ask_email").

## Phase 6 — Settings sidebar restructure (half day)

Current `/dashboard/settings` is a single page. Split into a left-nav layout per user's ask:

```
/dashboard/settings
  ├── /site        (name, greeting, Calendly, Google Maps — existing)
  ├── /knowledge   (file uploads — Phase 4)
  ├── /responses   (custom responses — Phase 5)
  ├── /escalation  (lead escalation — Phase 5)
  ├── /branding    (widget color, logo, position — nice to have, post-MVP)
  ├── /team        (invites — explicitly deferred; single-user for now)
  └── /billing     (plan, usage, invoices — Phase 2)
```
- [ ] New `src/app/dashboard/settings/layout.tsx` with vertical sub-nav.
- [ ] Move existing settings into `/site` route.

## Phase 7 — Fresh start: wipe Brandon's account (15 min, on demand)

- [ ] Write `scripts/reset-my-data.sql` that deletes from `sites`, `pages`, `embeddings`, `leads`, `conversations`, `chat_sessions`, `supplementary_files`, `usage_counters`, `custom_responses`, `escalation_rules` WHERE `user_id = :brandon_id` (or via `site_id IN (SELECT id FROM sites WHERE user_id = :brandon_id)`).
- [ ] Run once Brandon confirms. Do **not** run automatically.
- [ ] Keep `profiles` row + Stripe subscription intact during wipe (only knowledge/data gets blown away).

## Phase 8 — Production hardening (ongoing, parallel with above)

- [ ] Move rate limiter from in-memory Map → Upstash Redis (`@upstash/ratelimit`). The current implementation resets every cold start on Vercel.
- [ ] Sentry for server + widget errors.
- [ ] Structured logging with request IDs (helpful for support).
- [ ] Add `robots.txt` + `sitemap.ts`.
- [ ] Legal pages: `/privacy`, `/terms`, `/dpa`. **Required** before Stripe will approve the account in most cases.
- [ ] Transactional email (Resend) for: welcome, trial ending in 3 days, quota warning at 80%, failed payment.
- [ ] CSP on widget: lock `frame-ancestors` and document-level CSP guidance for customers (already partially done in `/dashboard/embed`).
- [ ] Vercel monitoring + uptime check (Better Stack or similar).

## Phase 9 — Nice-to-haves (post-MVP, not blocking launch)

- Multi-site per account (today it's one, enforced by unique constraint).
- Team members / org invites.
- Analytics dashboard: chat volume, top questions, deflection rate.
- Webhook / Zapier out for new leads.
- White-label: custom widget domain per customer.
- iOS / Android SDKs.

---

## Suggested execution order & timeline

| Week | Phase | Why |
|------|-------|-----|
| 1 (this week) | 0, 1 | Close security holes; confirm no user can read another's data before we take money. |
| 1–2 | 2, 3 | Stripe + quotas — 10 customers landing this week need to be paying and metered. |
| 2 | 6, 4 | Sidebar restructure + file uploads (all 7 file types). |
| 2–3 | 5 | Custom responses + escalation. Highest net-new complexity; after Stripe is stable. |
| 3 | 8, 7 | Hardening, legal pages, email. Wipe Brandon's account on request. Ship. |

---

## Decisions (locked in 2026-04-18)

1. **Pricing — three tiers** (trial = 7 days, no annual discount in v1):

   | Plan | Price/mo | Messages | Crawl pages | Files | Est. margin |
   |---|---|---|---|---|---|
   | Starter | $24.99 | 2,000 | 500 | 25 | 82% |
   | Pro | $49.99 | 7,500 | 1,500 | 100 | 70% |
   | Scale | $99.00 | 25,000 | 5,000 | 500 | 50% |

   **Unit economics:** OpenAI avg cost/msg ≈ $0.0005 (gpt-4o-mini, 2k input + 250 output + query rewrite + embedding). Plan sized at **$0.001/msg** for 2× buffer. Firecrawl ≈ $0.005/page.

2. **Token meter** — count **chat messages answered** (simple, predictable for customers). Internal token-cost tracking via `usage_counters.openai_tokens_used` for monitoring margin drift — not exposed to the customer.

3. **No dogfood** — skipped.

4. **Wipe scope** — Brandon's account only, on demand (not automatic). Script `scripts/reset-my-data.sql` gated to a single `user_id`.

5. **File upload types** — PDF, DOCX, TXT, MD, PPTX, XLSX, CSV. Parsers: `pdf-parse`, `mammoth` (DOCX), `officeparser` or `pptx2json` (PPTX), `xlsx` (XLSX), native (TXT/MD/CSV).

6. **Escalation actions** — `ask_email`, `ask_phone`, `show_form`, `calendly_link`, `handoff` (human review in dashboard). No Slack / SMS in v1.

7. **Custom response matching** — keyword fast-path + intent-classifier fallback. Keyword hit bypasses LLM entirely (cheap & predictable). Intent fallback runs a small gpt-4o-mini classifier when no keyword matches and a custom response is configured for that intent.

---

## Review (filled in as we go)

_Nothing shipped yet. I'll append commit SHAs and notes here._

---

# Appendix A — Design system snapshot

_Current conventions — match these when building new UI. Source: audit 2026-04-18._

**Stack:** Next.js 16 · React 19 · Tailwind CSS 4 (via `@tailwindcss/postcss`) · Preact (widget only). **No** shadcn/ui, Radix, or Headless UI. Forms are native HTML + React state. Icons are a hand-rolled 15-icon SVG set at `src/components/icons.tsx` (16×16, stroke 1.6).

**Fonts:** Geist Sans + Geist Mono (Google Fonts, variable via `--font-geist-sans` / `--font-geist-mono`). Body defaults to `font-sans`; code uses `font-mono`. Eyebrow labels: `font-mono text-[10px] uppercase tracking-[0.16em]`.

**Color tokens** (all CSS custom properties, defined in `src/app/globals.css:12-73`, with auto dark-mode):

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--bg-canvas` | #fafaf9 | #0a0a0a | Page bg |
| `--bg-surface` | #ffffff | #111111 | Card fill |
| `--bg-subtle` | #f5f5f4 | #1a1a1a | Wells, hover |
| `--bg-inset` | #fafaf9 | #0f0f0f | Table stripes |
| `--ink-primary` | #0a0a0a | #fafaf9 | Headlines |
| `--ink-secondary` | #57534e | #a8a29e | Body |
| `--ink-tertiary` | #a8a29e | #57534e | Metadata |
| `--ink-disabled` | #d6d3d1 | #404040 | Disabled |
| `--border-hairline` | rgba(10,10,10,0.08) | rgba(255,255,255,0.08) | Subtle dividers |
| `--border-strong` | rgba(10,10,10,0.14) | rgba(255,255,255,0.14) | Strong borders |
| `--accent-success` / `-bg` | #047857 / #ecfdf5 | #34d399 / rgba(16,185,129,0.1) | Ready, check |
| `--accent-danger` / `-bg` | #b91c1c / #fef2f2 | #fca5a5 / rgba(185,28,28,0.15) | Errors |

**Utility classes** (in `globals.css`): `.btn-press` (active scale 0.975, 160ms), `.surface-hairline` (card border + fill), `.focus-ring` (2px outline, 2px offset), `.rc-enter` (420ms slide-up + fade), `.rc-pulse`, `.rc-shimmer`.

**Component patterns** (all inline, no library — copy these class strings verbatim):

```tsx
// Primary button (src/app/dashboard/page.tsx:41)
className="btn-press focus-ring rounded-lg bg-[color:var(--ink-primary)] px-4 py-2 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)]"

// Input (src/app/dashboard/settings/settings-client.tsx:95)
className="focus-ring block w-full rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-[14px] text-[color:var(--ink-primary)] placeholder:text-[color:var(--ink-tertiary)]"

// Card
className="surface-hairline rounded-xl p-6"

// Table (src/app/dashboard/leads/leads-client.tsx:77-164)
// container: surface-hairline rounded-xl overflow-hidden
// head row: border-b border-[color:var(--border-hairline)]
// cells: px-4 py-3, divide-y on tbody

// Pill / badge (src/app/dashboard/page.tsx:301)
className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"

// Empty state (src/app/dashboard/leads/leads-client.tsx:37-51)
// eyebrow (mono, uppercase, tracking) + h1 (3xl, semibold) + p (max-w-md, ink-secondary)
```

**Modal convention:** native HTML5 `<dialog>` with `.showModal()`, wrap in `.surface-hairline rounded-xl`. Already used in widget (`widget/src/widget.tsx:169-223`).

**No toast system today.** No form library. No validation library. See Appendix C for recommended adds.

---

# Appendix B — UI spec per new page

Each section lists: route · file · layout sketch · reuse vs. new · props · states · microcopy.

## B.1 `/dashboard/billing` — refactor (Phase 2)

- **File:** `src/app/dashboard/billing/page.tsx` (rewrite)
- **Layout:**
  ```
  ┌─ Heading: BILLING / "Your subscription."
  ├─ Plan card: name, status pill, price, next-invoice date, trial countdown (if trialing)
  │   └─ UsageMeterSet (messages / crawl-pages / files)
  │   └─ buttons: [Manage billing] [Upgrade] [Downgrade]
  └─ Invoices table (last 12, link to Stripe-hosted PDFs)
  ```
- **Reuse:** status-pill pattern (dashboard/page.tsx:301), card, button patterns.
- **Build:** `UsageMeterSet`, `PlanCard`, `TrialCountdown`.
- **Props:**
  ```ts
  interface BillingPageProps {
    plan: { id: string; name: string; price_cents: number; status: 'trialing'|'active'|'past_due'|'canceled' }
    usage: { label: string; current: number; max: number }[]
    nextInvoiceDate: string
    trialEndsAt?: string
  }
  ```
- **States:** success · skeleton-loading · error ("Unable to load billing. Refresh.") · trialing banner · past_due warning.
- **Microcopy:** "Your subscription is active." / "Trial ends in X days." / "Manage payment method and invoices in Stripe." / "Upgrade for more messages and pages."

## B.2 `/dashboard/settings` — new left-nav layout (Phase 6)

- **File:** `src/app/dashboard/settings/layout.tsx` (new). Move existing page content to `/settings/site`.
- **Layout:**
  ```
  Settings (h1)
  ┌─ sidebar (w-48)       │  page content
  │  Site ●               │
  │  Knowledge            │
  │  Responses            │
  │  Escalation           │
  │  Billing              │
  ```
- **Active state:**
  ```tsx
  className={isActive
    ? 'bg-[color:var(--bg-subtle)] text-[color:var(--ink-primary)]'
    : 'text-[color:var(--ink-secondary)] hover:bg-[color:var(--bg-subtle)]'}
  ```
- **Implementation:** use `usePathname()` + `<Link>`. Wrap children in `<main>` with `flex-1`.

## B.3 `/dashboard/settings/site` — moved (Phase 6)

- **File:** `src/app/dashboard/settings/site/page.tsx` (rename + move `settings-client.tsx` → `site/site-client.tsx`).
- **No behavior change.** Fields: site name, greeting, Calendly URL, Google Maps URL. Add: site-key rotation button + "Re-crawl now" button (calls `/api/crawl/retry`).

## B.4 `/dashboard/settings/knowledge` — new (Phase 4)

- **File:** `src/app/dashboard/settings/knowledge/page.tsx` (+ client component).
- **Layout:**
  ```
  Heading · "Upload & manage training documents"
  ┌─ DragDropZone (.pdf .docx .pptx .xlsx .csv .txt .md) "Drop files here or click to browse"
  │   hint: "Max 25MB per file"
  ├─ Meter: "3 / 100 files · 14MB / 250MB" (planSpecific)
  └─ File list:
     ├─ [filename]  [chip: Ready|Processing…|Failed|Queued]  [Delete / Retry]
     └─ ...
  ```
- **Build:** `DragDropZone`, `FileRow`, `StatusChip`, `StorageMeter`.
- **Status chips:**
  - queued → `--bg-subtle` + `--ink-tertiary`
  - processing → `--bg-subtle` + `--ink-primary` + rc-pulse spinner
  - ready → `--accent-success-bg` + `--accent-success` + check icon
  - failed → `--accent-danger-bg` + `--accent-danger` + alert icon
- **Props:**
  ```ts
  interface KnowledgePageProps {
    files: { id: string; filename: string; bytes: number; status: 'queued'|'processing'|'ready'|'failed'; created_at: string; error_message?: string }[]
    fileCount: number
    maxFiles: number // from plan
    onUpload: (files: File[]) => Promise<void>
    onDelete: (id: string) => Promise<void>
    onRetry: (id: string) => Promise<void>
  }
  ```
- **States:** empty ("No files yet. Drag documents here to train your chatbot."), uploading (per-file progress), full ("File limit reached. Delete files to upload more."), failed (retry button visible).

## B.5 `/dashboard/settings/responses` — new (Phase 5)

- **File:** `src/app/dashboard/settings/responses/page.tsx` (+ client).
- **Layout:** table of responses (trigger type · triggers as chips · response preview · priority · active toggle · test / edit). "+ Add response" button opens modal. Right-side "Test" drawer runs a sample message through the matcher.
- **Modal form fields:** trigger type (keyword | intent), triggers (chip input; keyword list OR intent labels), response text (textarea), priority (0-10), active toggle.
- **Test drawer:** sample message input → button `[Run]` → shows `Matched: yes/no`, matched rule, confidence (for intent).
- **Build:** `ResponseTable`, `ResponseModal`, `TestDrawer`, `ChipInput`.
- **Props:**
  ```ts
  type Response = {
    id: string
    trigger_type: 'keyword' | 'intent'
    triggers: string[]
    response: string
    priority: number
    is_active: boolean
  }
  ```
- **States:** empty ("No custom responses yet. Add one to override default answers."), editing, testing (spinner in drawer), test result (match/no match + confidence).

## B.6 `/dashboard/settings/escalation` — new (Phase 5)

- **File:** `src/app/dashboard/settings/escalation/page.tsx` (+ client).
- **Layout:** list of reorderable rule cards. Each card: drag handle · trigger summary ("After 3 turns" / "Keyword: pricing" / "Intent: complaint") · action pill · priority · active toggle · edit/delete.
- **Add/edit modal:** rule_type dropdown, config fields (conditional on rule_type), action dropdown (`ask_email` · `ask_phone` · `show_form` · `calendly_link` · `handoff`), action_config (conditional), priority, active.
- **Reorder:** HTML5 drag-drop (no new lib). Fallback: up/down arrow buttons.
- **Build:** `RuleCard`, `EscalationModal`, `RuleList`.
- **Props:**
  ```ts
  type EscalationRule = {
    id: string
    rule_type: 'turn_count' | 'keyword' | 'intent'
    config: { turns?: number; keywords?: string[]; intents?: string[] }
    action: 'ask_email' | 'ask_phone' | 'show_form' | 'calendly_link' | 'handoff'
    action_config: Record<string, unknown>
    priority: number
    is_active: boolean
  }
  ```
- **States:** empty ("No escalation rules yet. Defaults are active."), reordering (drag shadow), editing.
- **Microcopy:** "Rules run top-to-bottom by priority." · "First matching rule wins."

## B.7 `UsageMeterSet` — reusable (Phase 3)

- Appears on `/dashboard` overview and `/dashboard/settings/billing`.
- **Markup:**
  ```tsx
  <div className="space-y-3">
    {meters.map((m) => (
      <div key={m.label}>
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium text-[color:var(--ink-secondary)]">{m.label}</span>
          <span className="font-mono text-[color:var(--ink-tertiary)]">{m.current} / {m.max}</span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-[color:var(--bg-subtle)] overflow-hidden">
          <div className="h-full bg-[color:var(--accent-success)]"
               style={{ width: `${Math.min(100, (m.current / m.max) * 100)}%` }} />
        </div>
      </div>
    ))}
  </div>
  ```
- Live-updates via Supabase Realtime on `usage_counters`.

## B.8 Widget-side escalation UI — 5 action types (Phase 5)

Rendered inline below chat messages when the server attaches a `pending_action` to the stream finish event. File: extend `widget/src/widget.tsx`.

- **ask_email:** `<form>` with email input + "Send" button → POST `/api/leads` with `source='escalation'`.
- **ask_phone:** `<form>` with `type=tel` input + "Request call" → POST `/api/leads` with phone field.
- **show_form:** dynamic fields from `action_config.fields[]` (name, phone, message, etc.) → POST `/api/leads` with the payload.
- **calendly_link:** inline `<iframe>` to `action_config.url` at 100% × 600px.
- **handoff:** animated dots + message ("A team member will be with you shortly.") + the conversation gets flagged `needs_human=true` in DB so it shows in dashboard.

Widget styles live in the shadow DOM — reuse the existing `.rc-*` prefixed classes and add `.rc-escalation`.

---

# Appendix C — UI conventions to adopt

New additions (none currently exist in the codebase):

1. **Toast system:** `sonner` (~2.8KB gz, SSR-friendly, single provider in root layout). Use `toast.success()`, `toast.error()`, `toast.loading()` for post-action feedback (save, upload, delete, billing events).
2. **Form validation:** `zod` schemas + `react-hook-form` for the two complex new forms (responses modal, escalation modal). Keep simple forms (settings/site) as plain HTML state.
3. **Drag-and-drop:** `react-dropzone` for the knowledge page. Very small; no other option comes close on UX.
4. **Empty state:** lock the existing convention (eyebrow + h1 + paragraph, `rc-enter` animation) — see `src/app/dashboard/leads/leads-client.tsx:37-51`.

Do not add: a component library (shadcn, MUI, Radix). The app's hand-rolled style is its brand; matching it for 7 new pages is cheaper than refactoring 14 existing ones.

---

# Appendix D — Test infrastructure to add

**Current state:** 13 Vitest files in `src/__tests__/`, all mock-based. No Supabase harness, no Stripe mock, no Playwright, no CI workflow, no coverage reporter.

### D.1 Supabase test harness (required for RLS isolation tests)

Use the **Supabase CLI local project** (Docker-based). Justification: RLS policies can't be mocked — they live in Postgres. We need real JWT authentication against real policies.

```bash
supabase start                   # local postgres + auth on :54321/:54322
pnpm add -D @supabase/supabase-js
```

Add `src/__tests__/helpers/supabase.ts`:
```ts
export async function createTestUser(email: string): Promise<{ userId: string; jwt: string }> { /* ... */ }
export function clientAs(jwt: string) { /* returns supabase client with Bearer */ }
export async function truncateUserData() { /* truncates tables in dependency order via service role */ }
```

`vitest.config.ts`:
```ts
setupFiles: ['./src/__tests__/helpers/setup.ts']
```

Set `setup.ts` to `beforeEach` truncate user-owned tables. Gate these tests with `describe.skipIf(!process.env.SUPABASE_URL)` so they don't run when the local stack is down.

### D.2 Stripe testing

- `stripe-mock` (docker image) on `localhost:12111` for unit tests: `new Stripe('sk_test_x', { host: 'localhost:12111' })`.
- Stripe CLI for local webhook dev: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
- Signature verification is local crypto (no network needed): `Stripe.webhooks.constructEvent(rawBody, sig, secret)` — test valid, invalid, expired, replayed signatures directly.

### D.3 Playwright E2E

```bash
pnpm add -D @playwright/test
pnpm exec playwright install --with-deps chromium
```

`playwright.config.ts`:
```ts
export default defineConfig({
  testDir: './e2e',
  webServer: { command: 'pnpm dev', port: 3000, reuseExistingServer: true },
  use: { trace: 'on-first-retry', baseURL: 'http://localhost:3000' },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
})
```

Stub external services via `page.route`:
```ts
await page.route('**/api.openai.com/**', (r) => r.fulfill({ status: 200, body: MOCK_STREAM }))
await page.route('**/api.firecrawl.dev/**', (r) => r.fulfill({ status: 200, body: JSON.stringify({ id: 'job_123' }) }))
```

### D.4 Adversarial helpers

- `fast-check` for property tests (quota atomicity under N parallel writes).
- `pdf-lib` to craft malicious PDFs (huge compression, embedded scripts).
- Hand-rolled SSRF filter (reject `127.0.0.1`, `localhost`, `169.254.*`, `::1`, private ranges) — no lib needed.

### D.5 Coverage

```bash
pnpm add -D @vitest/coverage-v8
```

```ts
// vitest.config.ts
coverage: {
  provider: 'v8',
  include: ['src/lib/**', 'src/app/api/**'],
  exclude: ['src/__tests__/**', '**/*.d.ts'],
  thresholds: { lines: 80, functions: 80 },
  reporter: ['text', 'html'],
}
```

---

# Appendix E — Per-feature test matrix

Priority: **P0** = blocks merge · **P1** = blocks launch · **P2** = nice-to-have.

## E.1 RLS isolation (Phase 1)

| Test | Type | File | Priority | Notes |
|---|---|---|---|---|
| Cross-user read blocked on `sites` | Integration | `__tests__/rls-sites.test.ts` | P0 | Two JWTs; user B selects user A's site → 0 rows |
| Cross-user read blocked on `embeddings` | Integration | `__tests__/rls-embeddings.test.ts` | P0 | RLS chains via `site_id → user_id` |
| Cross-user read blocked on `pages` / `leads` / `conversations` | Integration | `__tests__/rls-cascades.test.ts` | P0 | Loop over tables |
| Widget read-via-site_key works | Integration | `__tests__/rls-widget.test.ts` | P0 | Anon JWT + valid site_key → rows |
| Widget site_key spoofing rejected | Adversarial | `__tests__/rls-widget.test.ts` | P1 | Wrong site_key → 0 rows |
| Service role bypasses RLS intentionally | Integration | `__tests__/rls-bypass.test.ts` | P1 | Confirm admin client still works |
| Leads insert/select isolation | Integration | `__tests__/rls-leads.test.ts` | P0 | Widget can insert, only owner can read |
| 50 parallel cross-user reads | Integration | `__tests__/rls-concurrent.test.ts` | P2 | No cross-pollution under load |

## E.2 Stripe billing (Phase 2)

| Test | Type | File | Priority | Notes |
|---|---|---|---|---|
| POST `/api/stripe/checkout` returns session URL | Unit | `__tests__/stripe-checkout.test.ts` | P0 | |
| Webhook valid signature accepted | Unit | `__tests__/stripe-webhook-sig.test.ts` | P0 | |
| Webhook invalid signature rejected (400) | Unit | `__tests__/stripe-webhook-sig.test.ts` | P0 | |
| Webhook expired timestamp rejected | Adversarial | `__tests__/stripe-webhook-sig.test.ts` | P1 | >5m old → reject |
| Handle `checkout.session.completed` | Integration | `__tests__/stripe-events.test.ts` | P0 | Sets `stripe_subscription_id`, `status='active'`, plan_id |
| Handle `customer.subscription.updated` | Integration | `__tests__/stripe-events.test.ts` | P0 | Syncs period dates + status |
| Handle `customer.subscription.deleted` | Integration | `__tests__/stripe-events.test.ts` | P0 | `status='canceled'` + revokes gate |
| Handle `invoice.paid` | Integration | `__tests__/stripe-events.test.ts` | P0 | Resets `usage_counters` period |
| Handle `invoice.payment_failed` | Integration | `__tests__/stripe-events.test.ts` | P0 | `status='past_due'` |
| Idempotency: duplicate event processed once | Integration | `__tests__/stripe-idempotency.test.ts` | P0 | Uses `processed_stripe_events` |
| Subscription gate: trialing allowed | Integration | `__tests__/stripe-gates.test.ts` | P0 | Chat + crawl routes work |
| Subscription gate: past_due blocks chat | Integration | `__tests__/stripe-gates.test.ts` | P0 | 402 response |
| Subscription gate: canceled blocks chat | Integration | `__tests__/stripe-gates.test.ts` | P0 | 402 response |
| Customer portal returns redirect URL | Unit | `__tests__/stripe-portal.test.ts` | P1 | |
| Plan upgrade mid-cycle (proration) | Integration | `__tests__/stripe-upgrade.test.ts` | P1 | |
| Plan downgrade mid-cycle (credit) | Integration | `__tests__/stripe-upgrade.test.ts` | P1 | |
| E2E: checkout → webhook → gate lifts | E2E | `e2e/billing-checkout.spec.ts` | P0 | stripe-mock + Playwright |

## E.3 Usage quotas (Phase 3)

| Test | Type | File | Priority | Notes |
|---|---|---|---|---|
| Atomic increment via RPC | Unit | `__tests__/quota-rpc.test.ts` | P0 | `increment_message_counter` returns `{ok, used, limit}` |
| Concurrent requests: exactly N succeed when budget=N | Adversarial | `__tests__/quota-concurrent.test.ts` | P0 | `fast-check` + 20 parallel writes |
| Last-slot race: exactly 1 wins | Adversarial | `__tests__/quota-concurrent.test.ts` | P1 | 3 parallel at budget=1 |
| 402 response includes `upgrade_url` | Unit | `__tests__/quota-response.test.ts` | P0 | |
| `invoice.paid` resets counter + rolls period | Integration | `__tests__/quota-reset.test.ts` | P0 | Via Stripe webhook |
| Duplicate `invoice.paid` only resets once | Integration | `__tests__/quota-reset.test.ts` | P1 | Idempotency |
| Crawl-page quota gate on `/api/crawl/start` | Integration | `__tests__/quota-crawl.test.ts` | P0 | Blocks before Firecrawl call |
| Plan caps synced on upgrade/downgrade | Integration | `__tests__/quota-plans.test.ts` | P1 | |
| Live meter updates via Realtime | E2E | `e2e/usage-live.spec.ts` | P2 | |

## E.4 File uploads (Phase 4)

| Test | Type | File | Priority | Notes |
|---|---|---|---|---|
| PDF happy path | Integration | `__tests__/uploads-pdf.test.ts` | P0 | Extract → chunk → embed → status=ready |
| DOCX happy path | Integration | `__tests__/uploads-docx.test.ts` | P0 | via `mammoth` |
| PPTX happy path | Integration | `__tests__/uploads-pptx.test.ts` | P0 | via `officeparser` |
| XLSX happy path | Integration | `__tests__/uploads-xlsx.test.ts` | P0 | via `xlsx`, sheet-aware chunking |
| CSV happy path | Integration | `__tests__/uploads-csv.test.ts` | P0 | |
| TXT / MD happy path | Unit | `__tests__/uploads-text.test.ts` | P0 | |
| 100-file cap enforced server-side | Integration | `__tests__/uploads-caps.test.ts` | P0 | 101st → 413 |
| 25MB size cap enforced | Integration | `__tests__/uploads-caps.test.ts` | P0 | Via `Content-Length` + stream abort |
| Content-hash dedupe | Integration | `__tests__/uploads-dedup.test.ts` | P0 | Same file twice → single row |
| Delete cascades embeddings | Integration | `__tests__/uploads-cascade.test.ts` | P0 | |
| Status transitions queued→processing→ready | Integration | `__tests__/uploads-status.test.ts` | P0 | |
| ZIP bomb rejected | Adversarial | `__tests__/uploads-bombs.test.ts` | P1 | 1MB zip → 5GB decompressed |
| PDF bomb rejected | Adversarial | `__tests__/uploads-bombs.test.ts` | P1 | Decompressed stream > 100MB → reject |
| DOCX with macros: macros stripped | Adversarial | `__tests__/uploads-adversarial.test.ts` | P1 | mammoth drops them |
| Embedded URL in PDF not fetched | Adversarial | `__tests__/uploads-adversarial.test.ts` | P1 | We never resolve links |
| Path traversal in filename sanitized | Adversarial | `__tests__/uploads-adversarial.test.ts` | P1 | `../../etc/passwd` → `_etc_passwd` |
| MIME spoofing detected via magic bytes | Adversarial | `__tests__/uploads-adversarial.test.ts` | P1 | `.exe` with `application/pdf` header → reject |
| 0-byte file rejected | Adversarial | `__tests__/uploads-adversarial.test.ts` | P1 | Clear error message |
| Non-UTF8 CSV handled | Adversarial | `__tests__/uploads-adversarial.test.ts` | P1 | Detect encoding or reject |
| Encrypted PDF with owner password rejected | Adversarial | `__tests__/uploads-adversarial.test.ts` | P1 | |
| E2E: upload → status live-updates → chat cites it | E2E | `e2e/knowledge-upload.spec.ts` | P0 | |

## E.5 Custom responses + escalation (Phase 5)

| Test | Type | File | Priority | Notes |
|---|---|---|---|---|
| Keyword matcher: case-insensitive | Unit | `__tests__/responses-matcher.test.ts` | P0 | |
| Keyword matcher: word boundaries | Unit | `__tests__/responses-matcher.test.ts` | P0 | `help` ≠ `helper` |
| Keyword matcher: diacritic-insensitive | Unit | `__tests__/responses-matcher.test.ts` | P0 | `café` = `cafe` |
| Priority tiebreaker | Unit | `__tests__/responses-matcher.test.ts` | P0 | |
| Intent classifier: deterministic w/ mocked LLM | Integration | `__tests__/responses-intent.test.ts` | P0 | |
| Intent uses conversation history | Integration | `__tests__/responses-intent.test.ts` | P1 | |
| Keyword hit bypasses LLM entirely | Integration | `__tests__/responses-fastpath.test.ts` | P0 | No OpenAI call recorded |
| Escalation trigger: turn count | Integration | `__tests__/escalation.test.ts` | P0 | |
| Escalation trigger: keyword | Integration | `__tests__/escalation.test.ts` | P0 | |
| Escalation trigger: intent | Integration | `__tests__/escalation.test.ts` | P0 | |
| `pending_action` plumbed through stream | Integration | `__tests__/escalation-stream.test.ts` | P0 | Widget receives it |
| First-matching-rule-by-priority wins | Unit | `__tests__/escalation.test.ts` | P1 | |
| Adversarial: prompt injection in custom response | Adversarial | `__tests__/responses-adversarial.test.ts` | P1 | "Ignore previous instructions" → sandboxed |
| Adversarial: XSS in response template | Adversarial | `__tests__/responses-adversarial.test.ts` | P1 | `<script>` HTML-escaped in widget |
| Adversarial: SQL-injection-shaped keyword safe | Adversarial | `__tests__/responses-adversarial.test.ts` | P1 | Parameterized queries |
| Cross-site response leak blocked by RLS | Integration | `__tests__/responses-rls.test.ts` | P0 | Site A's rules invisible to site B |
| E2E: create rule → trigger in widget → email form renders | E2E | `e2e/escalation.spec.ts` | P0 | |

---

# Appendix F — CI workflow

`.github/workflows/test.yml`:

```yaml
name: Tests
on: [push, pull_request]

jobs:
  unit-integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: supabase/postgres:15.1.0.117
        env: { POSTGRES_PASSWORD: postgres }
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm vitest run --coverage
        env:
          SUPABASE_URL: http://localhost:54321
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_TEST_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_TEST_SERVICE_KEY }}
          STRIPE_SECRET_KEY: sk_test_mock
          OPENAI_API_KEY: sk-test-mock
      - uses: codecov/codecov-action@v4

  e2e:
    runs-on: ubuntu-latest
    needs: unit-integration
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm exec playwright test
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: playwright-report, path: playwright-report/ }
```

**Time budget:** lint+typecheck ~30s · unit/integration ~3min · E2E ~5min · **total ~8min per PR.**

**Gates:** coverage ≥ 80% on `src/lib/**`; all P0 tests must pass to merge.
