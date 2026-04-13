# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Required Environment Variables

All in `.env.local`:

| Variable | Purpose | Public? |
|----------|---------|---------|
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL | Yes (client) |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon/public key | Yes (client) |
| SUPABASE_SERVICE_ROLE_KEY | Bypasses RLS — server only | NO |
| OPENAI_API_KEY | Embeddings + chat | NO |
| FIRECRAWL_API_KEY | Website crawling | NO |
| NEXT_PUBLIC_APP_URL | App URL for webhook callbacks | Yes (client) |

## External Services

- **Supabase** (rubycrawl project, ref: luznxhpadjblwnkfzjhn, us-east-1): Auth, Postgres+pgvector, RLS, Realtime
- **OpenAI**: text-embedding-3-small (embeddings), gpt-4o-mini (chat)
- **Firecrawl**: Async website crawling via startCrawl() + webhook
- **Redis**: Local on port 6379 for rate limiting

## Supabase Setup Notes

- Project linked via `supabase link --project-ref luznxhpadjblwnkfzjhn`
- DB schema must be run in Supabase SQL editor (not local migrations) — includes pgvector extension, RLS policies, triggers
- Add `http://localhost:3000/auth/callback` to Supabase Dashboard > Auth > URL Configuration > Redirect URLs
- Magic link emails come from Supabase's built-in email service (no custom SMTP needed for dev)

## Stripe (Deferred)

Stripe billing is NOT implemented in this mission. Subscription check is stubbed to always return "active". The stub is designed for easy Stripe integration later.
