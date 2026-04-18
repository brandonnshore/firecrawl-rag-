# Mission: firecrawl-rag- → Production SaaS (prod-saas)

_Created: 2026-04-18. Owner: Brandon Shore._

## Relationship to prior work

This is a **follow-on mission** that builds on the MVP mission executed 2026-04-13 (see `docs/plans/2026-04-13-feat-rubycrawl-saas-mvp-plan.md` and `docs/execution/M2-…M5-…md`). That mission produced the working product: auth, schema, crawl pipeline, RAG chat, widget, and dashboard shell. Foundation milestone was sealed (4 passed / 1 failed / 7 blocked — auth assertions blocked by Supabase OTP rate-limiting during validation, deferred by orchestrator override to `dashboard-polish`).

This mission picks up from there. **Inherited and handled in M1**: the 7 blocked auth assertions (`VAL-AUTH-002/003/005/007/008/009/010`) and the 1 failed (`VAL-AUTH-003`) — all re-validated using pre-seeded sessions to bypass the OTP rate-limit issue. The one failure (magic-link callback landing on `/login?error=auth_callback_error`) is treated as a real bug and gets a fix feature in M1.

Existing `.factory/library/*.md` describes the as-built MVP and is authoritative — this mission does not overwrite it, it extends. New subsystems (billing, quotas, uploads, responses, escalation) get new library files added as they land.

## What we are building

Taking the existing Next.js + Supabase + Firecrawl + OpenAI RAG chatbot product from "working prototype" to "production SaaS" capable of taking paying customers. The current product crawls a customer's website, embeds pages into pgvector, and serves a Preact chat widget that a customer drops on their site. It works end-to-end for a demo but is missing: billing, enforced quotas, file-upload knowledge, custom responses, lead-escalation rules, a restructured settings UI, and production hardening.

## Success definition

Mission is complete only when **every behavioral assertion in `validation-contract.md` has status `"passed"` in `validation-state.json`**, with evidence (screenshots, curl output, DB queries) archived in `.factory/validation/`. Nothing short of that is "done."

## Scope additions (2026-04-18, post-initial-scoping)

Three features added after contract v1.0, folded into existing milestones:

- **Terms-of-service acceptance at signup** — checkbox linked to `/terms`, stored on `profiles.tos_accepted_at`. Blocks account creation without it. Lives in M4 (settings-sidebar milestone since it touches auth UI conventions, though the UX lives on `/login`).
- **Graceful widget degradation** — when the API is unreachable (5xx, network failure, timeout), the widget bubble hides instead of showing errors on the customer's site. Lives in M8.
- **GDPR account deletion** — self-serve "Delete my account" in `/dashboard/settings/site` that cancels Stripe subscription, wipes all user-scoped data including `profiles` + auth.user, and invalidates the session. Required before EU customer onboarding. Lives in M8.

Contract grew from 144 → 154 assertions, features.json 40 → 43.

## Scope — included

- Stripe billing: 3 tiers (Starter $24.99 / Pro $49.99 / Scale $99), checkout, webhook, customer portal, real subscription gates.
- Usage quotas: monthly message counter, crawl-page counter, file counter. Enforced server-side. Live meter on dashboard. Reset on `invoice.paid`.
- Supplementary file uploads: PDF, DOCX, PPTX, XLSX, CSV, TXT, MD. Per-plan caps. Dedupe by content hash. Embedded alongside crawled pages in RAG retrieval.
- Custom responses: keyword fast-path + LLM intent fallback. Keyword hit skips the main LLM call.
- Lead escalation: rules with triggers (`turn_count` | `keyword` | `intent`) → actions (`ask_email` | `ask_phone` | `show_form` | `calendly_link` | `handoff`). First-matching-rule-by-priority wins.
- Settings restructure: left sub-nav (`/settings/site` · `/knowledge` · `/responses` · `/escalation` · `/billing`).
- RLS isolation: cross-user integration tests on every user-scoped table. Site-key spoofing rejected.
- Fresh-start script: wipe Brandon's own test data on demand.
- Production hardening: Upstash rate limiter (replacing in-memory), Sentry, legal pages (`/privacy`, `/terms`, `/dpa`), transactional email (Resend), CI workflow.

## Scope — explicitly excluded (post-MVP)

- Multi-site per account. Today: one site per user, enforced by `sites.user_id` UNIQUE.
- Team members / organization invites.
- Analytics dashboard (chat volume, deflection rate, top questions).
- Zapier / webhook outbound for new leads.
- White-label widget on custom customer domain.
- Mobile SDKs (iOS / Android).
- Slack / SMS notifications on escalation (Brandon explicitly ruled out).

## Milestones

Vertical slices. Each is independently demo-able and ships through the full validation cycle (TDD → scrutiny → user testing → sealed).

| # | Milestone | Depends on | Areas it touches |
|---|---|---|---|
| **M1** | `foundation-rls` | — | Test infra (Supabase CLI, Playwright, stripe-mock, coverage). RLS cross-user isolation tests across all user-scoped tables. `.env.local` audit. Site-key rotation endpoint. |
| **M2** | `billing-stripe` | M1 | `plans` table + seed. Stripe checkout, webhook, customer portal. Replace `lib/subscription.ts` stub. Refactor `/dashboard/billing`. Subscription gate on chat + crawl routes. |
| **M3** | `quota-meter` | M2 | `usage_counters` table + RPC. Message counter atomic increment + 402 response. Crawl-page counter on `/api/crawl/start`. `UsageMeterSet` component. Reset on `invoice.paid`. Live Realtime updates. |
| **M4** | `settings-sidebar` | M2 (billing page exists) | Refactor `/dashboard/settings` into left-nav layout with `/site`, `/knowledge`, `/responses`, `/escalation`, `/billing` sub-routes. Move existing settings page to `/site`. Add toast system (sonner). Done before M5–M7 because they mount under this layout. |
| **M5** | `knowledge-uploads` | M3, M4 | Supabase Storage bucket with per-user RLS. `supplementary_files` table. Parsers for all 7 file types. Embedding pipeline integration. Drag-drop UI + file list. Per-plan file caps enforced. |
| **M6** | `custom-responses` | M4 | `custom_responses` table. Keyword matcher (case/diacritic/word-boundary). Intent classifier (LLM, cached per session). Fast-path bypass of main LLM when keyword hits. Table editor + test drawer UI. |
| **M7** | `escalation` | M4, M6 (shares matcher infra) | `escalation_rules` table. Runtime trigger evaluation (turn_count / keyword / intent). `pending_action` plumbed through chat stream to widget. 5 widget-side action UIs (email / phone / form / calendly / handoff). Reorderable rule cards. |
| **M8** | `hardening-launch` | all | Upstash rate limiter. Sentry. Legal pages. Transactional email (welcome, trial-ending, quota-80%, payment-failed). CI workflow. Fresh-start wipe script. Final smoke of every assertion. |

**Fresh-start wipe** (Brandon's ask to "just wipe my account") is a script inside M8, run once before Brandon starts real-customer use, not a milestone by itself.

## Testing strategy

- **Unit**: Vitest, jsdom, mocked boundaries. Target 80% lines on `src/lib/**`.
- **Integration**: Vitest + real local Supabase (via `supabase start` CLI) for RLS & quota atomicity. `stripe-mock` + signed replay tests for Stripe.
- **E2E**: Playwright against `pnpm dev` with stubbed external services (`page.route('**/api.openai.com/**', ...)` etc.). One E2E per critical journey per milestone.
- **Adversarial**: `fast-check` (quota races), `pdf-lib` (malicious PDFs), crafted zip bombs, path traversal, prompt injection, site-key spoofing. Explicit adversarial row in every feature's test matrix.
- **Manual user testing per milestone**: Playwright-driven or manual browser pass executing each assertion's described flow. Screenshots to `.factory/validation/{milestone}/evidence/`.

Parallelism: 2–4 Vitest workers (CPU-aware). Playwright: 1 worker (serial) for stability; each spec cleans up.

## Infrastructure & boundaries

- **Ports**: `3000` = Next.js dev, `54321` = Supabase API (local), `54322` = Supabase DB (local), `54323` = Supabase Studio (local), `12111` = stripe-mock.
- **External services in test**: all stubbed via Playwright `page.route` or `stripe-mock`. No calls to real OpenAI / Firecrawl / Stripe from CI.
- **Secrets**: `.env.local` (git-ignored, confirmed — see Appendix A in `tasks/todo.md`). Production secrets live only in Vercel dashboard.
- **Off-limits**: no force-pushes to `main`. No `--no-verify`. No disabling tests to get green. Brandon's Stripe live mode keys live only in Vercel — never in `.env.local`.

## Artifacts

This mission owns:
- `docs/mission/mission.md` (this file)
- `docs/mission/validation-contract.md` — ~150 behavioral assertions
- `docs/mission/validation-state.json` — pass/fail tracker
- `docs/mission/features.json` — ~40 features, 100% assertion coverage
- `docs/mission/AGENTS.md` — boundaries & conventions for work on this mission
- `docs/mission/handoffs/*.json` — per-feature completion records
- `.factory/init.sh` — idempotent environment setup
- `.factory/services.yaml` — commands & services manifest
- `.factory/library/architecture.md` — system architecture
- `.factory/library/environment.md` — env vars & external services
- `.factory/library/user-testing.md` — testing surface & tools
- `.factory/research/*.md` — technology research (Stripe SDK, Supabase RLS, file parsers, etc.)
- `.factory/validation/{milestone}/scrutiny/synthesis.json` — scrutiny reports
- `.factory/validation/{milestone}/user-testing/synthesis.json` — user-testing reports
- `.factory/validation/{milestone}/evidence/*.png` — screenshots

The existing `tasks/todo.md` becomes a human-readable executive summary; `docs/mission/` is the machine-readable source of truth.

## End-of-mission gate

Mission complete only when ALL of:
- Every assertion in `validation-state.json` has status `"passed"`.
- Full Vitest suite passes (unit + integration).
- Playwright E2E passes.
- `pnpm typecheck`: zero errors.
- `pnpm lint`: clean.
- No features with `status: "pending"` or `"in_progress"`.
- No untracked discovered issues.
- `README.md` updated with setup / run / test instructions.
- No secrets in committed code.

If any assertion is not `"passed"`, mission is NOT complete. Fix features are created and the relevant milestone's user-testing pass is re-run.
