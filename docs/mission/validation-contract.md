# Validation Contract — prod-saas mission

_Created 2026-04-18. Two adversarial review passes completed (2026-04-18 passes 1 and 2)._

This contract is the **definition of done** for the prod-saas mission. Each assertion is a binary pass/fail behavioral check against the real system. No assertion is "mostly working."

**Areas:**
- `AUTH` — deferred authentication assertions from the foundation milestone, re-validated here
- `RLS` — cross-user data isolation
- `BILLING` — Stripe checkout / webhook / portal / gating
- `QUOTA` — usage counters, enforcement, live meter
- `SET` — settings sidebar restructure
- `FILE` — supplementary knowledge uploads
- `RESP` — custom responses (keyword + intent)
- `ESCAL` — lead escalation rules + widget actions
- `HARD` — production hardening (rate limit, monitoring, legal, email, CI)
- `CROSS` — end-to-end user journeys spanning areas

**Stats:** 145 assertions · 10 areas · evidence required for every assertion.

---

## Area: AUTH (re-validation of foundation-deferred items)

Context: foundation milestone's user-testing round 1 left 7 blocked + 1 failed AUTH assertions because of Supabase OTP rate-limiting and magic-link fragment-token behavior. M1 re-validates these using pre-seeded sessions via Supabase Admin API (`auth.admin.generateLink` → exchange directly).

### VAL-AUTH-002: Login form shows same message for known and unknown emails
Submitting the login form with any well-formed email (known or unknown) shows the same "Check your email" confirmation message — no account enumeration via differential UI.

**Tool:** browser automation
**Evidence:** screenshot(known-email-submit), screenshot(unknown-email-submit), network(POST /api/auth/* status+body identical for both cases)

### VAL-AUTH-003: Magic-link callback lands on /dashboard
A user visiting a fresh valid magic-link URL ends up on `/dashboard` (or the original protected-page redirect target), **not** on `/login?error=auth_callback_error`. Session cookies (`sb-*`) are present after the redirect.

**Tool:** browser automation
**Evidence:** screenshot(redirected-to-dashboard), network(redirect chain), cookies(sb-* present). Known failure in foundation round 1 — this assertion drives a fix feature.

### VAL-AUTH-005: Callback rejects open-redirect parameter
Visiting `/auth/callback?code=VALID&next=https://evil.example.com` redirects to the app-internal fallback (e.g. `/dashboard`) **not** to `evil.example.com`. External URLs in `next` are stripped.

**Tool:** curl + browser automation
**Evidence:** network(follow redirects), final URL is same-origin, console-errors none

### VAL-AUTH-007: Authenticated browser session reaches dashboard
After a successful login via pre-seeded session, navigating to `/dashboard` renders the dashboard UI (not a redirect to `/login`). The sidebar shows the logged-in user's email.

**Tool:** browser automation
**Evidence:** screenshot(dashboard-rendered-with-email), console-errors none

### VAL-AUTH-008: Session persists across page refresh
An authenticated user refreshing the dashboard stays on the dashboard (no redirect to login). Session cookies remain valid.

**Tool:** browser automation
**Evidence:** screenshot(pre-refresh), screenshot(post-refresh), cookies unchanged

### VAL-AUTH-009: Sign-out clears session
Clicking the sign-out control in the dashboard sidebar: (a) makes a POST to `/api/auth/signout`, (b) clears `sb-*` cookies, (c) redirects to `/login` or `/`.

**Tool:** browser automation
**Evidence:** network(POST /api/auth/signout → 200), cookies(sb-* absent after), screenshot(final-page)

### VAL-AUTH-010: Post-logout protected routes redirect to login
After signing out, navigating directly to `/dashboard`, `/dashboard/setup`, `/dashboard/billing` each redirects to `/login`.

**Tool:** browser automation
**Evidence:** network(redirects for each route), screenshot(landed-on-login)

### VAL-AUTH-012: Magic link is single-use
Successfully exchanging a magic-link code for a session invalidates the code. A second visit to the same magic link renders an error (not a second session).

**Tool:** curl
**Evidence:** curl(first exchange → 200 with session), curl(second exchange → error or redirect to login with error)

### VAL-AUTH-013: Site-key rotation invalidates old key immediately
After `POST /api/sites/rotate-key` succeeds, the widget using the old `site_key` receives 401 on its next `/api/chat/session` call. The new key works.

**Tool:** curl
**Evidence:** curl(chat with old key → 401), curl(chat with new key → 200)

---

## Area: RLS (cross-user data isolation)

Context: Every user-scoped table must prevent one user from reading/modifying another user's data, even with a valid JWT.

### VAL-RLS-001: User A cannot SELECT user B's sites
With user A's JWT, `select * from sites where user_id = <B>` returns 0 rows.

**Tool:** vitest integration test
**Evidence:** test output with RLS policy version logged

### VAL-RLS-002: User A cannot SELECT user B's embeddings
With user A's JWT, querying embeddings by B's `site_id` returns 0 rows.

**Tool:** vitest integration test
**Evidence:** test output

### VAL-RLS-003: User A cannot SELECT user B's pages
Same pattern for `pages` table.

**Tool:** vitest integration test
**Evidence:** test output

### VAL-RLS-004: User A cannot SELECT user B's leads
Same pattern for `leads` table.

**Tool:** vitest integration test
**Evidence:** test output

### VAL-RLS-005: User A cannot SELECT user B's conversations
Same pattern for `conversations` table.

**Tool:** vitest integration test
**Evidence:** test output

### VAL-RLS-006: User A cannot UPDATE user B's site
Attempting `update sites set name = 'pwned' where user_id = <B>` returns 0 rows affected and leaves B's data unchanged.

**Tool:** vitest integration test
**Evidence:** test output; post-update SELECT on B's site shows original name

### VAL-RLS-007: User A cannot DELETE user B's leads
Attempting to delete B's leads as A returns 0 rows affected.

**Tool:** vitest integration test
**Evidence:** test output

### VAL-RLS-008: Widget with valid site_key reads only that site's embeddings
Anonymous request with `site_key = X` can read embeddings where `site_id = X`'s site. It cannot read embeddings from any other site.

**Tool:** vitest integration test
**Evidence:** test output: query returns X's rows, parallel query for Y's site_key returns 0 rows

### VAL-RLS-009: Widget with wrong site_key returns zero rows
Anonymous request with a non-existent or spoofed `site_key` returns 0 rows from embeddings, conversations, and leads. Does not error in a way that leaks schema.

**Tool:** vitest integration test
**Evidence:** test output

### VAL-RLS-010: Widget can insert lead only for valid site_key
INSERT into `leads` with a valid `site_id` + `site_key` succeeds. INSERT with `site_id` that does not match a real `site_key` fails the RLS check.

**Tool:** vitest integration test
**Evidence:** test output

### VAL-RLS-011: Service role bypasses RLS (intentional)
A client using the service-role key can read all users' sites, embeddings, leads. This must work for Firecrawl webhook and Stripe webhook paths.

**Tool:** vitest integration test
**Evidence:** test output showing service-role SELECT returns N>1 rows across users

### VAL-RLS-012: Anonymous user (no JWT, no site_key) reads nothing
A bare anonymous client can read 0 rows from any user-scoped table.

**Tool:** vitest integration test
**Evidence:** test output

### VAL-RLS-014: 50 parallel cross-user reads don't pollute
50 concurrent read operations alternating between user A's and user B's JWTs, each asserting their own rows only — no cross-contamination under load.

**Tool:** vitest integration test
**Evidence:** test output with timing + per-iteration row counts

### VAL-RLS-015: usage_counters isolated per user
User A's `usage_counters` row is invisible to user B.

**Tool:** vitest integration test
**Evidence:** test output (added in M3 alongside the table creation)

---

## Area: BILLING (Stripe integration)

### VAL-BILLING-001: Guest hitting /dashboard/billing redirects to /login
Unauthenticated request to `/dashboard/billing` returns a redirect to `/login`.

**Tool:** browser automation
**Evidence:** network(redirect to /login), screenshot

### VAL-BILLING-002: Logged-in user on /dashboard/billing sees current plan
An authenticated user (not on a subscription) sees the billing page with plan options and a "Start trial" or "Upgrade" CTA. An authenticated user on an active subscription sees plan name, status pill, price.

**Tool:** browser automation
**Evidence:** screenshot(pre-subscription), screenshot(active-subscription)

### VAL-BILLING-003: Trialing user sees trial countdown
A user with `subscription_status='trialing'` sees a countdown banner ("Trial ends in N days") on `/dashboard/billing`.

**Tool:** browser automation
**Evidence:** screenshot(trial-banner-visible)

### VAL-BILLING-004: POST /api/stripe/checkout returns Checkout Session URL
Authenticated POST with `{plan_id: 'starter'}` returns `{url: 'https://checkout.stripe.com/...'}` with status 200.

**Tool:** curl
**Evidence:** response body and status

### VAL-BILLING-005: POST /api/stripe/checkout rejects invalid plan_id
POST with `{plan_id: 'nope'}` returns 400 with error.

**Tool:** curl
**Evidence:** response body and status

### VAL-BILLING-006: POST /api/stripe/checkout requires auth
POST without session cookie returns 401.

**Tool:** curl
**Evidence:** response status

### VAL-BILLING-007: Webhook rejects invalid signature
POST to `/api/stripe/webhook` with a wrong `stripe-signature` header returns 400 and does not process the event.

**Tool:** curl
**Evidence:** response status; DB unchanged

### VAL-BILLING-008: Webhook accepts valid signature
POST with a correctly signed event returns 200 and processes the event.

**Tool:** curl (using `stripe` SDK to sign) OR vitest
**Evidence:** response status; DB updated per event type

### VAL-BILLING-009: Webhook rejects expired timestamp
A webhook payload with `created` older than the 5-minute tolerance returns 400.

**Tool:** vitest
**Evidence:** test output

### VAL-BILLING-010: Duplicate webhook events processed once
Firing the same `stripe-event-id` twice: first call processes and writes to `processed_stripe_events`; second call returns 200 but does not re-process.

**Tool:** vitest
**Evidence:** test output; `processed_stripe_events` has exactly one row; DB side-effects applied once

### VAL-BILLING-011: checkout.session.completed sets subscription + plan
Event processing sets `profiles.stripe_subscription_id`, `profiles.plan_id`, `profiles.subscription_status='active'` (or `'trialing'` if trial), and `current_period_end`.

**Tool:** vitest integration
**Evidence:** test output; post-event DB row

### VAL-BILLING-012: customer.subscription.updated syncs fields
Event with new period dates / plan change / status change updates the corresponding `profiles` columns.

**Tool:** vitest integration
**Evidence:** test output

### VAL-BILLING-013: customer.subscription.deleted sets canceled
Event sets `subscription_status='canceled'` and `cancel_at_period_end` appropriately.

**Tool:** vitest integration
**Evidence:** test output

### VAL-BILLING-014: invoice.paid resets usage counters
Event resets `usage_counters.messages_used` and `crawl_pages_used` to 0 and rolls `period_start`/`period_end` to the new billing window.

**Tool:** vitest integration
**Evidence:** test output; pre/post counter values

### VAL-BILLING-015: invoice.payment_failed sets past_due
Event sets `subscription_status='past_due'`.

**Tool:** vitest integration
**Evidence:** test output

### VAL-BILLING-016: Trialing user can chat and crawl
A user with `subscription_status='trialing'` and valid `trial_ends_at` can successfully call `/api/chat/session` and `/api/crawl/start`.

**Tool:** curl + vitest
**Evidence:** both requests return 200

### VAL-BILLING-017: Active user can chat and crawl
A user with `subscription_status='active'` can call both endpoints successfully.

**Tool:** curl + vitest
**Evidence:** both requests return 200

### VAL-BILLING-018: past_due user blocked on chat
A user with `subscription_status='past_due'` gets 402 on `/api/chat/session` with `{error: 'subscription_inactive', upgrade_url}`.

**Tool:** curl
**Evidence:** response status and body

### VAL-BILLING-019: canceled user blocked on chat
Same as 018 for `subscription_status='canceled'`.

**Tool:** curl
**Evidence:** response status and body

### VAL-BILLING-020: Expired trial blocks chat
A user with `subscription_status='trialing'` and `trial_ends_at < now()` gets 402.

**Tool:** curl
**Evidence:** response status

### VAL-BILLING-021: POST /api/stripe/portal returns Portal URL
Authenticated POST returns `{url: 'https://billing.stripe.com/...'}` for the user's customer record.

**Tool:** curl
**Evidence:** response body

### VAL-BILLING-022: Plan upgrade mid-cycle creates proration invoice
User on Starter switches to Pro mid-period → Stripe API (via `stripe-mock`) shows proration line items on the upcoming invoice.

**Tool:** vitest (stripe-mock)
**Evidence:** test output; invoice line-items

### VAL-BILLING-023: Plan downgrade mid-cycle creates credit
User on Pro switches to Starter → credit applied on upcoming invoice.

**Tool:** vitest (stripe-mock)
**Evidence:** test output

### VAL-BILLING-024: Billing page shows last 12 invoices
Authenticated user with past invoices sees them in a table with dates, amounts, and links to the Stripe-hosted PDF.

**Tool:** browser automation
**Evidence:** screenshot

### VAL-BILLING-025: Billing page shows next invoice date
When on an active subscription, the billing page shows "Next invoice: YYYY-MM-DD".

**Tool:** browser automation
**Evidence:** screenshot

---

## Area: QUOTA (usage counters and enforcement)

### VAL-QUOTA-001: messages_used increments by 1 per chat
Each successful `/api/chat/session` increments `usage_counters.messages_used` by exactly 1 for the owning user.

**Tool:** vitest integration
**Evidence:** pre/post counter values

### VAL-QUOTA-002: Over-quota returns 402 with upgrade_url
When `messages_used >= monthly_message_limit`, the next `/api/chat/session` returns 402 with `{error: 'quota_exceeded', upgrade_url: '/dashboard/billing'}`. **No OpenAI call is made.**

**Tool:** curl
**Evidence:** response status and body; OpenAI mock call count = 0

### VAL-QUOTA-003: Concurrent requests at budget=N yield exactly N successes
With budget=10 and 20 concurrent requests, exactly 10 succeed and 10 return 402. Counter ends at exactly 10. No over-counts, no under-counts.

**Tool:** vitest (fast-check property)
**Evidence:** test output with success counts

### VAL-QUOTA-004: crawl_pages_used tracks per-crawl pages
A crawl that indexes 120 pages increments `usage_counters.crawl_pages_used` by 120.

**Tool:** vitest integration
**Evidence:** pre/post counter values after simulated webhook

### VAL-QUOTA-005: Over-quota crawl rejected pre-Firecrawl
When `crawl_pages_used + estimated_pages > monthly_crawl_page_limit`, `/api/crawl/start` returns 402 and does not call Firecrawl.

**Tool:** vitest
**Evidence:** response status; Firecrawl mock call count = 0

### VAL-QUOTA-006: invoice.paid resets usage counters
Tied to VAL-BILLING-014 — verify from the QUOTA side that after the event, the user's counters are 0 and they can chat again.

**Tool:** vitest integration
**Evidence:** test output

### VAL-QUOTA-007: Dashboard shows usage meters
`/dashboard` overview and `/dashboard/settings/billing` render the 3 usage bars: messages / crawl pages / files.

**Tool:** browser automation
**Evidence:** screenshot with visible bars

### VAL-QUOTA-008: Usage meters update live via Realtime
Sending a chat message in one tab updates the meter on `/dashboard` open in another tab within 3 seconds.

**Tool:** browser automation (two pages, one driver)
**Evidence:** screenshot before + after; timestamp diff

### VAL-QUOTA-009: Upgrade syncs new limits immediately
User upgrades from Starter → Pro → `monthly_message_limit` changes from 2000 → 7500. The dashboard reflects the new cap without a page reload.

**Tool:** browser automation
**Evidence:** screenshot pre + post upgrade

### VAL-QUOTA-010: Duplicate invoice.paid resets once
Firing `invoice.paid` twice for the same invoice does not double-reset (idempotency).

**Tool:** vitest
**Evidence:** test output; counter state

### VAL-QUOTA-011: Widget renders upgrade prompt on 402
When the widget's next chat call returns 402 quota_exceeded, it renders a polite "You've hit your monthly chat limit" message with an upgrade link (the site owner's `/dashboard/billing` is **not** exposed to the visitor — wording is generic).

**Tool:** browser automation
**Evidence:** screenshot(widget-over-quota-state)

### VAL-QUOTA-012: usage_counters isolated per user (RLS)
Covered by VAL-RLS-015; re-asserted here for the QUOTA area.

**Tool:** vitest
**Evidence:** test output

### VAL-QUOTA-013: /dashboard/billing has UsageMeterSet
Billing page shows the 3 meters with current / max values.

**Tool:** browser automation
**Evidence:** screenshot

### VAL-QUOTA-014: New user empty state
A user who has never chatted sees `0 / 2000` (or plan-relevant cap) on the meter, no errors.

**Tool:** browser automation
**Evidence:** screenshot

### VAL-QUOTA-015: Bar caps at 100% width on overshoot
If a race lands `messages_used = limit + 1`, the bar renders at 100% width (not overflowing the track).

**Tool:** browser automation (inject state)
**Evidence:** screenshot; bar width <= track width

---

## Area: SET (settings sidebar restructure)

### VAL-SET-001: /dashboard/settings redirects to /site
Navigating to `/dashboard/settings` lands on `/dashboard/settings/site`.

**Tool:** browser automation
**Evidence:** network(redirect); final URL

### VAL-SET-002: Sidebar lists 5 items
Left nav shows exactly: Site · Knowledge · Responses · Escalation · Billing. Each is a link.

**Tool:** browser automation
**Evidence:** screenshot

### VAL-SET-003: Active nav item visually distinct
Visiting each sub-route highlights the matching nav item with the app's active-state style.

**Tool:** browser automation
**Evidence:** 5 screenshots, one per sub-route

### VAL-SET-004: /settings/site has existing fields
`/dashboard/settings/site` shows inputs for site name, greeting message, Calendly URL, Google Maps URL. Save button persists.

**Tool:** browser automation
**Evidence:** screenshot; POST to save endpoint returns 200

### VAL-SET-005: Site-key rotation rotates
Clicking "Rotate site key" calls the rotation endpoint and displays the new key. The embed-page snippet also updates.

**Tool:** browser automation
**Evidence:** screenshot(before), screenshot(after with new key), network(POST /api/sites/rotate-key)

### VAL-SET-006: Toast appears on save
Saving settings triggers a visible toast ("Saved"). Toast auto-dismisses.

**Tool:** browser automation
**Evidence:** screenshot with toast

### VAL-SET-007: Unauthenticated /settings/* redirects to /login
Hitting any `/dashboard/settings/*` route without a session redirects to `/login`.

**Tool:** curl
**Evidence:** 5 curl calls, each returning 302 to `/login`

### VAL-SET-008: Mobile viewport collapses sidebar
At viewport width 375px the settings sidebar collapses into a top-tab or drawer — it does not stack awkwardly over content.

**Tool:** browser automation (mobile viewport)
**Evidence:** screenshot

---

## Area: FILE (supplementary knowledge uploads)

### VAL-FILE-001: Drag-drop accepts 7 types
Dropping .pdf, .docx, .pptx, .xlsx, .csv, .txt, .md files onto the zone each initiate upload. Dropping .exe or .zip is rejected with an inline error.

**Tool:** browser automation
**Evidence:** 7 screenshots (one per accepted type) + 1 (rejected type)

### VAL-FILE-002: File list shows status chip
Uploaded file appears in the list with a status chip (queued → processing → ready or failed).

**Tool:** browser automation
**Evidence:** screenshots at each state

### VAL-FILE-003: PDF upload end-to-end
Upload a 10-page PDF → extraction → chunking → embedding → `supplementary_files.status='ready'`, embeddings present in DB with `source_type='file'`.

**Tool:** vitest integration + browser automation
**Evidence:** DB row counts; file status

### VAL-FILE-004: DOCX upload end-to-end
Same for .docx (parsed with `mammoth`).

**Tool:** vitest integration
**Evidence:** DB assertions

### VAL-FILE-005: PPTX upload end-to-end
Same for .pptx.

**Tool:** vitest integration
**Evidence:** DB assertions

### VAL-FILE-006: XLSX upload end-to-end
Same for .xlsx (parsed with `xlsx`). Sheet titles included as context.

**Tool:** vitest integration
**Evidence:** DB assertions

### VAL-FILE-007: CSV upload end-to-end
Same for .csv.

**Tool:** vitest integration
**Evidence:** DB assertions

### VAL-FILE-008: TXT upload end-to-end
Same for .txt.

**Tool:** vitest integration
**Evidence:** DB assertions

### VAL-FILE-009: MD upload end-to-end
Same for .md.

**Tool:** vitest integration
**Evidence:** DB assertions

### VAL-FILE-010: 25MB size cap enforced
Upload of a 26MB file is rejected with 413 (server) and a client-side error before upload starts (client).

**Tool:** curl + browser automation
**Evidence:** response status; UI error

### VAL-FILE-011: Plan-dependent file count cap
Starter user can upload 25 files; 26th is rejected. Pro: 100. Scale: 500.

**Tool:** vitest integration
**Evidence:** test output for each plan

### VAL-FILE-012: Content-hash dedupe
Uploading the same file twice creates one `supplementary_files` row, not two. Second upload returns 200 with a "duplicate" flag.

**Tool:** vitest integration
**Evidence:** DB row count; response body

### VAL-FILE-013: Delete cascades embeddings
Deleting a `supplementary_files` row deletes all `embeddings` rows where that file was the source.

**Tool:** vitest integration
**Evidence:** pre/post counts

### VAL-FILE-014: Status transitions
A file moves queued → processing → ready for a valid file; queued → processing → failed for an invalid one, each transition observable in the DB.

**Tool:** vitest integration
**Evidence:** status snapshots over time

### VAL-FILE-015: Failed file shows error + retry
UI renders the failure reason and a Retry button that re-queues processing.

**Tool:** browser automation
**Evidence:** screenshot

### VAL-FILE-016: Zip-bomb rejected
A 1MB zip that expands to 5GB is rejected during extraction with a clear error; no disk filled.

**Tool:** vitest (malicious fixture)
**Evidence:** test output; disk usage unchanged

### VAL-FILE-017: PDF-bomb rejected
A PDF whose decompressed stream exceeds 100MB is rejected.

**Tool:** vitest (malicious fixture via `pdf-lib`)
**Evidence:** test output

### VAL-FILE-018: MIME spoofing rejected via magic bytes
`.exe` file with `Content-Type: application/pdf` is rejected on server based on magic-byte sniff, regardless of client MIME header.

**Tool:** vitest / curl
**Evidence:** response status

### VAL-FILE-019: Path traversal in filename sanitized
Filename `../../../etc/passwd.pdf` becomes `etc_passwd.pdf` (or similar safe variant) in `supplementary_files.filename`.

**Tool:** vitest
**Evidence:** DB filename value

### VAL-FILE-020: Encrypted PDF rejected
A PDF with an owner password fails parsing with a user-visible message ("This PDF is password-protected"). File status = failed.

**Tool:** vitest
**Evidence:** test output

### VAL-FILE-021: Empty file rejected
A 0-byte upload is rejected with 400 and a clear error.

**Tool:** curl
**Evidence:** response status and body

### VAL-FILE-022: DOCX macros stripped
A DOCX with a VBA macro gets parsed as plain text; the macro is not executed or persisted.

**Tool:** vitest
**Evidence:** extracted text contains document body, no macro artifacts

### VAL-FILE-023: Non-UTF8 CSV handled
A CSV with Latin-1 encoding either decodes with replacement characters or is rejected with a clear error — never crashes the pipeline.

**Tool:** vitest
**Evidence:** test output

### VAL-FILE-024: File-sourced chunks appear in chat retrieval
After a file upload, a chat query whose answer is only in that file returns an answer citing the file. The system prompt source list includes the filename.

**Tool:** browser automation + curl
**Evidence:** screenshot of widget response with citation; server log of retrieved chunks

### VAL-FILE-025: Knowledge page empty state
New user on `/dashboard/settings/knowledge` sees the empty-state message, not an empty table.

**Tool:** browser automation
**Evidence:** screenshot

---

## Area: RESP (custom responses)

### VAL-RESP-001: Responses page empty state
New user sees "No custom responses yet" with an Add Response CTA.

**Tool:** browser automation
**Evidence:** screenshot

### VAL-RESP-002: Add Response modal validates
Submitting with empty triggers or empty response shows per-field errors and does not POST.

**Tool:** browser automation
**Evidence:** screenshot; network(no POST)

### VAL-RESP-003: Keyword rule creation
Adding a rule with `trigger_type='keyword'`, triggers `['pricing', 'cost']`, response `"Our pricing is ..."` persists and appears in the list.

**Tool:** browser automation
**Evidence:** screenshot; DB row

### VAL-RESP-004: Intent rule creation
Adding a rule with `trigger_type='intent'`, triggers `['hours']`, response `"We're open 9-5"` persists.

**Tool:** browser automation
**Evidence:** screenshot; DB row

### VAL-RESP-005: Table renders triggers as chips
Trigger arrays render as chip/pill UI, not a raw string.

**Tool:** browser automation
**Evidence:** screenshot

### VAL-RESP-006: Test drawer returns match result
Entering "What's the cost?" in the test drawer with a keyword rule `['pricing', 'cost']` active reports `matched=true`, rule-id, and the exact canned response.

**Tool:** browser automation
**Evidence:** screenshot with drawer result

### VAL-RESP-007: Keyword match bypasses LLM
A chat message matching a keyword rule returns the canned response **without** calling gpt-4o-mini. OpenAI mock call count = 0 for that request.

**Tool:** vitest integration
**Evidence:** test output; mock assertion

### VAL-RESP-008: Keyword match is case-insensitive
Triggers `['Help']` match user messages `"help me"`, `"HELP"`, `"Help?"`.

**Tool:** vitest unit
**Evidence:** test output

### VAL-RESP-009: Word-boundary enforced
Trigger `['help']` does NOT match `"helper"` or `"alphelp"`.

**Tool:** vitest unit
**Evidence:** test output

### VAL-RESP-010: Priority tiebreaker
Two rules both matching the same message: the higher-priority rule wins. Ties broken by `created_at` ascending (older wins).

**Tool:** vitest unit
**Evidence:** test output

### VAL-RESP-011: Intent classifier runs only when intent rule exists
If the site has no `trigger_type='intent'` rules, the intent-classifier LLM call is skipped. `gpt-4o-mini` mock classification-call count = 0.

**Tool:** vitest integration
**Evidence:** test output

### VAL-RESP-012: Delete removes rule
Clicking delete removes the rule from the UI and DB.

**Tool:** browser automation
**Evidence:** screenshot; DB row absent

---

## Area: ESCAL (lead escalation)

### VAL-ESCAL-001: Empty state
`/dashboard/settings/escalation` with no rules shows the empty-state message and Add Rule CTA.

**Tool:** browser automation
**Evidence:** screenshot

### VAL-ESCAL-002: turn_count rule creation
Rule `{rule_type: 'turn_count', config: {turns: 3}, action: 'ask_email'}` persists and appears.

**Tool:** browser automation
**Evidence:** DB row; screenshot

### VAL-ESCAL-003: keyword rule creation
Rule `{rule_type: 'keyword', config: {keywords: ['price']}, action: 'ask_email'}` persists.

**Tool:** browser automation
**Evidence:** DB row

### VAL-ESCAL-004: intent rule creation
Rule `{rule_type: 'intent', config: {intents: ['complaint']}, action: 'handoff'}` persists.

**Tool:** browser automation
**Evidence:** DB row

### VAL-ESCAL-005: Reorder via drag-drop
Dragging rule #3 to top makes it priority 1; DB reflects new priority.

**Tool:** browser automation
**Evidence:** screenshot; DB priorities

### VAL-ESCAL-006: Priority determines match order
Two matching rules: the higher-priority's action attaches, not the other's.

**Tool:** vitest integration
**Evidence:** test output

### VAL-ESCAL-007: turn_count fires on Nth turn
A visitor on their 3rd message (conversation.message_count=5 counting assistant replies) triggers a `turn_count: 3` rule.

**Tool:** vitest integration
**Evidence:** test output; pending_action attached

### VAL-ESCAL-008: keyword fires on match
Message containing "price" triggers the keyword rule.

**Tool:** vitest integration
**Evidence:** test output

### VAL-ESCAL-009: intent fires on match
Message classified as `complaint` triggers the intent rule.

**Tool:** vitest integration
**Evidence:** test output (mocked classifier)

### VAL-ESCAL-010: pending_action plumbed to widget
When a rule fires, the chat stream finish event carries `pending_action: {type, config}`. Widget receives and renders.

**Tool:** browser automation
**Evidence:** network(stream body); screenshot(widget state)

### VAL-ESCAL-011: ask_email widget form
Widget renders an email input + Send button. Submitting posts to `/api/leads` with `source='escalation'`.

**Tool:** browser automation
**Evidence:** screenshot; network(POST /api/leads 200)

### VAL-ESCAL-012: ask_phone widget form
Widget renders tel input + Request Call. Posts to `/api/leads` with phone field.

**Tool:** browser automation
**Evidence:** screenshot; network

### VAL-ESCAL-013: show_form widget renders dynamic fields
Given `action_config.fields=['name','phone','message']`, widget renders 3 inputs + submit. Posts with all 3 fields.

**Tool:** browser automation
**Evidence:** screenshot; network body

### VAL-ESCAL-014: calendly_link widget embeds iframe
Widget inserts an `<iframe src={action_config.url}>` at 100% x 600px.

**Tool:** browser automation
**Evidence:** screenshot; DOM query

### VAL-ESCAL-015: handoff widget shows message + flags conversation
Widget shows "Connecting you with a human…" (animated). `conversations.needs_human=true` in DB. Dashboard conversation view shows a flag.

**Tool:** browser automation + vitest
**Evidence:** screenshot; DB row

---

## Area: HARD (production hardening)

### VAL-HARD-001: Rate limit persists across cold starts
10 rapid requests from the same IP get rate-limited; after 10 seconds the window resets. A serverless cold-start simulation (restart process mid-window) **preserves** the window state (Upstash-backed).

**Tool:** vitest integration (against Upstash dev instance or mock)
**Evidence:** test output

### VAL-HARD-002: 429 response includes retry-after
Rate-limited requests return 429 with `Retry-After` header.

**Tool:** curl
**Evidence:** response headers

### VAL-HARD-003: /privacy renders
Anonymous GET `/privacy` returns 200 with the privacy policy page.

**Tool:** curl
**Evidence:** response status and byte count > 1KB

### VAL-HARD-004: /terms renders
Same for `/terms`.

**Tool:** curl
**Evidence:** same

### VAL-HARD-005: /dpa renders
Same for `/dpa`.

**Tool:** curl
**Evidence:** same

### VAL-HARD-006: Welcome email sent on signup
New signup triggers a transactional email to the user's address (via Resend). Resend test mode logs the send.

**Tool:** vitest + Resend API check
**Evidence:** Resend send log

### VAL-HARD-007: Trial-ending email sent 3 days before
Cron or scheduled function catches users with `trial_ends_at BETWEEN now() + '3 days' AND now() + '4 days'` and sends the email once per user.

**Tool:** vitest (simulated time)
**Evidence:** send log; idempotency: second run does not re-send

### VAL-HARD-008: Quota-80% warning email
User crossing 80% monthly message usage receives a one-time warning email per period.

**Tool:** vitest integration
**Evidence:** send log

### VAL-HARD-009: Payment-failed email
Stripe `invoice.payment_failed` event triggers an email to the customer.

**Tool:** vitest
**Evidence:** send log

### VAL-HARD-010: Sentry receives server error
A handled exception in an API route appears in Sentry (test DSN). Event has tags: environment, user_id, request_id.

**Tool:** vitest + Sentry test DSN query
**Evidence:** Sentry event

### VAL-HARD-011: CI workflow runs
A PR push triggers `.github/workflows/test.yml`. Workflow runs lint + typecheck + vitest + playwright. Status reported to the PR.

**Tool:** GitHub Actions
**Evidence:** workflow run log

---

## Area: CROSS (end-to-end journeys)

### VAL-CROSS-001: New-user full journey
Signup → email-confirmation → login → empty `/dashboard` → enter URL on `/dashboard/setup` → crawl completes → `/dashboard/embed` → copy snippet → widget on a test page → ask a question → receive answer with citation.

**Tool:** Playwright E2E
**Evidence:** screenshots at each step; final widget answer

### VAL-CROSS-002: Subscription lifecycle gates features
Trial expires with no payment → user is blocked on `/api/chat/session` (402). User completes checkout → webhook fires → chat re-enabled.

**Tool:** Playwright E2E + stripe-mock
**Evidence:** 3 screenshots (trialing-OK, expired-blocked, active-OK)

### VAL-CROSS-003: Lead-capture flow
Widget → 3 messages → email form → submitted → `/dashboard/leads` shows the new lead → export CSV contains it.

**Tool:** Playwright E2E
**Evidence:** screenshots; CSV byte check

### VAL-CROSS-004: Quota exhaustion and recovery
User sends 2,000 messages → 2,001st returns 402 → user upgrades to Pro → webhook fires → next message succeeds. Counter still shows current usage, new limit is 7,500.

**Tool:** Playwright E2E (accelerated counter via service role test setup)
**Evidence:** screenshots

### VAL-CROSS-005: File upload + retrieval
Upload PDF containing "Our hours are 9 AM to 5 PM." → chat "what are your hours?" → widget answer includes the content with a citation to the PDF file.

**Tool:** Playwright E2E
**Evidence:** screenshot of widget response

### VAL-CROSS-006: Custom response + escalation interaction
Create keyword rule `['price']` → visitor says "what's the price?" → canned response returned (no LLM call) → visitor says "ok interested" → turn count hits 3 → email form renders.

**Tool:** Playwright E2E
**Evidence:** screenshots at each stage

### VAL-CROSS-007: Settings sidebar full navigation
User visits all 5 sub-routes; each renders correctly; active state highlights; back button works.

**Tool:** Playwright E2E
**Evidence:** screenshot per route

### VAL-CROSS-008: Auth gates all dashboard routes
Unauthenticated visits to `/dashboard`, `/dashboard/setup`, `/dashboard/preview`, `/dashboard/embed`, `/dashboard/leads`, `/dashboard/conversations`, `/dashboard/settings/*`, `/dashboard/billing` all redirect to `/login`.

**Tool:** curl (12 requests)
**Evidence:** 12 x 302 redirects

### VAL-CROSS-009: API auth boundaries
Unauthenticated POST to `/api/crawl/start` → 401. Unauthenticated POST to `/api/chat/session` without `site_key` → 400 or 401. Anonymous POST to `/api/chat/session` with valid `site_key` → 200. Widget paths work; dashboard paths don't.

**Tool:** curl
**Evidence:** response statuses

### VAL-CROSS-010: Fresh-start wipe script
After Brandon runs `scripts/reset-my-data.sql` against his user: `sites`, `embeddings`, `pages`, `leads`, `conversations`, `chat_sessions`, `supplementary_files`, `usage_counters`, `custom_responses`, `escalation_rules` have 0 rows for his user_id. `profiles` row preserved. Other users' data untouched.

**Tool:** psql + vitest
**Evidence:** pre/post row counts; other-user-unchanged assertion

---

## Coverage summary

| Area | Count |
|---|---|
| AUTH | 9 |
| RLS | 14 |
| BILLING | 25 |
| QUOTA | 15 |
| SET | 8 |
| FILE | 25 |
| RESP | 12 |
| ESCAL | 15 |
| HARD | 11 |
| CROSS | 10 |
| **Total** | **144** |

Notes from adversarial review passes:

- **Pass 1 additions:** VAL-AUTH-012 (magic link single-use), VAL-AUTH-013 (site-key rotation), VAL-QUOTA-011 (widget upgrade prompt wording — generic, doesn't expose owner dashboard), VAL-QUOTA-015 (progress-bar cap at 100%), VAL-FILE-018 (magic-byte MIME check, not header trust), VAL-FILE-019 (path traversal), VAL-RESP-009 (word boundaries), VAL-CROSS-010 (wipe script scope).
- **Pass 2 additions:** VAL-BILLING-010 (webhook idempotency under duplicate fire), VAL-BILLING-009 (expired timestamp), VAL-RLS-014 (50 parallel concurrent reads), VAL-ESCAL-015 (needs_human DB flag), VAL-HARD-007 (trial-ending email idempotency).
- **No further substantive additions on pass 3 — contract frozen at 144.**
