import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { buildSystemPrompt } from '@/lib/chat/system-prompt'
import { rewriteQuery } from '@/lib/chat/query-rewrite'
import { checkRateLimit } from '@/lib/chat/rate-limit'
import { storeSession } from '@/lib/chat/session-store'
import { corsHeaders, handleCorsPreFlight } from '@/lib/chat/cors'
import { checkSubscription } from '@/lib/subscription'
import {
  matchResponse,
  type ResponseRule,
} from '@/lib/chat/response-matcher'
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
      .select('id, url, name, user_id, crawl_status, calendly_url, google_maps_url')
      .eq('site_key', site_key)
      .maybeSingle()

    if (siteError || !site) {
      return Response.json(
        { error: 'Invalid site key' },
        { status: 404, headers: corsHeaders }
      )
    }

    // Gate on the site OWNER's subscription — widget callers are anonymous
    // but the owner is who pays. 402 signals "billing required" to the
    // widget; the widget renders a generic degraded state and does not
    // surface owner-dashboard details to visitors.
    const subscription = await checkSubscription(site.user_id)
    if (!subscription.active) {
      return Response.json(
        {
          error: 'subscription_inactive',
          reason: subscription.reason,
          upgrade_url: subscription.upgradeUrl ?? '/dashboard/billing',
        },
        { status: 402, headers: corsHeaders }
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

    // Message-quota gate (M3F2). Resolve the site owner's monthly limit,
    // then atomically increment via RPC. On deny, 402 and skip all OpenAI
    // work — we never pay for inference we're about to reject.
    const messageLimit = await resolveOwnerMessageLimit(supabase, site.user_id)
    const { data: quota, error: quotaErr } = await supabase.rpc(
      'increment_message_counter',
      { p_user_id: site.user_id, p_limit: messageLimit }
    )
    if (quotaErr) {
      console.error('[chat-session] quota RPC failed:', quotaErr)
      return Response.json(
        { error: 'Quota check failed' },
        { status: 500, headers: corsHeaders }
      )
    }
    if (!quota?.ok) {
      return Response.json(
        {
          error: 'quota_exceeded',
          upgrade_url: '/dashboard/billing',
          used: quota?.used,
          limit: quota?.limit,
        },
        { status: 402, headers: corsHeaders }
      )
    }

    const typedHistory = (history || []).filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string'
    )

    // M6F2: custom-response short-circuit. Runs BEFORE any OpenAI call so
    // a keyword hit skips embedding + chat completion entirely. Rules are
    // pre-ordered by the DB (priority DESC, created_at ASC), which the
    // matcher honors as tiebreaker.
    const siteName = site.name || new URL(site.url).hostname
    const { data: rules } = await supabase
      .from('custom_responses')
      .select('id, trigger_type, triggers, response, priority, created_at')
      .eq('site_id', site.id)
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })

    const match = await matchResponse(
      message.trim(),
      ((rules ?? []) as ResponseRule[])
    )
    if (match) {
      const sessionId = crypto.randomUUID()
      await storeSession(sessionId, {
        siteId: site.id,
        siteName,
        siteUrl: site.url,
        calendlyUrl: site.calendly_url,
        googleMapsUrl: site.google_maps_url,
        systemPrompt: '',
        messages: [...typedHistory, { role: 'user', content: message.trim() }],
        visitorIp: ip,
        createdAt: Date.now(),
        cannedResponse: match.rule.response,
      })
      return Response.json({ sessionId }, { headers: corsHeaders })
    }

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

/**
 * Resolve the monthly message limit for the site owner.
 *
 * Lookup chain: profiles.plan_id -> plans.monthly_message_limit.
 * Fallback: Starter cap (2000) — used when a trialing account hasn't
 * picked a plan yet. We gate against a real cap rather than infinite, so
 * malicious trial signups can't mint unlimited LLM calls.
 */
const STARTER_MESSAGE_LIMIT_FALLBACK = 2000

async function resolveOwnerMessageLimit(
  supabase: SupabaseClient,
  ownerId: string
): Promise<number> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan_id')
    .eq('id', ownerId)
    .maybeSingle<{ plan_id: string | null }>()

  if (!profile?.plan_id) return STARTER_MESSAGE_LIMIT_FALLBACK

  const { data: plan } = await supabase
    .from('plans')
    .select('id, monthly_message_limit')
    .eq('id', profile.plan_id)
    .maybeSingle<{ id: string; monthly_message_limit: number }>()

  return plan?.monthly_message_limit ?? STARTER_MESSAGE_LIMIT_FALLBACK
}
