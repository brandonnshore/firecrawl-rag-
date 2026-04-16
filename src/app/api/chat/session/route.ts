import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { buildSystemPrompt } from '@/lib/chat/system-prompt'
import { rewriteQuery } from '@/lib/chat/query-rewrite'
import { checkRateLimit } from '@/lib/chat/rate-limit'
import { storeSession } from '@/lib/chat/session-store'
import { corsHeaders, handleCorsPreFlight } from '@/lib/chat/cors'
import { openai } from '@ai-sdk/openai'
import { embed } from 'ai'
import crypto from 'crypto'

export const maxDuration = 30

export async function OPTIONS() {
  return handleCorsPreFlight()
}

export async function POST(request: NextRequest) {
  try {
    let body: {
      message?: string
      history?: Array<{ role: string; content: string }>
      site_key?: string
    }
    try {
      body = await request.json()
    } catch {
      return Response.json(
        { error: 'Invalid JSON' },
        { status: 400, headers: corsHeaders }
      )
    }

    const { message, history, site_key } = body

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return Response.json(
        { error: 'Message is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (message.length > 500) {
      return Response.json(
        { error: 'Message too long (max 500 characters)' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (!site_key || typeof site_key !== 'string') {
      return Response.json(
        { error: 'site_key is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    const supabase = createServiceClient()
    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('id, url, name, crawl_status, calendly_url, google_maps_url')
      .eq('site_key', site_key)
      .maybeSingle()

    if (siteError || !site) {
      return Response.json(
        { error: 'Invalid site key' },
        { status: 404, headers: corsHeaders }
      )
    }

    if (site.crawl_status !== 'ready') {
      return Response.json(
        { error: 'Site is not ready yet' },
        { status: 503, headers: corsHeaders }
      )
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rateLimitKey = `${ip}:${site_key}`
    const rateCheck = checkRateLimit(rateLimitKey)
    if (!rateCheck.allowed) {
      return Response.json(
        { error: 'Rate limit exceeded. Please wait a moment.' },
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

    const typedHistory = (history || []).filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string'
    )

    const rewrittenQuery = await rewriteQuery(message.trim(), typedHistory)

    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: rewrittenQuery,
    })

    // text-embedding-3-small produces cosine similarities in a narrower
    // range than older models — relevant matches typically score 0.2–0.4,
    // not 0.7+.  Threshold 0.2 keeps real matches and filters pure noise.
    const { data: chunks, error: searchError } = await supabase.rpc(
      'match_chunks',
      {
        query_embedding: JSON.stringify(embedding),
        query_text: rewrittenQuery,
        p_site_id: site.id,
        match_threshold: 0.2,
        match_count: 5,
      }
    )

    if (searchError) {
      console.error('Search error:', searchError)
      return Response.json(
        { error: 'Search failed' },
        { status: 500, headers: corsHeaders }
      )
    }

    const siteName = site.name || new URL(site.url).hostname
    const systemPrompt = buildSystemPrompt({
      siteName,
      siteUrl: site.url,
      calendlyUrl: site.calendly_url,
      googleMapsUrl: site.google_maps_url,
      chunks: chunks || [],
    })

    const sessionId = crypto.randomUUID()

    await storeSession(sessionId, {
      siteId: site.id,
      siteName,
      siteUrl: site.url,
      calendlyUrl: site.calendly_url,
      googleMapsUrl: site.google_maps_url,
      systemPrompt,
      messages: [...typedHistory, { role: 'user', content: message.trim() }],
      visitorIp: ip,
      createdAt: Date.now(),
    })

    return Response.json({ sessionId }, { headers: corsHeaders })
  } catch (err) {
    console.error('Chat session error:', err)
    return Response.json(
      { error: 'Internal error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
