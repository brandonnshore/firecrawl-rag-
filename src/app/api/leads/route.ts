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

    const {
      site_key,
      email,
      name,
      message,
      source_page,
      conversation_id,
      website,
      phone,
      source,
      extra_fields,
    } = body as {
      site_key?: string
      email?: string
      name?: string
      message?: string
      source_page?: string
      conversation_id?: string
      website?: string
      phone?: string
      source?: string
      extra_fields?: Record<string, unknown>
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

    const emailProvided = typeof email === 'string' && email.trim().length > 0
    const phoneProvided = typeof phone === 'string' && phone.trim().length > 0
    if (!emailProvided && !phoneProvided) {
      return Response.json(
        { error: 'email_or_phone_required' },
        { status: 400, headers: corsHeaders }
      )
    }
    if (emailProvided) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email!)) {
        return Response.json(
          { error: 'Invalid email format' },
          { status: 400, headers: corsHeaders }
        )
      }
    }
    if (source !== undefined && source !== 'widget' && source !== 'escalation') {
      return Response.json(
        { error: 'invalid_source' },
        { status: 400, headers: corsHeaders }
      )
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rateCheck = await checkRateLimit(`lead:${ip}`)
    if (!rateCheck.allowed) {
      return Response.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Retry-After': String(
              Math.ceil((rateCheck.retryAfterMs ?? 3000) / 1000)
            ),
          },
        }
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

    // Dedupe on (site_id, email) only when email is provided; phone-only
    // leads are always inserted as distinct rows (no stable dedupe key).
    const row = {
      site_id: site.id,
      email: emailProvided ? email!.trim().toLowerCase() : null,
      name: name?.trim() || null,
      message: message?.trim() || null,
      source_page: source_page || null,
      conversation_id: conversation_id || null,
      phone: phoneProvided ? phone!.trim() : null,
      source: source ?? 'widget',
      extra_fields:
        extra_fields && typeof extra_fields === 'object' ? extra_fields : {},
    }
    const { error: upsertError } = emailProvided
      ? await supabase.from('leads').upsert(row, { onConflict: 'site_id,email' })
      : await supabase.from('leads').insert(row)

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
