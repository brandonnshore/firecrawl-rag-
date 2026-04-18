# Mission AGENTS.md — Boundaries & Conventions

_This file governs **mission work**. Repo-root `AGENTS.md` governs **codebase conventions** (Next.js version, etc.) and is still authoritative for code style. Nothing here overrides it._

---

## Mission boundaries (NEVER VIOLATE)

1. **No force-push to `main`.** Ever.
2. **No `--no-verify`, `--no-gpg-sign`, or test skips to get green.** If a hook fails, investigate the hook. If a test fails, fix the bug.
3. **No `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` to suppress warnings.** Fix the underlying problem. If there's a genuine reason, the suppression comment must include a `// TODO(mission-fix):` that becomes a tracked fix feature.
4. **Never bypass Supabase RLS with the service-role key** except at the documented server-only boundaries: Firecrawl webhook, Stripe webhook, embedding writes, knowledge-file processing. Every new service-role use must be justified in the feature's handoff record.
5. **Never commit `.env.local`** or any file containing secrets. Always review `git diff --cached` for API keys before committing.
6. **Never modify a sealed milestone.** Once M_N's scrutiny + user-testing both pass, add new work to M_{N+1} or a `misc-*` milestone.
7. **Never add to `features.json` without updating `validation-state.json`.** Coverage invariant: every assertion claimed by exactly one feature's `fulfills`.
8. **Never touch Brandon's production Stripe account from test code.** All Stripe calls in tests go through `stripe-mock` (`localhost:12111`) or Stripe test mode keys (`sk_test_...`), never live keys.

---

## Coding conventions (in addition to repo-root AGENTS.md)

- **TypeScript strict mode**, no `any`. Prefer discriminated unions over broad types.
- **No mocking internal modules**. Mock only external boundaries (Supabase client, OpenAI, Firecrawl, Stripe). Mocking `@/lib/*` defeats the purpose of tests.
- **All API routes** start with an auth check (except widget endpoints that use `site_key`). Use a shared `withAuth` helper if one emerges — don't hand-roll the check per route.
- **All user-supplied URLs** go through `validateUrl` (SSRF filter: reject `127.0.0.1`, `localhost`, `169.254.*`, `::1`, private ranges).
- **All user-supplied file uploads** are validated by magic-byte sniff, not just MIME header.
- **All chat-message rendering in the widget** is HTML-escaped. Custom response templates are treated as plain text, not HTML.
- **Every feature's tests live at `src/__tests__/<kebab-id>.test.ts`** matching the feature's `id`. E2E lives at `e2e/<kebab-id>.spec.ts`.
- **Database migrations** are append-only files in `supabase/migrations/` named `YYYYMMDDHHMMSS_<description>.sql`. Never edit a past migration — add a new one.

---

## Testing guidance

- **TDD is mandatory.** Tests are written before implementation. Red → green. If tests pass before code exists, the test is wrong.
- **Tests must be deterministic.** No reliance on wall-clock time (use `vi.useFakeTimers()`). No real network. No shared mutable state between tests.
- **Local Supabase required** for RLS tests: `supabase start` before running. Tests gated by `describe.skipIf(!process.env.SUPABASE_URL)` so CI can run both local-DB and mock-only subsets.
- **Playwright stubs external services via `page.route`.** Never run E2E against real OpenAI / Firecrawl / live Stripe.
- **Evidence collection in user-testing is mandatory.** Screenshots before and after each assertion's user action. Named `{VAL-ID}-{stage}.png`. Save to `.factory/validation/{milestone}/evidence/`.

---

## Handoff discipline

- After every feature, write `docs/mission/handoffs/<feature-id>.json` per the schema in `07-issue-tracking-handoffs.md`.
- Handoff records are committed alongside the feature's code.
- Any issue discovered during implementation that isn't blocking the current feature → create a fix feature in `features.json` (at TOP if security, otherwise in the current or next milestone's position).

---

## Environment

- Dev server: `pnpm dev` on port 3000. Check with `curl -sf http://localhost:3000`.
- Supabase local: `supabase start` (Docker required). API on :54321, DB on :54322.
- Widget dev: `cd widget && pnpm dev` for widget-only work.
- Stripe mock: `docker run -d -p 12111:12111 stripe/stripe-mock`.

See `.factory/library/environment.md` for env var details, `.factory/services.yaml` for commands.

---

## Escalation to user (Brandon)

Stop and escalate when:
- An external service (Supabase, Stripe, Firecrawl, OpenAI) is down and blocks progress.
- API credentials are invalid/expired.
- A requirement is ambiguous and affects architecture (not just an implementation detail).
- Scope has grown meaningfully beyond the mission — e.g., a requested change would require a new milestone.
- The fresh-start wipe script is ready to run (destructive — requires explicit Brandon OK).
- A milestone needs sealing and validation is complete — confirm Brandon accepts before sealing.

When escalating: state the blocker, what was tried, what Brandon needs to do, what happens after unblock.

---

## Known pre-existing issues

- `lib/subscription.ts` stub: always returns `{active: true}`. **This mission's M2 replaces it.** Do not treat as a bug until M2.
- Widget rate limiter is in-memory — resets on Vercel cold starts. **M8 replaces with Upstash.**
- No CI workflow exists. **M1 adds `.github/workflows/test.yml`.**
- `ioredis` is in `package.json` but unused. Remove as part of M8 cleanup.

Do not fix these outside their milestone — they'd skip validation.
