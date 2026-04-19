import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sanitizeRedirectPath } from '@/lib/auth/redirect'
import { sendWelcomeEmail } from '@/lib/email/transactional'
import type { SupabaseClient } from '@supabase/supabase-js'
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
      await maybeFireWelcomeEmail(supabase)
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
      await maybeFireWelcomeEmail(supabase)
      return NextResponse.redirect(`${origin}${next}`)
    }
    return errorRedirect(origin)
  }

  return errorRedirect(origin)
}

/**
 * Best-effort welcome email on first successful auth exchange. Gated on
 * the service-role key so tests running without env vars are a no-op.
 * All errors swallowed — email failure must never block the redirect.
 */
async function maybeFireWelcomeEmail(
  supabase: SupabaseClient
): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return
  try {
    const { data } = await supabase.auth.getUser()
    const user = data?.user
    if (!user?.id || !user.email) return
    await sendWelcomeEmail(createServiceClient(), user.id, {
      email: user.email,
    })
  } catch (err) {
    console.error('[auth-callback] welcome email skipped:', err)
  }
}
