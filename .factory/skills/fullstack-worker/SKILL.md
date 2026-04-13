---
name: fullstack-worker
description: Builds Next.js pages, API routes, Supabase integration, and server-side features for RubyCrawl
---

# Fullstack Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving:
- Next.js pages (App Router) and layouts
- API route handlers (including Edge Runtime)
- Supabase integration (auth, DB queries, RLS, Realtime)
- Server-side logic (crawl pipeline, chat API, rate limiting)
- Database operations and schema
- Landing page

## Required Skills

- `agent-browser` — For verifying browser-based UI flows after implementation. Invoke after building any page or UI component to verify it renders and functions correctly.

## Work Procedure

### 1. Understand the Feature
- Read `mission.md`, `AGENTS.md`, and the feature description thoroughly
- Read `.factory/library/architecture.md` for system context
- Read relevant `.factory/research/` files for technology-specific patterns
- Check `features.json` for preconditions — verify they are met

### 2. Write Tests First (TDD)
- Create test files BEFORE implementation
- Use Vitest for unit/integration tests
- Cover: happy path, error cases, edge cases from `expectedBehavior`
- For API routes: test request validation, auth checks, error responses
- For pages: test that key elements render, forms submit correctly
- Run tests — confirm they FAIL (red phase)

### 3. Implement
- Follow existing code patterns and conventions in the codebase
- Reference `.factory/research/` files for correct API usage (especially Supabase SSR, Vercel AI SDK, Firecrawl SDK patterns)
- Use TypeScript strictly — no `any` types
- For Supabase: use `createClient` from `lib/supabase/server.ts` (server) or `lib/supabase/client.ts` (browser)
- For service role operations: use dedicated service role client, only in chat API, lead capture, and crawl webhook
- Keep components focused — one responsibility per file
- Use Tailwind CSS for styling, match existing design patterns

### 4. Make Tests Pass (Green)
- Run tests — all must pass
- Fix any failures before proceeding
- Do not skip or disable tests

### 5. Run Validators
- `pnpm run typecheck` (must pass with 0 errors)
- `pnpm run lint` (must pass)
- `pnpm vitest run` (all tests pass)

### 6. Manual Verification
- Start the dev server if not running (`pnpm dev`)
- For pages: use `agent-browser` to navigate, interact, and verify the UI works
- For API routes: use curl to test each endpoint with valid and invalid inputs
- For each verification, record what you did and what you observed
- Check that adjacent features still work (quick sanity check)

### 7. Commit
- `git add` only files related to this feature
- Write a clear commit message summarizing what was built

## Example Handoff

```json
{
  "salientSummary": "Implemented POST /api/crawl/start with URL validation (HTTPS only, reject localhost/IP), site creation, Firecrawl startCrawl() integration, and crawl_status management. All 6 tests pass, verified via curl with valid and invalid URLs.",
  "whatWasImplemented": "Crawl start API route at app/api/crawl/start/route.ts. Validates URL format (must be https, rejects localhost/private IPs). Creates sites row with crawl_status='crawling'. Calls Firecrawl startCrawl() with webhook URL and site metadata. Returns site_id and crawl_job_id. Checks auth and subscription status.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "pnpm vitest run src/__tests__/crawl-start.test.ts", "exitCode": 0, "observation": "6 tests passing: valid URL, HTTP rejected, localhost rejected, IP rejected, unauthenticated rejected, duplicate site rejected" },
      { "command": "pnpm run typecheck", "exitCode": 0, "observation": "No errors" },
      { "command": "pnpm run lint", "exitCode": 0, "observation": "No warnings" },
      { "command": "curl -X POST http://localhost:3000/api/crawl/start -H 'Content-Type: application/json' -d '{\"url\":\"https://example.com\"}'", "exitCode": 0, "observation": "401 Unauthorized (no auth cookie — correct)" }
    ],
    "interactiveChecks": [
      { "action": "Navigated to /dashboard/setup, entered https://docs.firecrawl.dev in URL field, clicked Submit", "observed": "Loading state shown, site created in DB, crawl_status set to 'crawling', Firecrawl job started" }
    ]
  },
  "tests": {
    "added": [
      { "file": "src/__tests__/crawl-start.test.ts", "cases": [
        { "name": "accepts valid HTTPS URL", "verifies": "Valid URL creates site and starts crawl" },
        { "name": "rejects HTTP URL", "verifies": "Non-HTTPS URLs return 400" },
        { "name": "rejects localhost", "verifies": "localhost URLs return 400" },
        { "name": "rejects private IPs", "verifies": "Private IP URLs return 400" },
        { "name": "rejects unauthenticated", "verifies": "No session returns 401" },
        { "name": "rejects duplicate site", "verifies": "Second site for same user returns 409" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on a Supabase table/function that hasn't been created yet
- Firecrawl or OpenAI API returns unexpected errors that suggest a configuration issue
- Feature requires changes to the database schema not covered in the plan
- Existing code patterns conflict with the feature requirements
- Cannot verify because dev server won't start
