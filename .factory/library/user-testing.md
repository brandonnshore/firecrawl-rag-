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
