# Validation Contract Ceremony — Complete Procedure

The validation contract is the formal definition of "done" for the entire mission. It is a finite checklist of testable behavioral assertions that define what the system must do. This is mission-level TDD: you write the contract BEFORE decomposing features.

---

## Core Principles

1. **Validation is black-box and behavior-based.** Never derived from implementation. Test against behavioral specifications, not against code.

2. **User-centric framing.** Every assertion describes something a user can DO or SEE. "The database has an index on user_id" is not a behavioral assertion. "Searching users by email returns results in under 200ms" is.

3. **Pass/fail must be unambiguous.** Each assertion has a clear, binary outcome. No subjective judgments.

4. **Evidence is mandatory.** Every assertion specifies what evidence must be collected to prove it passed.

---

## Assertion Format

Each assertion has:

```markdown
### VAL-{AREA}-{NUMBER}: {Title}

{Behavioral description — semantic but unambiguous, with clear pass/fail condition}

**Tool:** {specific tool to use when testing — e.g., browser automation, curl, terminal}
**Evidence:** {what must be collected — screenshots, console errors, network calls, terminal output}
```

### Examples

```markdown
## Area: Authentication

### VAL-AUTH-001: Successful login with valid credentials
A user with valid credentials submits the login form and is redirected to the dashboard.
The dashboard shows the user's email address.

Tool: browser automation
Evidence: screenshot(login-form), screenshot(dashboard-with-email), console-errors, network(POST /api/auth/login -> 200)

### VAL-AUTH-002: Login form validation — empty fields
Submitting the login form with empty fields shows per-field validation errors
("Email is required") without making a network request.

Tool: browser automation
Evidence: screenshot(validation-errors), console-errors, network(no requests made)

### VAL-AUTH-003: Protected route redirect
A guest user navigating directly to /dashboard is redirected to /login.
After logging in, they are redirected back to /dashboard (not to / or another page).

Tool: browser automation
Evidence: screenshot(redirected-to-login), screenshot(back-on-dashboard), network(redirect chain)

## Area: Crawl Pipeline

### VAL-CRAWL-001: Start crawl with valid URL
An authenticated user submits a valid HTTPS URL on the setup page. The system
creates a site record, starts a Firecrawl job, and shows a "Crawling..." status.

Tool: browser automation + API verification
Evidence: screenshot(setup-form), screenshot(crawling-status), curl(GET /api/site -> crawl_status=crawling)

### VAL-CRAWL-002: Reject non-HTTPS URL
Submitting an HTTP URL (not HTTPS) on the setup page shows an error message
and does not create a site record.

Tool: browser automation
Evidence: screenshot(error-message), network(POST /api/crawl/start -> 400)

## Cross-Area Flows

### VAL-CROSS-001: Full user journey — signup to chat
A new user: signs up → confirms email → logs in → sees empty dashboard →
enters URL → crawl completes → navigates to chat → sends a question →
receives an AI response with source citations.

Tool: browser automation + API orchestration
Evidence: screenshot(each-step), console-errors(each-page), network(key-requests)

### VAL-CROSS-002: Auth gates all features
A guest user cannot access: /dashboard, /dashboard/chat, /dashboard/settings,
/api/crawl/start, /api/chat. Each returns 401 or redirects to /login.

Tool: curl + browser automation
Evidence: curl(each-endpoint -> 401-or-redirect), screenshot(redirect-to-login)
```

---

## Creation Procedure

### Step 1: Identify All User-Facing Features

List every user-facing feature area. For each area, think about what a user can DO:

```
For each feature area, enumerate:
- What can a user DO with this feature?
- What do they SEE?
- What do they CLICK, TYPE, SUBMIT?
- What do they EXPECT to happen?
- What errors might they encounter?
- What edge cases exist?
- What happens after sustained use? (boundary conditions)
```

### Step 2: Write Per-Area Assertions

For each area, write assertions covering:

#### Happy Path
- Primary user flow works end-to-end
- Each step produces expected output
- Success states are shown correctly

#### Input Validation
- Empty required fields show errors
- Invalid formats show appropriate messages
- Validation happens before network requests when possible

#### Error States
- What happens when the external API fails?
- What happens when the database is unreachable?
- What does the user see for unexpected errors?

#### Edge Cases
- What happens with very long input?
- What happens with special characters?
- What happens with concurrent operations?
- What happens at the boundaries? (first item, last item, max items, zero items)

#### Security
- Authentication required for protected routes
- Authorization checked (can't access other users' data)
- Input sanitization (XSS, injection prevention)
- CSRF protection where applicable
- SSRF prevention for URL inputs

#### State Transitions
- What states can an entity be in?
- What transitions are valid?
- What happens during transitions? (loading states, optimistic updates)
- What happens on failure during transition? (rollback, error state)

#### Boundary Conditions (CRITICAL — Most bugs hide here)
- Empty state: What does the UI show when there's no data?
- Single item: Does the UI work with just one item?
- Many items: Does the UI work with 100+ items? (pagination, scrolling)
- Max limits: What happens at configured limits?
- First-time user experience: What does a new user see?

### Step 3: Write Cross-Area Assertions

Flows that span multiple features:

- **End-to-end user journeys**: Sign up → use feature A → use feature B → see result
- **Authentication gates**: All protected features require auth
- **Navigation flows**: Can users reach every feature from the main UI?
- **Data flow**: Does data created in one feature appear correctly in another?
- **State persistence**: Does state survive page refreshes? Logout/login cycles?
- **First-visit flow**: What does a brand new user experience?

### Step 4: Review Pass 1 — Adversarial Review

Read the entire contract and for each area:

```
Review checklist:
□ Are there assertions for EVERY user interaction? (click, type, submit, navigate)
□ Are there assertions for error states? (not just happy path)
□ Are there assertions for empty states?
□ Are there assertions for boundary conditions?
□ Are there assertions for security concerns?
□ Are there assertions for state persistence?
□ Is every assertion truly behavioral? (not implementation detail)
□ Is every assertion's pass/fail unambiguous?
□ Is evidence specified for every assertion?
□ Are there cross-area flows for every feature combination?
```

Be adversarial. Actively try to find gaps. It is very likely that important assertions are missing even if the contract looks good on the surface.

Add any missing assertions found.

### Step 5: Review Pass 2 — Completeness Review

After adding assertions from Pass 1, do another review:

```
Completeness checklist:
□ For every page in the app, is there at least one assertion?
□ For every API endpoint, is there at least one assertion?
□ For every form, are there assertions for: valid submit, invalid submit, empty submit?
□ For every list/table, are there assertions for: empty, one item, many items?
□ For every external integration, are there assertions for: success, failure, timeout?
□ Are there assertions for responsive behavior if relevant?
□ Are there assertions for accessibility if relevant?
□ Do cross-area flows cover the most common user journeys?
```

Continue review passes until a pass finds nothing significant to add.

### Step 6: Finalize and Count

After reviews are complete:
1. Number all assertions sequentially within each area
2. Count total assertions
3. Create `validation-state.json` with all IDs as "pending"

---

## validation-state.json Format

```json
{
  "assertions": {
    "VAL-AUTH-001": { "status": "pending" },
    "VAL-AUTH-002": { "status": "pending" },
    "VAL-AUTH-003": { "status": "pending" },
    "VAL-CRAWL-001": { "status": "pending" },
    "VAL-CROSS-001": { "status": "pending" }
  }
}
```

Status values:
- `"pending"` — Not yet tested
- `"passed"` — Tested and confirmed working
- `"failed"` — Tested and found broken
- `"blocked"` — Cannot test because a prerequisite is broken

---

## Maintaining the Contract Mid-Mission

### Adding Requirements
1. Write new assertions following the format and ID conventions
2. Add their IDs to `validation-state.json` as `"pending"`
3. Ensure new assertions are claimed by a feature's `fulfills`

### Removing Requirements
1. Delete assertions from `validation-contract.md`
2. Remove their IDs from `validation-state.json`
3. Remove orphaned `fulfills` references from features

### Modifying Requirements
1. Update the assertion's behavioral description and pass/fail criteria
2. If the change invalidates a previous "passed" result, reset to "pending"
3. If the change is cosmetic (wording only), leave status unchanged

### User-Reported Bugs
A bug report reveals a behavioral expectation the contract failed to capture:
1. Add new assertion(s) capturing the correct behavior
2. Add to `validation-state.json` as "pending"
3. Create fix feature with `fulfills` referencing the new assertion IDs
4. The assertion ensures the fix is verified

---

## Quality Metrics

A good validation contract:
- Has assertions for EVERY user-facing feature
- Has 3-5x more assertions than there are features (features are broad, assertions are specific)
- Has at least 10% cross-area flow assertions
- Has at least one "boundary condition" assertion per area
- Has zero subjective assertions (all are binary pass/fail)
- Has evidence requirements for every assertion
- Has been through at least 2 adversarial review passes

A bad validation contract:
- Only tests happy paths
- Has vague pass/fail criteria ("the page loads correctly")
- Missing error state assertions
- Missing empty state assertions
- No cross-area flows
- Assertions that describe implementation details
- No boundary condition testing

---

## Common Pitfalls

1. **Testing happy paths only.** Most bugs hide at the edges. Force yourself to write error/edge assertions.

2. **Vague assertions.** "The page works correctly" is not testable. "Clicking Submit with a valid email shows 'Check your inbox' and makes a POST to /api/auth/magic-link returning 200" is testable.

3. **Implementation-coupled assertions.** "The React state updates correctly" is coupled to implementation. "After adding an item, the count badge shows the new total" is behavioral.

4. **Missing cross-area flows.** Features work in isolation but break when combined. Always test the full user journey.

5. **Forgetting empty states.** What does the dashboard show before any data exists? This is the first thing a new user sees.

6. **Forgetting boundary conditions.** What happens with 0 items? 1 item? 1000 items? The maximum allowed? One more than the maximum?

7. **Not specifying evidence.** Without evidence requirements, you'll forget to collect proof and the assertion becomes unfalsifiable.
