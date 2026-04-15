import { createServiceClient } from '@/lib/supabase/service'
import { checkRateLimit } from '@/lib/chat/rate-limit'
import { corsHeaders, handleCorsPreFlight } from '@/lib/chat/cors'

export async function OPTIONS() {
  return handleCorsPreFlight()
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return Response.json(
        { error: 'Invalid JSON' },
        { status: 400, headers: corsHeaders }
      )
    }

    const { site_key, email, name, message, source_page, conversation_id, website } =
      body as {
        site_key?: string
        email?: string
        name?: string
        message?: string
        source_page?: string
        conversation_id?: string
        website?: string
      }

    if (website && typeof website === 'string' && website.trim().length > 0) {
      return Response.json({ success: true }, { headers: corsHeaders })
    }

    if (!site_key || typeof site_key !== 'string') {
      return Response.json(
        { error: 'site_key is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (!email || typeof email !== 'string') {
      return Response.json(
        { error: 'email is required' },
        { status: 400, headers: corsHeaders }
      )
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return Response.json(
        { error: 'Invalid email format' },
        { status: 400, headers: corsHeaders }
      )
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rateCheck = checkRateLimit(`lead:${ip}`)
    if (!rateCheck.allowed) {
      return Response.json(
        { error: 'Too many requests' },
        { status: 429, headers: corsHeaders }
      )
    }

    const supabase = createServiceClient()
    const { data: site } = await supabase
      .from('sites')
      .select('id')
      .eq('site_key', site_key)
      .maybeSingle()

    if (!site) {
      return Response.json(
        { error: 'Invalid site key' },
        { status: 404, headers: corsHeaders }
      )
    }

    const { error: upsertError } = await supabase
      .from('leads')
      .upsert(
        {
          site_id: site.id,
          email: email.trim().toLowerCase(),
          name: name?.trim() || null,
          message: message?.trim() || null,
          source_page: source_page || null,
          conversation_id: conversation_id || null,
        },
        { onConflict: 'site_id,email' }
      )

    if (upsertError) {
      console.error('Lead upsert error:', upsertError)
      return Response.json(
        { error: 'Failed to save lead' },
        { status: 500, headers: corsHeaders }
      )
    }

    return Response.json(
      { success: true },
      { status: 201, headers: corsHeaders }
    )
  } catch (err) {
    console.error('Lead capture error:', err)
    return Response.json(
      { error: 'Internal error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
