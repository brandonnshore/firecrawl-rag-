import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Paths under /dashboard that should remain reachable even when the
 * caller's subscription isn't active — typically because they need
 * access to update their card or re-subscribe after past_due.
 */
const DASHBOARD_BYPASS_PREFIXES = [
  '/dashboard/settings/billing',
  // Keep /dashboard/settings root reachable so the billing link in the
  // settings sidebar doesn't 404 when the sidebar itself renders.
  '/dashboard/settings',
]

function pathBypassesGate(pathname: string): boolean {
  return DASHBOARD_BYPASS_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

function subscriptionAllowsDashboard(profile: {
  subscription_status: string | null
  trial_ends_at: string | null
  current_period_end: string | null
}): boolean {
  const status = profile.subscription_status
  const now = Date.now()

  if (status === 'active') return true
  if (status === 'trialing') {
    return (
      !!profile.trial_ends_at &&
      new Date(profile.trial_ends_at).getTime() > now
    )
  }
  if (status === 'canceled') {
    // Paid-through grace period — still in their billing window.
    return (
      !!profile.current_period_end &&
      new Date(profile.current_period_end).getTime() > now
    )
  }
  return false
}

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
          cookiesToSet.forEach(({ name, value }) =>
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

  // IMPORTANT: Use getUser() NOT getSession() for server-side JWT validation.
  // getUser() validates the JWT signature; getSession() does NOT and can be spoofed.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Protect /dashboard/* routes — redirect unauthenticated users to /login
  if (!user && pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Bounce an already-active user away from /subscribe back into the
  // product — /subscribe is only for users who haven't paid yet.
  if (user && pathname === '/subscribe') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_status, trial_ends_at, current_period_end')
      .eq('id', user.id)
      .maybeSingle<{
        subscription_status: string | null
        trial_ends_at: string | null
        current_period_end: string | null
      }>()
    if (profile && subscriptionAllowsDashboard(profile)) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // Paywall: any /dashboard path except the bypass list requires an
  // active (or trialing/paid-through-grace) subscription. Redirect
  // new authed-but-unpaid users to /subscribe so they can't reach
  // dashboards that would spend OpenAI / Firecrawl budget.
  if (
    user &&
    pathname.startsWith('/dashboard') &&
    !pathBypassesGate(pathname)
  ) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_status, trial_ends_at, current_period_end')
      .eq('id', user.id)
      .maybeSingle<{
        subscription_status: string | null
        trial_ends_at: string | null
        current_period_end: string | null
      }>()

    if (!profile || !subscriptionAllowsDashboard(profile)) {
      const url = request.nextUrl.clone()
      url.pathname = '/subscribe'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
