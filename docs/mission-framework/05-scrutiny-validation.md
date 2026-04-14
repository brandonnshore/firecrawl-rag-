# Scrutiny Validation — Complete Procedure

Scrutiny validation is a quality gate that runs after all implementation features in a milestone are complete. It verifies that the code is correct, consistent, and meets the mission's quality standards through automated checks and manual code review.

---

## When to Run

Run scrutiny validation when ALL implementation features in a milestone have status `"completed"`.

Do NOT run scrutiny before all features are done — partial validation wastes effort.

---

## Procedure

### Step 1: Run Automated Validators

Run all automated quality checks. ALL must pass.

```bash
# 1. Full test suite
{test command from services.yaml}
# e.g., pnpm vitest run

# 2. TypeScript type checking
{typecheck command from services.yaml}
# e.g., pnpm run typecheck

# 3. Linting
{lint command from services.yaml}
# e.g., pnpm run lint
```

If any of these fail:
1. **Test failures**: Fix the tests or the code. Do not disable tests.
2. **Type errors**: Fix the types. Do not use `@ts-ignore` or `any`.
3. **Lint errors**: Fix the code. Do not add eslint-disable comments.

After fixing, re-run ALL validators to confirm nothing else broke.

### Step 2: Code Review Each Feature

For each completed feature in this milestone, perform a thorough code review.

#### Review Checklist (per feature)

```
CORRECTNESS:
□ Does the implementation match the feature's expectedBehavior?
□ Are all assertions in the feature's fulfills actually testable now?
□ Are there logic bugs? (off-by-one, null checks, race conditions)
□ Are all error paths handled? (network failures, invalid data, timeouts)
□ Are edge cases covered? (empty arrays, null values, max limits)

SECURITY:
□ Auth checks on every protected route?
□ Input validation on all user inputs?
□ No SQL injection vectors? (parameterized queries)
□ No XSS vectors? (sanitized output, Content-Security-Policy)
□ No SSRF vectors? (URL validation for user-provided URLs)
□ No secrets in code? (API keys, passwords in source)
□ No sensitive data in logs? (PII, tokens)
□ RLS policies enforced? (not bypassed with service role unnecessarily)

CODE QUALITY:
□ Types are specific? (no any, no overly broad unions)
□ Functions are focused? (single responsibility)
□ Error messages are helpful? (not generic "something went wrong")
□ No dead code? (unused imports, unreachable branches)
□ No commented-out code? (either remove or explain why it's there)
□ Naming is clear? (variables, functions, files describe what they do)
□ No magic numbers/strings? (use constants or enums)

CONSISTENCY:
□ Matches existing code patterns in the codebase?
□ Uses existing utilities instead of reimplementing?
□ File structure follows project conventions?
□ Test patterns match existing test files?

TESTING:
□ Tests cover all expectedBehavior items?
□ Tests cover error cases? (not just happy path)
□ Tests are deterministic? (no timing dependencies, no external service calls)
□ Test descriptions are clear? (describe the behavior, not the implementation)
□ Mocks are minimal? (mock boundaries, not internals)
```

#### Review Output Format

For each feature, record:

```json
{
  "featureId": "feature-id",
  "status": "pass" | "fail",
  "codeReview": {
    "summary": "Brief assessment of the implementation quality",
    "issues": [
      {
        "file": "src/path/to/file.ts",
        "line": 42,
        "severity": "blocking" | "non_blocking",
        "description": "What's wrong and how to fix it"
      }
    ]
  },
  "sharedStateObservations": [
    {
      "area": "conventions | skills | services | knowledge",
      "observation": "What you noticed that should be documented",
      "evidence": "Specific file:line or pattern reference"
    }
  ]
}
```

### Step 3: Fix Blocking Issues

If any feature review has `status: "fail"` with blocking issues:

1. Fix each blocking issue
2. Re-run all automated validators (step 1)
3. Re-review the affected files (focus on the changes)
4. Commit fixes with clear messages

Repeat until all reviews pass.

### Step 4: Update Shared State

Apply any shared state observations from the reviews:

- **Convention gaps**: Add missing conventions to AGENTS.md
- **Service gaps**: Add missing commands/services to services.yaml
- **Knowledge gaps**: Add missing knowledge to .factory/library/ files
- **Skill gaps**: Update skill files if procedures don't match reality

### Step 5: Write Scrutiny Report

Create the scrutiny validation report:

```json
// .factory/validation/{milestone}/scrutiny/synthesis.json
{
  "milestone": "milestone-name",
  "validatedAt": "ISO timestamp",
  "status": "pass" | "fail",
  "automatedChecks": {
    "tests": { "status": "pass", "total": 95, "passed": 95, "failed": 0 },
    "typecheck": { "status": "pass", "errors": 0 },
    "lint": { "status": "pass", "warnings": 0 }
  },
  "featureReviews": [
    {
      "featureId": "feature-id",
      "status": "pass",
      "issueCount": { "blocking": 0, "non_blocking": 2 },
      "summary": "Clean implementation, minor style issues"
    }
  ],
  "appliedUpdates": [
    "Updated services.yaml: added test:coverage command",
    "Updated library/environment.md: documented FIRECRAWL_WEBHOOK_SECRET"
  ],
  "suggestedGuidanceUpdates": [
    {
      "target": "AGENTS.md",
      "suggestion": "Add convention: all API routes must use withAuth wrapper",
      "evidence": "3/4 features used withAuth, 1 did manual auth check"
    }
  ],
  "summary": "All 4 features pass scrutiny. 0 blocking issues. 6 non-blocking suggestions recorded."
}
```

### Step 6: Commit

```bash
# Stage scrutiny artifacts
git add .factory/validation/{milestone}/scrutiny/

# Also stage any shared state updates
git add AGENTS.md .factory/services.yaml .factory/library/

git commit -m "chore: scrutiny validation for {milestone} — all pass"
```

---

## Re-Run Procedure

When scrutiny is re-run after fixing issues:

1. Read the previous scrutiny report to understand what failed
2. Only re-review features that had blocking issues (plus their fix commits)
3. Re-run ALL automated validators (tests, typecheck, lint)
4. Update the scrutiny report with new results

---

## Common Issues and Resolutions

### Flaky Tests
- Identify the flaky test (runs differently each time)
- Fix the root cause (usually timing, external dependencies, or shared state)
- Do NOT skip or retry-loop flaky tests

### Pre-Existing Failures
- If a test fails that's unrelated to this milestone's features:
  - Document it in AGENTS.md under "Known Pre-Existing Issues"
  - Do NOT fix it as part of this milestone (out of scope)
  - Continue with scrutiny validation

### Type Errors in Unchanged Code
- If typecheck finds errors in files not modified by this milestone:
  - Check if a dependency update caused it
  - Document in AGENTS.md if pre-existing
  - Fix only if it's actually caused by this milestone's changes

---

## Quality Bar

Scrutiny validation passes when:

```
Hard gates (must ALL be true):
□ All tests pass
□ Typecheck has zero errors
□ Lint is clean
□ All feature reviews have status "pass" (no unresolved blocking issues)

Soft gates (should be true):
□ Non-blocking issues are documented
□ Shared state is updated with observations
□ No security issues found
□ Code follows project conventions
```
