# Feature Execution — Complete Procedure

This document defines how to execute a single feature from start to finish. Every feature follows this exact procedure. No shortcuts.

---

## Prerequisites

Before starting any feature:
1. `validation-contract.md` exists and is finalized
2. `features.json` exists with 100% assertion coverage
3. `services.yaml`, `init.sh`, `AGENTS.md` exist
4. `.factory/library/architecture.md` exists
5. All precondition features are completed

---

## Execution Procedure

### Step 0: Environment Setup

Run init.sh if this is the first feature of the session:

```bash
bash .factory/init.sh
```

Verify services are running per `services.yaml`:

```bash
# For each service in services.yaml:
{healthcheck command}
# If unhealthy, start it:
{start command}
```

Run baseline tests to confirm the codebase is healthy:

```bash
{test command from services.yaml}  # e.g., pnpm vitest run
```

All existing tests must pass before you start. If they don't, fix them first — do not add new broken code on top of existing broken code.

### Step 1: Read Context

Read these files in order to understand the full context:

```
Required reading:
1. The feature entry in features.json (description, expectedBehavior, preconditions, fulfills)
2. The assertions this feature fulfills (from validation-contract.md)
3. AGENTS.md (boundaries, conventions, guidance)
4. .factory/library/architecture.md (where this feature fits)
5. .factory/library/environment.md (env vars, external services)
6. Relevant .factory/research/ files (correct API patterns)
7. Existing related code (understand current patterns)
```

### Step 2: Verify Preconditions

For each precondition in the feature:
- Is the required table/column present? Check schema.
- Is the required endpoint/page present? Check routes.
- Is the required service running? Check healthcheck.
- Is the required environment variable set?

If any precondition is NOT met:
- Check if a prior feature was supposed to create it
- If it's missing due to a bug, fix it first
- If it requires external setup (API key, service), stop and note the blocker

### Step 3: Write Tests First (TDD — Red Phase)

**Write tests BEFORE implementation.** This is not optional.

For each item in `expectedBehavior`, write at least one test:

```typescript
// Example: API route tests
describe('POST /api/crawl/start', () => {
  it('accepts valid HTTPS URL and starts crawl', async () => {
    // Arrange: mock auth, mock Firecrawl
    // Act: POST with valid URL
    // Assert: 200 response, site created, crawl started
  });

  it('rejects HTTP URL with 400', async () => {
    // Arrange: mock auth
    // Act: POST with http:// URL
    // Assert: 400 response with error message
  });

  it('rejects unauthenticated requests with 401', async () => {
    // Act: POST without auth cookie
    // Assert: 401 response
  });

  it('rejects duplicate site with 409', async () => {
    // Arrange: mock auth, existing site for user
    // Act: POST with new URL
    // Assert: 409 response
  });
});
```

```typescript
// Example: Component tests
describe('LoginPage', () => {
  it('renders email input and submit button', () => {
    // Render component
    // Assert: email input exists, submit button exists
  });

  it('shows validation error for empty email', async () => {
    // Render component
    // Act: click submit without entering email
    // Assert: error message shown
  });

  it('shows success message after submission', async () => {
    // Render component, mock API
    // Act: enter email, click submit
    // Assert: "Check your email" message shown
  });
});
```

**Run tests — they should FAIL:**

```bash
pnpm vitest run src/__tests__/{feature-test-file}.test.ts
```

If tests pass before implementation, either:
- The feature is already implemented (skip or verify thoroughly)
- The tests are wrong (they're not actually testing what they claim)

### Step 4: Implement (Green Phase)

Now implement the feature to make tests pass.

**Implementation guidelines:**

1. **Follow existing patterns.** Read 2-3 similar files in the codebase and match their style.

2. **Reference research files.** Use the correct API patterns from `.factory/research/` — do not rely on memory for SDK-specific code.

3. **Type everything.** No `any` types. Define interfaces/types for all data structures.

4. **Handle errors explicitly.** Every external call (API, DB) needs error handling. Every error needs a user-visible message.

5. **Validate inputs.** API routes validate request body. Forms validate before submission. Never trust client input.

6. **Security by default:**
   - Auth check on every protected route
   - RLS policies enforced (don't bypass with service role unnecessarily)
   - Sanitize user input (XSS prevention)
   - Validate URLs (SSRF prevention)
   - No secrets in client-side code

7. **Keep files focused.** One component per file. One route handler per file. Extract shared logic into lib/.

8. **Match the design.** Use existing CSS/component patterns. Don't introduce new styling approaches.

### Step 5: Make Tests Pass (Green)

Run the tests:

```bash
pnpm vitest run src/__tests__/{feature-test-file}.test.ts
```

**ALL tests must pass.** Fix any failures before proceeding.

Then run the full test suite to ensure you haven't broken anything:

```bash
pnpm vitest run
```

Fix any regressions.

### Step 6: Run Static Validators

```bash
# Typecheck — ZERO errors required
pnpm run typecheck

# Lint — clean required
pnpm run lint
```

Fix any issues. Do not disable or suppress warnings.

### Step 7: Manual Verification (CRITICAL)

**Every feature must be manually verified through the real user surface.**

This is not optional. Unit tests catch logic errors. Manual verification catches integration errors, UI issues, and real-world behavior.

#### For Web Pages:

```
Manual verification checklist:
□ Start the dev server if not running
□ Navigate to the page
□ Verify the page renders correctly (no errors, correct layout)
□ Check browser console for errors
□ Test each interaction (click, type, submit)
□ Verify success states (correct data shown, correct redirects)
□ Verify error states (enter bad data, check error messages)
□ Verify loading states (slow network simulation if possible)
□ Check that adjacent features still work (quick sanity)
```

Use browser automation tools if available:
```bash
# Example with agent-browser or playwright
# Navigate to page, take screenshot, check console
```

Or use curl for API endpoints:
```bash
# Test valid request
curl -X POST http://localhost:3000/api/endpoint \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{"field": "value"}'

# Test invalid request
curl -X POST http://localhost:3000/api/endpoint \
  -H "Content-Type: application/json" \
  -d '{}'

# Test unauthenticated request
curl -X POST http://localhost:3000/api/endpoint \
  -H "Content-Type: application/json" \
  -d '{"field": "value"}'
```

#### For Background Processing:

```
Manual verification checklist:
□ Trigger the process (webhook, cron, event)
□ Check database for expected records
□ Check logs for expected processing steps
□ Verify downstream effects (embeddings created, status updated)
□ Test failure cases (invalid data, service timeout)
```

### Step 8: Record Results

After verification, record what happened:

```json
{
  "feature": "feature-id",
  "status": "completed",
  "whatWasImplemented": "Detailed description of what was built",
  "whatWasLeftUndone": "Anything not completed (empty if all done)",
  "discoveredIssues": [
    "Any issues found that aren't part of this feature"
  ],
  "verification": {
    "testsRun": "pnpm vitest run — X tests passing",
    "typecheckClean": true,
    "lintClean": true,
    "manualChecks": [
      { "action": "what you did", "expected": "what should happen", "observed": "what actually happened" }
    ]
  },
  "filesChanged": [
    "src/app/api/endpoint/route.ts (created)",
    "src/__tests__/endpoint.test.ts (created)",
    "src/lib/util.ts (modified — added helper function)"
  ]
}
```

### Step 9: Commit

```bash
# Stage only files related to this feature
git add src/app/api/endpoint/route.ts
git add src/__tests__/endpoint.test.ts
git add src/lib/util.ts

# Review what you're committing
git diff --cached

# Check for secrets in the diff
# Look for: API keys, passwords, tokens, connection strings
# If found: STOP, remove them, use env vars instead

# Commit with descriptive message
git commit -m "feat: implement POST /api/endpoint with validation and error handling

- Add route handler with auth check, input validation
- Add 8 unit tests covering happy path, errors, edge cases
- Add URL validation utility for SSRF prevention
- Verified via tests and manual curl testing"
```

### Step 10: Update Feature Status

Update the feature's status in features.json to `"completed"` and move to next feature.

---

## When to Stop and Escalate

Stop working on the feature and record the blocker if:

- **External service is down**: API returning errors, database unreachable
- **Missing infrastructure**: Required table/function doesn't exist and no prior feature created it
- **Conflicting requirements**: Feature description contradicts existing code or another feature
- **Environment issue**: Missing API key, wrong version, broken dependency
- **Scope creep**: Implementation reveals the feature is much larger than described

When stopping, record:
- What was completed
- What was not completed and why
- The specific blocker
- Suggested resolution

---

## Test Writing Guidelines

### What to Test

```
Priority 1 (MUST have):
- Happy path for each expectedBehavior item
- Input validation (empty, invalid, malicious)
- Auth checks (unauthenticated, unauthorized)
- Error responses (correct status code, message format)

Priority 2 (SHOULD have):
- Edge cases (empty collections, single item, max items)
- Concurrent operations (if applicable)
- State transitions (status changes)
- Idempotency (if applicable)

Priority 3 (NICE to have):
- Performance (response time under threshold)
- Accessibility (ARIA attributes, keyboard navigation)
- Browser compatibility
```

### Test Structure

```typescript
describe('{Feature/Component/Route}', () => {
  // Setup shared by all tests
  beforeEach(() => { /* reset state */ });
  afterEach(() => { /* cleanup */ });

  describe('happy path', () => {
    it('does the expected thing with valid input', () => { /* ... */ });
  });

  describe('validation', () => {
    it('rejects empty required field', () => { /* ... */ });
    it('rejects invalid format', () => { /* ... */ });
  });

  describe('auth', () => {
    it('returns 401 for unauthenticated request', () => { /* ... */ });
    it('returns 403 for unauthorized user', () => { /* ... */ });
  });

  describe('error handling', () => {
    it('returns 500 when external service fails', () => { /* ... */ });
    it('returns 400 when request body is malformed', () => { /* ... */ });
  });

  describe('edge cases', () => {
    it('handles empty collection', () => { /* ... */ });
    it('handles very long input', () => { /* ... */ });
  });
});
```

### Mocking Guidelines

Mock external services (APIs, databases), not internal logic:

```typescript
// GOOD: Mock the external boundary
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ data: mockData, error: null }) })
  })
}));

// BAD: Mock internal functions
vi.mock('@/lib/validate', () => ({
  validateUrl: () => true  // This defeats the purpose of testing
}));
```

---

## Feature Execution Checklist

Use this checklist for every feature:

```
□ Step 0: Environment healthy (init.sh, services, baseline tests)
□ Step 1: Read context (feature, contract, AGENTS.md, architecture, research)
□ Step 2: Preconditions verified
□ Step 3: Tests written (TDD red phase — tests FAIL)
□ Step 4: Implementation complete
□ Step 5: Feature tests pass AND full suite passes
□ Step 6: Typecheck clean, lint clean
□ Step 7: Manual verification through real user surface
□ Step 8: Results recorded
□ Step 9: Committed (no secrets in diff)
□ Step 10: Feature status updated
```
