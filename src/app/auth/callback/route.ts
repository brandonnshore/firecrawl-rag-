import { createClient } from '@/lib/supabase/server'
import { sanitizeRedirectPath } from '@/lib/auth/redirect'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = sanitizeRedirectPath(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Missing or invalid code — redirect to login with error indication
  const url = new URL('/login', origin)
  url.searchParams.set('error', 'auth_callback_error')
  return NextResponse.redirect(url.toString())
}
