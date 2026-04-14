# User Testing Validation — Complete Procedure

User testing validation is the final quality gate for a milestone. It verifies that every behavioral assertion in the validation contract actually works by testing through the real user surface. This is black-box testing — you test what users see and do, not how the code works.

---

## When to Run

Run user testing validation AFTER scrutiny validation passes for the milestone.

---

## Procedure

### Step 1: Identify Assertions to Test

Find all assertions that belong to this milestone:

1. Look at all completed features in this milestone in `features.json`
2. Collect all assertion IDs from their `fulfills` arrays
3. Cross-reference with `validation-state.json` — only test assertions that are `"pending"` or `"failed"`
4. Skip assertions that are already `"passed"` (from a previous run)

```
Example:
Milestone: crawl-pipeline
Features: crawl-start-api (fulfills: [VAL-CRAWL-001, VAL-CRAWL-002]),
          crawl-webhook (fulfills: [VAL-CRAWL-003, VAL-CRAWL-004]),
          crawl-setup-page (fulfills: [VAL-CRAWL-005, VAL-CRAWL-006])

Assertions to test: VAL-CRAWL-001 through VAL-CRAWL-006
(minus any already "passed" from validation-state.json)
```

### Step 2: Prepare the Environment

#### Start All Required Services

Using `services.yaml`, start services in dependency order:

```bash
# Check what's already running
{healthcheck command for each service}

# Start any services that aren't running
{start command for each service}

# Wait for health
{healthcheck command — retry until healthy or timeout}
```

#### Seed Test Data (if needed)

If assertions require existing data (e.g., "user sees their sites listed"):
- Create test data through the actual application (not direct DB inserts)
- Or use a seed script if one exists
- Document what data was created and why

#### Verify Prerequisites

```
Pre-test checklist:
□ All services from services.yaml are running and healthy
□ Application is accessible at the expected URL
□ Required test accounts exist (or can be created)
□ Required test data exists (or will be created as part of testing)
□ Required environment variables are set
□ No console errors on initial page load
```

### Step 3: Test Each Assertion

For each assertion, follow its specification in `validation-contract.md`:

#### Testing Through Browser (Web UI assertions)

```
For each browser-based assertion:
1. Navigate to the starting URL
2. Execute the user actions described in the assertion
3. Observe the result
4. Collect evidence:
   - Screenshot at key points (BEFORE action, AFTER action)
   - Browser console errors (check after each page/action)
   - Network requests (status codes for key API calls)
5. Compare observed behavior to expected behavior
6. Record pass/fail with details
```

**Browser Automation Example (using Playwright, Puppeteer, or similar):**

```typescript
// VAL-AUTH-001: Successful login
// Navigate to login page
await page.goto('http://localhost:3000/login');
await page.screenshot({ path: 'evidence/VAL-AUTH-001-login-form.png' });

// Fill in email
await page.fill('input[type="email"]', 'test@example.com');

// Submit form
await page.click('button[type="submit"]');

// Wait for result
await page.waitForSelector('text=Check your email');
await page.screenshot({ path: 'evidence/VAL-AUTH-001-success-message.png' });

// Check console errors
const errors = await page.evaluate(() => window.__consoleErrors || []);
// Record: no errors = good
```

**Manual Browser Testing (when automation isn't available):**

```
1. Open browser to http://localhost:3000/login
2. Take screenshot of login form
3. Enter email: test@example.com
4. Click Submit
5. Observe: "Check your email" message appears
6. Take screenshot of success state
7. Open DevTools → Console: no errors
8. Open DevTools → Network: POST /api/auth/magic-link → 200
9. PASS: Login form accepts email and shows confirmation
```

#### Testing Through API (curl assertions)

```bash
# VAL-CRAWL-002: Reject non-HTTPS URL
curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST http://localhost:3000/api/crawl/start \
  -H "Content-Type: application/json" \
  -H "Cookie: session_token=..." \
  -d '{"url": "http://insecure-site.com"}'

# Expected: HTTP_CODE:400 with error message about HTTPS requirement
# Actual: (record what you get)
```

#### Testing Through Terminal (CLI/TUI assertions)

```bash
# Run the CLI command
command --flag value

# Capture output
# Compare to expected output from assertion
# Take terminal screenshot if using TUI
```

### Step 4: Record Results

For each assertion tested, record:

```json
{
  "id": "VAL-CRAWL-001",
  "title": "Start crawl with valid URL",
  "status": "pass | fail | blocked",
  "steps": [
    {
      "action": "Navigate to /dashboard/setup",
      "expected": "Setup form with URL input",
      "observed": "Setup form rendered correctly"
    },
    {
      "action": "Enter https://example.com and click Submit",
      "expected": "Loading state, then crawling status",
      "observed": "Loading spinner shown, status changed to 'Crawling...'"
    }
  ],
  "evidence": {
    "screenshots": [
      "evidence/crawl-pipeline/VAL-CRAWL-001-setup-form.png",
      "evidence/crawl-pipeline/VAL-CRAWL-001-crawling-status.png"
    ],
    "consoleErrors": "none",
    "network": "POST /api/crawl/start -> 200, body: { site_id: '...', crawl_job_id: '...' }"
  },
  "issues": null
}
```

Status meanings:
- **pass**: Assertion behavior confirmed working exactly as specified
- **fail**: Assertion behavior does not match specification (bug found). Include detailed description of the discrepancy.
- **blocked**: Cannot test because a prerequisite is broken (service down, missing data, missing feature). Include what's blocking and how to unblock.

### Step 5: Update validation-state.json

After testing all assertions for this milestone:

```json
{
  "assertions": {
    "VAL-CRAWL-001": { "status": "passed" },
    "VAL-CRAWL-002": { "status": "passed" },
    "VAL-CRAWL-003": { "status": "failed" },
    "VAL-CRAWL-004": { "status": "passed" },
    "VAL-CRAWL-005": { "status": "blocked" },
    "VAL-CRAWL-006": { "status": "passed" }
  }
}
```

### Step 6: Handle Failures

For each `"failed"` assertion:

1. **Document the failure clearly:**
   - What was expected (from validation-contract.md)
   - What actually happened
   - Evidence (screenshots, logs, network responses)

2. **Determine the fix:**
   - Is this a bug in the implementation?
   - Is this a missing feature?
   - Is this an environment issue?

3. **Create a fix feature:**
   ```json
   {
     "id": "fix-crawl-webhook-status",
     "description": "Fix: Crawl webhook handler is not updating site crawl_status to 'indexing' after receiving all pages. Currently stays as 'crawling'. The webhook handler receives Firecrawl events but the status transition to 'indexing' is missing when event type is 'completed'.",
     "skillName": "fullstack-worker",
     "milestone": "crawl-pipeline",
     "preconditions": ["crawl-webhook feature is completed"],
     "expectedBehavior": [
       "When Firecrawl sends a 'completed' event, site.crawl_status transitions to 'indexing'",
       "After processing completes, site.crawl_status transitions to 'ready'"
     ],
     "verificationSteps": [
       "pnpm vitest run -- --grep 'webhook status'",
       "Trigger webhook with completed event, verify DB status"
     ],
     "fulfills": [],
     "status": "pending"
   }
   ```

   Place fix features at the TOP of features.json so they run next.

4. **After fixes, re-run user testing:**
   - Only re-test assertions that were `"failed"` or `"blocked"`
   - Don't re-test assertions that already `"passed"`

### Step 7: Handle Blocked Assertions

For `"blocked"` assertions:

1. **If blocked by missing infrastructure** (service down, missing config):
   - Try to fix the infrastructure issue
   - If you can't fix it, escalate to the user

2. **If blocked by a missing feature** (functionality not yet implemented):
   - Move the assertion's `fulfills` to a feature in a later milestone
   - Update validation-state.json: keep as `"pending"` (not "blocked")
   - Document why it was deferred

3. **If blocked by external service** (API down, rate limited):
   - Retry after a delay
   - If still blocked, document and move on

### Step 8: Write User Testing Report

```json
// .factory/validation/{milestone}/user-testing/synthesis.json
{
  "milestone": "milestone-name",
  "testedAt": "ISO timestamp",
  "status": "pass" | "fail",
  "environment": {
    "services": ["web:3000", "postgres:5432"],
    "testDataCreated": "description of any test data seeded"
  },
  "results": {
    "total": 6,
    "passed": 4,
    "failed": 1,
    "blocked": 1,
    "skipped": 0
  },
  "failures": [
    {
      "assertionId": "VAL-CRAWL-003",
      "title": "Webhook updates crawl status",
      "expected": "Status changes to 'indexing' then 'ready'",
      "observed": "Status stays as 'crawling'",
      "evidence": "screenshot, DB query showing crawl_status='crawling'"
    }
  ],
  "blockers": [
    {
      "assertionId": "VAL-CRAWL-005",
      "title": "Setup page shows crawl progress",
      "reason": "Realtime subscription not connecting — Supabase Realtime may need configuration",
      "resolution": "Deferred to next milestone"
    }
  ],
  "summary": "4/6 assertions passed. 1 failure (webhook status transition bug). 1 blocked (Realtime config needed)."
}
```

### Step 9: Commit

```bash
git add .factory/validation/{milestone}/user-testing/
git add docs/mission/validation-state.json

# Also commit any evidence files
git add .factory/validation/{milestone}/evidence/

git commit -m "chore: user testing validation for {milestone} — 4/6 passed, 1 fix needed"
```

---

## Re-Run Procedure

When user testing is re-run after fixes:

1. Read the previous report to understand what failed
2. Only test assertions that are `"failed"` or `"blocked"` in validation-state.json
3. Skip assertions that are already `"passed"`
4. Update validation-state.json with new results
5. Update the synthesis report
6. If all assertions now pass, the milestone is complete

---

## Evidence Collection Standards

### Screenshots (MANDATORY for UI assertions)
- Take BEFORE and AFTER screenshots for each assertion
- Use descriptive filenames: `{assertion-id}-{description}.png`
- Save to `.factory/validation/{milestone}/evidence/`
- Screenshot must show the relevant UI state clearly

### Console Errors (MANDATORY for UI assertions)
- Check browser console after each page load and each action
- Record "none" if clean
- Record the full error text if errors exist

### Network Calls (when assertion involves API)
- Record: method, URL, status code, relevant response body
- For authentication: note cookie/header presence
- For errors: include the error response body

### Terminal Output (for CLI assertions)
- Capture the full command and output
- Include exit code
- For TUI: take terminal screenshots

---

## Isolation and State Management

### Between Assertions
- Each assertion should start from a known state
- If assertion A modifies data that assertion B depends on, either:
  - Test A before B (ordered execution)
  - Reset state between assertions (cleanup)
  - Use separate test data (isolation)

### Between Milestones
- Each milestone's testing starts with a clean verification of services
- Don't assume state from a previous milestone's testing

### Parallel Testing
- If testing assertions in parallel (multiple browser sessions):
  - Use separate test accounts for each parallel group
  - Don't share mutable data between parallel groups
  - Monitor system resources (memory, CPU) to avoid crashes
  - Recommended: max 3 parallel browser sessions on 16GB RAM

---

## Common Pitfalls

1. **Testing in isolation, not end-to-end.** If the assertion says "user navigates to /dashboard", actually navigate there from /login. Don't just load /dashboard directly (unless the assertion is specifically about direct URL access).

2. **Missing evidence.** Screenshots are not optional. They're the proof that the assertion passed. Without evidence, "it works on my machine" is not verifiable.

3. **Testing against the code, not the behavior.** Don't check if the function was called. Check if the user sees the expected result.

4. **Skipping error state assertions.** Testing that the happy path works is not enough. You must also test that errors are handled gracefully.

5. **Not checking console errors.** A page can look correct visually while throwing errors in the console. Always check.

6. **Not resetting state between tests.** If assertion A creates a user, and assertion B tests the empty state, B will fail unless you reset between them.

7. **Rushing through manual testing.** Take time to observe loading states, transitions, and subtle behavior. Many bugs manifest as brief flickers, wrong ordering, or transient states.
