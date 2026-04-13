# Supabase SSR Auth with Next.js 15 App Router

> **Package:** `@supabase/ssr` (NOT the deprecated `@supabase/auth-helpers-nextjs`)
> **Docs:** https://supabase.com/docs/guides/auth/server-side/nextjs
> **Last verified:** 2026-04-13

## Install

```bash
npm install @supabase/supabase-js @supabase/ssr
```

## Environment Variables

```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...   # or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # server-only, NEVER expose to client
```

> **Note:** Supabase is transitioning from `anon`/`service_role` keys to publishable keys (`sb_publishable_xxx`). Both work during the transition period. Use the "Connect" dialog in your Supabase dashboard to get the correct key.

---

## Client Factory Pattern

### Browser Client (`lib/supabase/client.ts`)

Used in Client Components (anything with `'use client'`).

```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

### Server Client (`lib/supabase/server.ts`)

Used in Server Components, Server Actions, and Route Handlers.

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}
```

### Service Role Client (server-only, bypasses RLS)

```typescript
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
```

> **⚠️ NEVER use the service role client in browser code or expose `SUPABASE_SERVICE_ROLE_KEY` via `NEXT_PUBLIC_` prefix.**

---

## Proxy (Session Refresh)

> **Important terminology change:** Supabase docs now call this "Proxy" (was "Middleware" in earlier versions). In Next.js, it maps to the `middleware.ts` file.

### `lib/supabase/proxy.ts`

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Use getClaims() NOT getSession() for server-side validation
  // getClaims() validates the JWT signature against the project's public keys
  // getSession() does NOT revalidate and can be spoofed
  const { data: { user } } = await supabase.auth.getUser()

  // Redirect unauthenticated users to login page
  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/auth') &&
    !request.nextUrl.pathname.startsWith('/api/public')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

### `middleware.ts` (project root)

```typescript
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

---

## Magic Link Auth Flow (signInWithOtp)

### Login Page (Server Action or Client Component)

```typescript
'use client'

import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // shouldCreateUser: true  // default; set false to prevent auto-signup
      },
    })

    if (error) {
      console.error('Error sending magic link:', error.message)
      return
    }
    setSubmitted(true)
  }

  if (submitted) {
    return <p>Check your email for a magic link!</p>
  }

  return (
    <form onSubmit={handleLogin}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
      />
      <button type="submit">Send Magic Link</button>
    </form>
  )
}
```

### Auth Callback Route Handler (`app/auth/callback/route.ts`)

This route exchanges the auth code from the magic link for a session.

```typescript
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Return to error page on failure
  return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
```

> **signInWithOtp behavior:**
> - If the user doesn't exist, it auto-creates them (set `shouldCreateUser: false` to prevent this)
> - Magic link vs OTP is controlled by email template: use `{{ .ConfirmationURL }}` for magic link, `{{ .Token }}` for OTP code
> - The magic link's destination URL is determined by `emailRedirectTo` (must be in your Supabase "Redirect URLs" allowlist)

---

## RLS (Row Level Security) Patterns

### Typical RLS Policy for User-Owned Data

```sql
-- Enable RLS on the table
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

-- Users can only see their own sites
CREATE POLICY "Users can view own sites"
  ON sites FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert their own sites
CREATE POLICY "Users can insert own sites"
  ON sites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own sites
CREATE POLICY "Users can update own sites"
  ON sites FOR UPDATE
  USING (auth.uid() = user_id);
```

### When to Use Service Role Key

The service role key **bypasses RLS**. Use it only for:
- Webhook handlers (e.g., Stripe webhooks, Firecrawl webhooks) that run server-side without a user session
- Admin operations (e.g., cleanup cron jobs)
- Background processing that operates on behalf of the system

```typescript
// In a webhook handler — no user session available
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(request: Request) {
  const supabase = createServiceClient()

  // This bypasses RLS — be careful!
  const { error } = await supabase
    .from('sites')
    .update({ crawl_status: 'completed' })
    .eq('id', siteId)

  return NextResponse.json({ ok: true })
}
```

---

## Key Gotchas

1. **`getClaims()` vs `getSession()`**: Always use `getClaims()` (or `getUser()`) in server code. `getSession()` does NOT validate the JWT and can be spoofed.
2. **Proxy is required**: Without the middleware/proxy, auth tokens won't refresh and users will be silently logged out.
3. **Cookie handling in Server Components**: The `setAll` try/catch is intentional — Server Components can't write cookies, only middleware/route handlers can.
4. **`@supabase/auth-helpers-nextjs` is deprecated**: Use `@supabase/ssr` instead. The migration guide is at https://supabase.com/docs/guides/auth/server-side/migrating-to-ssr-from-auth-helpers
5. **Redirect URLs**: Magic link redirect URLs must be registered in Supabase Dashboard → Auth → URL Configuration.
6. **ISR/CDN caching**: If using ISR, session refresh tokens in `Set-Cookie` can be cached and served to wrong users. Disable caching on auth-dependent routes.
