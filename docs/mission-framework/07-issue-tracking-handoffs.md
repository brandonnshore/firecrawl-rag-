# Issue Tracking & Handoff Management — Complete Procedure

This document covers how to handle discovered issues, incomplete work, feature failures, and mid-mission changes. Every piece of work must be tracked — nothing is silently dropped.

---

## Core Principle

**Everything is tracked.** If an issue is discovered, it gets a feature. If work is incomplete, it's documented. If a feature fails, it's retried. "Low priority" or "non-blocking" is NOT a valid reason to skip tracking.

---

## Feature Handoff Records

After completing each feature, record a structured handoff:

```json
{
  "featureId": "crawl-start-api",
  "completedAt": "2024-01-15T10:30:00Z",
  "status": "completed",

  "whatWasImplemented": "POST /api/crawl/start with URL validation (HTTPS only, SSRF protection), auth check, one-site-per-account enforcement, Firecrawl startCrawl() integration. Returns site_id and crawl_job_id on success.",

  "whatWasLeftUndone": "",

  "discoveredIssues": [
    {
      "description": "The Supabase RLS policy for sites table allows SELECT from any authenticated user, not just the owner. Should restrict to user_id = auth.uid().",
      "severity": "security",
      "affectsFeature": "supabase-schema-setup"
    }
  ],

  "verification": {
    "testsRun": "pnpm vitest run — 55 tests passing",
    "typecheckClean": true,
    "lintClean": true,
    "manualChecks": [
      {
        "action": "POST /api/crawl/start with valid HTTPS URL",
        "expected": "200 with site_id",
        "observed": "200 with site_id and crawl_job_id"
      },
      {
        "action": "POST /api/crawl/start with HTTP URL",
        "expected": "400 with error",
        "observed": "400 with 'URL must use HTTPS' error"
      }
    ]
  },

  "filesChanged": [
    "src/app/api/crawl/start/route.ts (created)",
    "src/lib/crawl/validate-url.ts (created)",
    "src/__tests__/crawl-start.test.ts (created)",
    "src/__tests__/validate-url.test.ts (created)"
  ]
}
```

---

## Handling Discovered Issues

When you discover an issue during feature implementation:

### Decision Tree

```
Is the issue BLOCKING the current feature?
├── YES → Fix it now as part of this feature
│         Record in handoff under whatWasImplemented
│
└── NO → Is it a SECURITY issue?
    ├── YES → Create a fix feature at TOP of features.json
    │         Mark as highest priority
    │
    └── NO → Is it related to the current milestone?
        ├── YES → Create a fix feature in current milestone
        │         Place before the milestone's validation features
        │
        └── NO → Create a fix feature in a misc-* milestone
                  (max 5 features per misc milestone)
```

### Creating Fix Features

```json
{
  "id": "fix-rls-sites-select",
  "description": "Fix: Sites table RLS policy allows SELECT from any authenticated user. Must restrict to user_id = auth.uid() to prevent data leakage between accounts.",
  "skillName": "fullstack-worker",
  "milestone": "crawl-pipeline",
  "preconditions": ["supabase-schema-setup is completed"],
  "expectedBehavior": [
    "RLS SELECT policy checks user_id = auth.uid()",
    "Authenticated user A cannot read user B's sites",
    "Service role bypasses RLS (for webhook processing)"
  ],
  "verificationSteps": [
    "Test RLS with two different auth tokens",
    "Verify service role can still read all sites"
  ],
  "fulfills": [],
  "status": "pending"
}
```

### Placement Rules

- **Blocking/security issues**: TOP of features.json (runs next)
- **Current milestone issues**: Before validation features in current milestone
- **Unrelated issues**: In a `misc-*` milestone (create one if needed, max 5 features each)
- **Never**: In a sealed milestone

---

## Handling Incomplete Work

When a feature can't be fully completed:

### Document What's Missing

```json
{
  "whatWasLeftUndone": "Realtime subscription for crawl progress not implemented. The Supabase Realtime config requires additional setup (enable replication for the sites table) that I couldn't do from the application code. The setup page shows current status on load but doesn't live-update.",

  "blockerType": "external_setup",
  "suggestedResolution": "Enable Supabase Realtime replication for the sites table in the Supabase dashboard. Then the existing RealtimeChannel subscription code will work."
}
```

### Actions

1. **Create a follow-up feature** for the incomplete work
2. **Move affected assertions** from the incomplete feature's `fulfills` to the follow-up feature
3. **Update the original feature's fulfills** to only include what was actually completed
4. **Commit what was completed** — partial progress is still progress

---

## Handling Feature Failures

When a feature attempt results in broken code:

### Failure Response

1. **Revert to a clean state** if the code doesn't compile or tests don't pass:
   ```bash
   git stash  # or git checkout -- .
   ```

2. **Record the failure:**
   ```json
   {
     "featureId": "crawl-webhook",
     "status": "failed",
     "reason": "Firecrawl webhook sends events in a format that doesn't match the documented schema. The 'completed' event has nested data under 'result.data' instead of 'data' as documented.",
     "attemptedApproach": "Followed Firecrawl SDK docs for webhook event format",
     "whatWorked": "Webhook endpoint receives events, auth token validation works",
     "whatFailed": "Event parsing fails because the actual payload structure differs from docs",
     "suggestedResolution": "Update webhook handler to check for result.data first, then fall back to data"
   }
   ```

3. **Set feature status back to `"pending"`** — it will be retried

4. **Update the feature description** with the failure context so the retry has better information:
   ```json
   {
     "description": "...(original description)...\n\nIMPORTANT: Previous attempt failed because Firecrawl webhook events have payload at result.data, not data. Handle both formats for safety."
   }
   ```

---

## Handling Validation Failures

### Scrutiny Failures

When scrutiny validation finds issues:

1. **For each blocking code review issue:**
   - Create a fix feature at the TOP of features.json
   - Reference the specific file and line number
   - Include the reviewer's description of the issue

2. **For test/typecheck/lint failures:**
   - Create a fix feature with specific error messages
   - Include the full error output in the description

3. **After creating fix features:**
   - The scrutiny validator will re-run after fixes complete
   - On re-run, it only re-reviews features that had blocking issues

### User Testing Failures

When user testing finds assertion failures:

1. **For each failed assertion:**
   - Create a fix feature at the TOP of features.json
   - Include: assertion ID, expected behavior, actual behavior, evidence
   - Add new assertions if the bug reveals gaps in the contract

2. **For blocked assertions:**
   - If blocked by infrastructure: try to fix, escalate to user if you can't
   - If blocked by missing feature: defer to a later milestone

3. **After creating fix features:**
   - The user testing validator will re-run after fixes complete
   - On re-run, it only re-tests assertions that were failed or blocked

---

## Mid-Mission User Changes

When the user requests changes during execution:

### Scope Additions

1. **Add assertions** to `validation-contract.md` for the new requirement
2. **Add assertion IDs** to `validation-state.json` as `"pending"`
3. **Create features** in features.json with `fulfills` referencing the new assertions
4. **Update shared state** (AGENTS.md, architecture.md, etc.) if affected
5. **Verify 100% coverage** — every assertion claimed by exactly one feature

### Scope Removals

1. **Set affected features** to `status: "cancelled"` (don't delete — history)
2. **Move cancelled features** to bottom of array
3. **Remove assertions** from `validation-contract.md` and `validation-state.json`
4. **Remove orphaned `fulfills`** from other features that referenced removed assertions
5. **Verify no orphans** — no fulfills references point to removed assertions

### Requirement Changes

1. **Update assertions** in `validation-contract.md` with new behavior
2. **If the change invalidates a "passed" result**, reset to `"pending"` in `validation-state.json`
3. **Update affected features'** descriptions and expectedBehavior
4. **Update shared state** if affected (AGENTS.md, architecture, library)

---

## Misc Milestones

For non-blocking issues discovered during execution that don't belong in any existing milestone:

### Rules

- Max 5 features per misc milestone
- Name format: `misc-{descriptor}` (e.g., `misc-security-fixes`, `misc-ux-polish`)
- Never add to a sealed milestone
- Create new misc milestones as needed (2-3 milestones ahead of current work)
- Misc milestones still go through scrutiny + user testing validation

### Example

```json
{
  "id": "fix-console-warnings",
  "description": "Fix React hydration warnings in dashboard sidebar. React reports 'Text content did not match' for the active nav item. Likely a server/client rendering mismatch.",
  "skillName": "fullstack-worker",
  "milestone": "misc-ux-fixes",
  "preconditions": [],
  "expectedBehavior": [
    "No console warnings on /dashboard page load",
    "Sidebar active state renders consistently between server and client"
  ],
  "verificationSteps": [
    "Open /dashboard in browser, check console for warnings",
    "Hard refresh page, verify no hydration mismatch"
  ],
  "fulfills": [],
  "status": "pending"
}
```

---

## Sealed Milestone Policy

Once a milestone's scrutiny AND user testing validators both pass:

1. The milestone is **SEALED** — no new features may be added
2. Any new work discovered goes to:
   - A follow-up milestone (e.g., `auth-followup`) for related work needing its own testing
   - A `misc-*` milestone for small, unrelated fixes
3. This ensures every change gets a validation pass

### What Counts as "Sealed"

```
Milestone sealed when ALL are true:
□ All implementation features: status "completed"
□ Scrutiny validation: passed
□ User testing validation: passed
□ All assertions in this milestone's fulfills: "passed" in validation-state.json
```

---

## Progress Tracking

### Monitoring Mission Health

Regularly check:

```
Mission health indicators:
- Features completed / total features
- Assertions passed / total assertions
- Current milestone progress
- Number of discovered issues (tracked vs untracked)
- Number of fix features created
- Number of re-runs needed for validators
```

### When to Escalate to User

Stop and return to the user when:
- External service is down and you can't fix it
- API credentials are expired or invalid
- Database is unreachable
- A requirement is ambiguous and affects implementation direction
- Scope has grown significantly beyond the original plan
- Mission boundaries would need to change

When escalating, provide:
- Clear description of the blocker
- What you've already tried
- What the user needs to do
- What happens after the blocker is resolved

---

## Handoff File Management

Store handoff records in a consistent location:

```
docs/mission/
├── handoffs/
│   ├── scaffold-nextjs-project.json
│   ├── supabase-schema-setup.json
│   ├── auth-magic-link-flow.json
│   └── ...
├── features.json
├── validation-contract.md
├── validation-state.json
└── mission.md
```

Each handoff file is named after the feature ID and contains the full handoff record.
