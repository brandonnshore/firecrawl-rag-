import { createClient } from '@/lib/supabase/server'
import { sanitizeRedirectPath } from '@/lib/auth/redirect'
import { NextResponse } from 'next/server'

/**
 * Handles both Supabase magic-link shapes:
 *   - PKCE/OAuth:  /auth/callback?code=CODE
 *   - Email OTP :  /auth/callback?token_hash=HASH&type=magiclink|email|recovery|invite
 *
 * External `next` values are stripped by sanitizeRedirectPath (VAL-AUTH-005).
 * Failures land on /login?error=auth_callback_error so replay of an already-
 * consumed link also errors (VAL-AUTH-012).
 */
type EmailOtpType =
  | 'magiclink'
  | 'email'
  | 'email_change'
  | 'recovery'
  | 'invite'
  | 'signup'

const VALID_OTP_TYPES = new Set<EmailOtpType>([
  'magiclink',
  'email',
  'email_change',
  'recovery',
  'invite',
  'signup',
])

function errorRedirect(origin: string) {
  const url = new URL('/login', origin)
  url.searchParams.set('error', 'auth_callback_error')
  return NextResponse.redirect(url.toString())
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const rawType = searchParams.get('type')
  const next = sanitizeRedirectPath(searchParams.get('next'))

  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    return errorRedirect(origin)
  }

  if (tokenHash && rawType && VALID_OTP_TYPES.has(rawType as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: rawType as EmailOtpType,
    })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    return errorRedirect(origin)
  }

  return errorRedirect(origin)
}
