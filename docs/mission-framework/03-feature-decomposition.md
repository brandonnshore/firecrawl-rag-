# Feature Decomposition — Complete Procedure

Feature decomposition translates the validation contract (what the system must DO) into a sequence of implementable work units. Each feature maps to specific assertions via `fulfills`, ensuring 100% coverage.

---

## Core Principles

1. **Contract-driven decomposition.** Features exist to fulfill assertions. If an assertion has no feature, it will never be tested. If a feature has no assertion, it has no definition of success.

2. **`fulfills` means "completes", not "contributes to".** Only the leaf feature that makes an assertion fully testable claims it. Infrastructure/foundational features have empty `fulfills`.

3. **Each assertion claimed exactly once.** No duplicates (confusing ownership), no orphans (untested behavior).

4. **Order matters.** Features are executed in array order. Foundational features first, then milestone by milestone.

---

## features.json Schema

```json
{
  "features": [
    {
      "id": "unique-kebab-case-id",
      "description": "What to build. Be specific: what endpoint, what page, what behavior. Include edge cases and error handling expectations.",
      "skillName": "fullstack-worker",
      "milestone": "milestone-name",
      "preconditions": [
        "What must be true before starting (specific, verifiable)"
      ],
      "expectedBehavior": [
        "What success looks like (specific, testable statements)",
        "Returns 200 with { field: value } when condition is met",
        "Returns 400 with { error: 'message' } when validation fails",
        "Shows loading state while processing",
        "Displays error toast on failure"
      ],
      "verificationSteps": [
        "How to verify this works (commands to run, pages to visit)",
        "npm test -- --grep 'feature name' (expect N test cases)",
        "curl POST /api/endpoint with valid payload, verify 200",
        "Manual: Navigate to /page, fill form, submit, verify redirect"
      ],
      "fulfills": ["VAL-AREA-001", "VAL-AREA-002"],
      "status": "pending"
    }
  ]
}
```

### Field Details

| Field | Description | Required |
|-------|-------------|----------|
| `id` | Unique kebab-case identifier | Yes |
| `description` | Detailed description of what to build. The more specific, the better the implementation. Include error handling, edge cases, security requirements. | Yes |
| `skillName` | Which type of work this is (maps to a worker skill). Common: `fullstack-worker`, `widget-worker`, `api-worker`, `frontend-worker` | Yes |
| `milestone` | Vertical slice this feature belongs to | Yes |
| `preconditions` | Array of conditions that must be true before starting. Reference specific features, tables, endpoints. | Yes |
| `expectedBehavior` | Array of specific, testable success criteria. Each should be verifiable. | Yes |
| `verificationSteps` | Array of concrete steps to verify the feature works. Include test commands, curl commands, manual checks. | Yes |
| `fulfills` | Array of validation contract assertion IDs this feature COMPLETES. Empty for foundational features. | Yes |
| `status` | Lifecycle state: `pending`, `in_progress`, `completed`, `failed`, `cancelled` | Yes |

---

## Decomposition Procedure

### Step 1: Map Assertions to Feature Clusters

Group related assertions that should be implemented together:

```
Example: Authentication
- VAL-AUTH-001 (successful login) ─┐
- VAL-AUTH-002 (login validation)  ├─→ Feature: "auth-login-flow"
- VAL-AUTH-003 (protected redirect) │
- VAL-AUTH-004 (logout)           ─┘

- VAL-AUTH-005 (signup)           ─┐
- VAL-AUTH-006 (signup validation) ├─→ Feature: "auth-signup-flow"
- VAL-AUTH-007 (duplicate email)  ─┘
```

Guidelines for clustering:
- Group assertions that share the same code path (same page, same endpoint)
- Keep features focused: 2-6 assertions per feature is ideal
- If a cluster has 10+ assertions, consider splitting into sub-features
- Cross-area assertions often go in their own "integration" features

### Step 2: Identify Foundational Features

Some work must happen before any assertions can be tested:
- Project scaffolding
- Database schema setup
- Authentication infrastructure
- Shared layout/navigation

These features have empty `fulfills` — they don't complete any assertions directly, but they're preconditions for features that do.

### Step 3: Order by Milestone and Dependency

```
Milestone 1: Foundation
  1. scaffold-project          (fulfills: [])
  2. database-schema           (fulfills: [])
  3. auth-login-flow           (fulfills: [VAL-AUTH-001, VAL-AUTH-002, VAL-AUTH-003])
  4. dashboard-shell           (fulfills: [VAL-DASH-001])

Milestone 2: Core Feature
  5. crawl-start-api           (fulfills: [VAL-CRAWL-001, VAL-CRAWL-002])
  6. crawl-webhook-processing  (fulfills: [VAL-CRAWL-003, VAL-CRAWL-004])
  7. crawl-setup-page          (fulfills: [VAL-CRAWL-005, VAL-CRAWL-006])

...

Cross-area (later milestone):
  18. cross-area-integration   (fulfills: [VAL-CROSS-001, VAL-CROSS-002, VAL-CROSS-003])
```

### Step 4: Write Detailed Descriptions

Each feature description should be detailed enough that someone unfamiliar with the project can implement it. Include:

```
BAD description:
"Implement the login page"

GOOD description:
"Create login page at /login with email-only magic link flow. Form has
single email input with validation (required, valid email format).
On submit: POST to /api/auth/magic-link, show 'Check your email' message
(same message for all emails to prevent enumeration). Handle: network
errors (show toast), rate limiting (show 'too many attempts'). Page
redirects to /dashboard if user is already authenticated. Styled with
Tailwind, matches existing design patterns."
```

### Step 5: Coverage Verification (REQUIRED)

After creating features.json, verify 100% assertion coverage:

```
Verification procedure:
1. Extract all assertion IDs from validation-contract.md
2. Extract all fulfills arrays from features.json
3. Flatten all fulfills into a single list
4. Check: every contract assertion appears exactly once in fulfills
5. Check: no assertion appears in more than one feature's fulfills
6. Check: no fulfills reference references a non-existent assertion
```

If any assertion is unclaimed → create a feature for it.
If any assertion appears twice → remove the duplicate (keep it in the more specific feature).
If any fulfills reference doesn't exist → remove it.

---

## Feature Types

### Infrastructure Features
- `fulfills: []` (no assertions — these enable other features)
- Examples: project scaffolding, DB schema, shared components
- Must be early in the order

### Leaf Features
- `fulfills: ["VAL-AREA-001", ...]` (claims specific assertions)
- These are the features that actually make assertions testable
- Most features are leaf features

### Integration Features
- `fulfills: ["VAL-CROSS-001", ...]` (claims cross-area assertions)
- Usually later in the milestone order
- Often span multiple areas (auth + feature A + feature B)

### Fix Features
- Created when scrutiny or user testing finds issues
- Placed at TOP of features.json (run next)
- `fulfills` may reference new assertions added for bug fixes

---

## Common Pitfalls

1. **Features too large.** If a feature has 10+ assertions or would take more than a few hours, split it. Large features are harder to verify and more likely to have issues.

2. **Features too small.** If a feature has one trivial assertion and no meaningful code, consider combining with a related feature. Overhead of context-switching has a cost.

3. **Vague descriptions.** "Build the dashboard" tells you nothing. "Build /dashboard page showing sites list with name, URL, crawl status, last crawled date. Empty state shows 'No sites yet' with link to /dashboard/setup. Each site row links to /dashboard/sites/{id}. Data fetched server-side via Supabase." tells you everything.

4. **Missing preconditions.** If a feature needs a database table that's created in another feature, list it as a precondition. Otherwise you'll waste time debugging missing tables.

5. **Ordering errors.** A feature that depends on auth being set up must come AFTER the auth feature. Always verify the dependency chain.

6. **Orphaned assertions.** After creating features, double-check that every assertion is claimed. Orphaned assertions are invisible failures — they never get tested.

7. **Duplicate fulfills.** Two features both claiming VAL-AUTH-001 means confusion about who's responsible. Each assertion gets one owner.

---

## Updating features.json Mid-Mission

### Adding Features
- Place at appropriate position in array (foundational = early, fixes = top)
- Ensure new feature's `fulfills` don't duplicate existing claims
- Verify coverage remains at 100%

### Reordering Features
- Move urgent/blocking features to top
- Keep milestone grouping intact when possible

### Cancelling Features
- Set `status: "cancelled"`
- Move to bottom of array
- Remove from `fulfills` any assertions that are now unclaimed
- Create replacement feature or move assertions to another feature

### Splitting Features
- Original feature → cancelled
- Create two+ new features splitting the assertions
- Verify no assertion orphans
