# User Testing

Testing surface, required testing skills/tools, and resource cost classification.

## Validation Surface

### Browser (agent-browser)
- **What:** All dashboard pages, auth flows, crawl status UI, chatbot preview, embed instructions, leads/conversations views
- **Setup:** Next.js dev server on port 3000
- **Auth:** Magic link flow (Supabase sends email — may need to check Supabase logs or use test accounts)
- **Notes:** Dashboard requires authenticated session. Widget test page at localhost:3000/test-widget.html

### API (curl)
- **What:** Chat session/stream endpoints, lead capture, crawl start, crawl webhook, leads export
- **Setup:** Next.js dev server on port 3000
- **Auth:** Some endpoints use site_key (public), others require Supabase JWT
- **Notes:** Chat uses two-step pattern (POST session -> GET stream). Widget CORS headers must be present.

### Widget (agent-browser on test page)
- **What:** Chat bubble, panel open/close, message send/receive, streaming, lead capture, accessibility
- **Setup:** Test HTML page at localhost:3000/test-widget.html with embedded widget script
- **Notes:** Widget uses Shadow DOM — agent-browser needs to pierce shadow root for interaction

## Validation Concurrency

**Machine specs:** 16 GB RAM, 12 CPUs
**Current usage:** ~9.2 GB RSS at baseline
**Available headroom:** ~6.8 GB, usable at 70% = ~4.8 GB

### agent-browser
- Each instance: ~400-500 MB (browser + agent overhead)
- Next.js dev server: ~300 MB
- **Max concurrent validators: 3**
- Rationale: 3 * 500 MB + 300 MB = 1.8 GB, well within 4.8 GB budget

### curl
- Negligible resource usage
- **Max concurrent validators: 5**

## Flow Validator Guidance: agent-browser

- Use a dedicated browser session per validator; do not reuse another validator's browser state.
- Use a unique email namespace per validator run (for example, `utv.foundation.browser.<timestamp>@example.com`).
- Stay on `http://localhost:3000` only; do not interact with unrelated local services.
- Do not modify global app configuration or seeded production-like data; only execute the auth/dashboard assertions assigned.
- Keep all screenshots and notes under the assigned evidence directory only.

## Flow Validator Guidance: curl

- Use isolated cookie jars per validator (`.factory/validation/foundation/user-testing/tmp/<group>.cookies`).
- For assertions requiring a valid auth callback code, generate a fresh magic link via Supabase Admin API in-process using `.env.local` service-role credentials.
- Scope all requests to `http://localhost:3000` and assigned assertion IDs only.
- Do not reuse single-use auth codes across assertions; generate a fresh code when needed.
- Save command transcripts/evidence in the assigned flow report and evidence directory.

## Known Frictions (foundation round 1)

- Supabase OTP submissions can hit `over_email_send_rate_limit` (`429`) during repeated validation runs, which blocks confirmation-state checks that depend on successful `signInWithOtp`.
- Supabase Admin `generateLink` for magic links may return fragment-token redirects (`#access_token=...`) instead of callback `?code=` links; assertions that explicitly require `code`-query callback behavior may be blocked in curl-only execution.
