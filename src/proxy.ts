import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static, _next/image, favicon.ico and common static assets
     * - /api/* — proxies re-wrap Response bodies and buffer streaming
     *   responses, which corrupts the \x1E sentinel in /api/chat/stream.
     *   API routes do their own auth via createClient(), they don't
     *   need cookie refresh from the proxy.
     * - /rubycrawl-*.js — widget loader + bundle are public statics
     *   embedded on customer sites; no auth cookie work needed.
     */
    '/((?!api/|_next/static|_next/image|favicon.ico|rubycrawl-[^/]+\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
