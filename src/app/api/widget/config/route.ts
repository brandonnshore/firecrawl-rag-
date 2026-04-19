import { createServiceClient } from '@/lib/supabase/service'
import { checkSubscription } from '@/lib/subscription'
import { corsHeaders, handleCorsPreFlight } from '@/lib/chat/cors'

/**
 * GET /api/widget/config?site_key=X — loader pre-flight (M8F6).
 *
 * Answers:
 *   200 { ready: true }                   -> mount the bubble
 *   402 { error: 'subscription_inactive' } -> silently hide
 *   404 { error: 'not_found' }             -> silently hide
 *   503 { error: 'not_ready' }             -> silently hide (crawl pending)
 *
 * No rate-limit or quota charges — this endpoint exists specifically to
 * protect the customer's page from rendering a broken bubble. Keep it
 * fast: single sites lookup + subscription check, no vector search, no
 * OpenAI calls.
 */
export async function OPTIONS() {
  return handleCorsPreFlight()
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const siteKey = url.searchParams.get('site_key')
  if (!siteKey) {
    return Response.json(
      { error: 'missing_site_key' },
      { status: 400, headers: corsHeaders }
    )
  }

  const admin = createServiceClient()
  const { data: site } = await admin
    .from('sites')
    .select('id, user_id, crawl_status')
    .eq('site_key', siteKey)
    .maybeSingle<{ id: string; user_id: string; crawl_status: string }>()

  if (!site) {
    return Response.json(
      { error: 'not_found' },
      { status: 404, headers: corsHeaders }
    )
  }

  const subscription = await checkSubscription(site.user_id)
  if (!subscription.active) {
    return Response.json(
      { error: 'subscription_inactive' },
      { status: 402, headers: corsHeaders }
    )
  }

  if (site.crawl_status !== 'ready') {
    return Response.json(
      { error: 'not_ready' },
      { status: 503, headers: corsHeaders }
    )
  }

  return Response.json({ ready: true }, { headers: corsHeaders })
}
