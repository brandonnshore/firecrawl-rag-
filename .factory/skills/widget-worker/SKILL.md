---
name: widget-worker
description: Builds the Preact embeddable chat widget with Vite IIFE build, Shadow DOM, and two-file lazy loading
---

# Widget Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving:
- The embeddable chat widget (widget/ directory)
- Preact components for the chat UI
- Vite IIFE build configuration
- Shadow DOM and style isolation
- Widget-to-API integration (two-step streaming)
- Widget accessibility (dialog, aria-live)

## Required Skills

- `agent-browser` — For verifying the widget on the test HTML page. Invoke after building widget features to verify bubble rendering, panel interaction, chat functionality, and accessibility.

## Work Procedure

### 1. Understand the Feature
- Read `mission.md`, `AGENTS.md`, and the feature description thoroughly
- Read `.factory/library/architecture.md` for system context
- Read `.factory/research/preact-widget.md` for Preact/Vite/Shadow DOM patterns
- Read `.factory/research/vercel-ai-sdk.md` for streaming integration patterns
- Check `features.json` for preconditions

### 2. Write Tests First (TDD)
- Create test files in `widget/src/__tests__/` BEFORE implementation
- Use Vitest (configured in widget's vitest.config.ts)
- Test component rendering, user interactions, API integration logic
- For Shadow DOM: test that styles are isolated
- For streaming: test SSE parsing and message state updates
- Run tests — confirm they FAIL (red phase)

### 3. Implement
- All widget code lives in `widget/` directory with its own package.json
- Use Preact (NOT React) — import from 'preact' and 'preact/hooks'
- Follow the two-file architecture:
  - `src/loader.ts` — entry point, reads data-site-key from document.currentScript AT PARSE TIME (before any async), creates Shadow DOM, renders bubble
  - `src/widget.tsx` — main ChatApp component, loaded on bubble click
- Shadow DOM: create with `mode: 'open'`, inject styles via CSS-in-JS or inline
- Use `<dialog>` for the chat panel (native focus trapping + Escape)
- Use `role="log"` + `aria-live="polite"` on message list
- CSS: system font stack, `all: initial` at shadow boundary, transform+opacity animations only
- Mobile: full-screen at max-width: 480px, env(safe-area-inset-*) for notched phones
- Respect `prefers-reduced-motion`
- Two-step fetch: POST to /api/chat/session, GET SSE from /api/chat/stream
- Store visitor_id in localStorage with memory fallback

### 4. Make Tests Pass (Green)
- Run tests — all must pass
- Fix any failures

### 5. Build and Verify Bundle
- Run `cd widget && pnpm build` — must produce loader.js and widget.js in dist/
- Check bundle sizes: loader < 5KB gzipped, widget < 30KB gzipped
- Verify files are copied to `public/` directory

### 6. Run Validators
- `pnpm run typecheck` (from project root — must pass)
- `cd widget && pnpm vitest run` (widget tests pass)

### 7. Manual Verification
- Ensure dev server is running (`pnpm dev` from project root)
- Use `agent-browser` to open http://localhost:3000/test-widget.html
- Verify: bubble renders, click opens panel, type message, see streaming response, close panel, reopen (messages preserved)
- Check Shadow DOM isolation (inspect that host page styles don't affect widget)
- Test keyboard: Tab navigation, Escape closes panel
- Test mobile viewport if possible

### 8. Commit
- `git add` only widget-related files
- Clear commit message

## Example Handoff

```json
{
  "salientSummary": "Built the widget loader with Shadow DOM, chat bubble, and lazy-loading of the full panel. Loader is 2.8KB gzipped. Verified via agent-browser on test-widget.html: bubble renders, opens panel on click, Escape closes.",
  "whatWasImplemented": "widget/src/loader.ts: reads data-site-key synchronously, creates Shadow DOM container, injects inline CSS, renders floating chat bubble (bottom-right, 60px circle with chat icon). On click, dynamically loads widget-full.js. widget/vite.config.ts configured for IIFE output with Preact alias. Build produces dist/rubycrawl-loader.js (2.8KB gzip) copied to public/.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd widget && pnpm build", "exitCode": 0, "observation": "Produced rubycrawl-loader.js (8.2KB raw, 2.8KB gzip) and rubycrawl-widget.js (42KB raw, 14.1KB gzip)" },
      { "command": "cd widget && pnpm vitest run", "exitCode": 0, "observation": "5 tests passing" },
      { "command": "pnpm run typecheck", "exitCode": 0, "observation": "No errors" }
    ],
    "interactiveChecks": [
      { "action": "Opened http://localhost:3000/test-widget.html in agent-browser", "observed": "Chat bubble visible in bottom-right corner, blue circle with chat icon" },
      { "action": "Clicked the chat bubble", "observed": "Panel opened with smooth animation, dialog element received focus, greeting message displayed" },
      { "action": "Pressed Escape key", "observed": "Panel closed, bubble visible again" },
      { "action": "Reopened panel", "observed": "Previous greeting still visible (state preserved)" }
    ]
  },
  "tests": {
    "added": [
      { "file": "widget/src/__tests__/loader.test.ts", "cases": [
        { "name": "reads site-key from script attribute", "verifies": "data-site-key captured at parse time" },
        { "name": "creates Shadow DOM container", "verifies": "Shadow root created with mode open" },
        { "name": "renders bubble button", "verifies": "Button element with chat icon in shadow DOM" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Chat API endpoints don't exist yet (widget depends on /api/chat/session and /api/chat/stream)
- Preact/Vite build produces unexpected errors
- Shadow DOM behavior differs from research notes
- Bundle size exceeds limits (loader > 5KB, widget > 30KB gzipped)
- Cannot test because dev server or API routes are broken
