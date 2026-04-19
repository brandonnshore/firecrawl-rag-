import { test, expect } from './fixtures/auth'
import { seedSite, cleanupUserData } from './fixtures/seed'
import { createClient } from '@supabase/supabase-js'

// M9F12 e2e-responses-plus-escalation
// Fulfills: VAL-CROSS-006
//
// Proves the combined matcher + escalation runtime:
//   - a keyword custom-response short-circuits the RAG path (no embed,
//     no chat completion — the server never reaches an OpenAI client)
//   - turn_count=3 escalation still evaluates on the canned path and
//     emits the PENDING_ACTION_SENTINEL trailer with an ask_email payload
//   - a follow-up POST /api/leads with source=escalation persists the
//     lead with source=escalation in the DB

const PENDING_ACTION_SENTINEL = '\x1E'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function ipHeader(lane: number) {
  return {
    'x-forwarded-for': `10.9.${lane}.${Math.floor(Math.random() * 255)}`,
  }
}

async function seedKeywordResponse(
  siteId: string,
  overrides: {
    triggers?: string[]
    response?: string
    priority?: number
  } = {}
): Promise<string> {
  const { data, error } = await admin()
    .from('custom_responses')
    .insert({
      site_id: siteId,
      trigger_type: 'keyword',
      triggers: overrides.triggers ?? ['price'],
      response: overrides.response ?? 'Our pricing is $49/mo.',
      priority: overrides.priority ?? 10,
      is_active: true,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data)
    throw new Error(`seedKeywordResponse failed: ${error?.message}`)
  return data.id
}

async function seedTurnCountEscalation(
  siteId: string,
  opts: {
    turns?: number
    action?: 'ask_email' | 'ask_phone'
    priority?: number
  } = {}
): Promise<string> {
  const { data, error } = await admin()
    .from('escalation_rules')
    .insert({
      site_id: siteId,
      rule_type: 'turn_count',
      config: { turns: opts.turns ?? 3 },
      action: opts.action ?? 'ask_email',
      action_config: {},
      priority: opts.priority ?? 5,
      is_active: true,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data)
    throw new Error(`seedTurnCountEscalation failed: ${error?.message}`)
  return data.id
}

async function seedKeywordEscalation(
  siteId: string,
  opts: {
    keywords?: string[]
    action?: 'ask_email' | 'show_form'
  } = {}
): Promise<string> {
  const { data, error } = await admin()
    .from('escalation_rules')
    .insert({
      site_id: siteId,
      rule_type: 'keyword',
      config: { keywords: opts.keywords ?? ['help'] },
      action: opts.action ?? 'ask_email',
      action_config: {},
      priority: 5,
      is_active: true,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data)
    throw new Error(`seedKeywordEscalation failed: ${error?.message}`)
  return data.id
}

async function openSession(
  request: import('@playwright/test').APIRequestContext,
  opts: { siteKey: string; message: string; history?: unknown[]; ip: string }
): Promise<string> {
  const res = await request.post('/api/chat/session', {
    headers: { 'x-forwarded-for': opts.ip },
    data: {
      message: opts.message,
      site_key: opts.siteKey,
      history: opts.history ?? [],
    },
  })
  if (!res.ok()) {
    throw new Error(
      `POST /api/chat/session ${res.status()}: ${await res.text()}`
    )
  }
  const { sessionId } = (await res.json()) as { sessionId: string }
  return sessionId
}

test.describe('widget custom-response × escalation interplay', () => {
  let siteId: string
  let siteKey: string

  test.beforeEach(async ({ seededUser }) => {
    const site = await seedSite({
      userId: seededUser.userId,
      crawlStatus: 'ready',
    })
    siteId = site.id
    siteKey = site.site_key
  })

  test.afterEach(async ({ seededUser }) => {
    await admin().from('custom_responses').delete().eq('site_id', siteId)
    await admin().from('escalation_rules').delete().eq('site_id', siteId)
    await admin().from('leads').delete().eq('site_id', siteId)
    await cleanupUserData(seededUser.userId)
  })

  test('keyword response short-circuits RAG on turn 1 — stream body = canned text, no escalation', async ({
    request,
  }) => {
    await seedKeywordResponse(siteId, {
      triggers: ['price'],
      response: 'Our pricing is $49/mo.',
    })
    await seedTurnCountEscalation(siteId, { turns: 3 })

    const sid = await openSession(request, {
      siteKey,
      message: "what's the price?",
      history: [],
      ip: (await ipHeader(0))['x-forwarded-for'],
    })

    const stream = await request.get(`/api/chat/stream?sid=${sid}`)
    expect(stream.status()).toBe(200)
    const body = await stream.text()
    // Canned text was emitted verbatim.
    expect(body).toContain('Our pricing is $49/mo.')
    // Turn 1: escalation (turns=3) must NOT fire — no sentinel at all.
    expect(body.includes(PENDING_ACTION_SENTINEL)).toBe(false)
  })

  test('turn_count=3 escalation fires on the canned path — sentinel + ask_email pending_action', async ({
    request,
  }) => {
    await seedKeywordResponse(siteId)
    await seedTurnCountEscalation(siteId, { turns: 3, action: 'ask_email' })

    const history = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'tell me more' },
      { role: 'assistant', content: 'sure' },
    ]
    const sid = await openSession(request, {
      siteKey,
      message: 'and the price?',
      history,
      ip: (await ipHeader(1))['x-forwarded-for'],
    })

    const stream = await request.get(`/api/chat/stream?sid=${sid}`)
    expect(stream.status()).toBe(200)
    const body = await stream.text()

    const idx = body.lastIndexOf(PENDING_ACTION_SENTINEL)
    expect(idx).toBeGreaterThan(-1)

    const canned = body.slice(0, idx)
    expect(canned).toContain('Our pricing is $49/mo.')

    const trailer = JSON.parse(body.slice(idx + 1)) as {
      pending_action: {
        rule_id: string
        action: string
        via: string
        action_config: Record<string, unknown>
      }
    }
    expect(trailer.pending_action.action).toBe('ask_email')
    expect(trailer.pending_action.via).toBe('turn_count')
  })

  test('post-escalation lead submission persists with source=escalation', async ({
    request,
  }) => {
    await seedKeywordResponse(siteId)
    await seedTurnCountEscalation(siteId, { turns: 3 })

    // Surface an escalation (turn 3 trailer) — then submit the lead the
    // widget's ask_email form would POST.
    const history = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'more info' },
      { role: 'assistant', content: 'sure' },
    ]
    const sid = await openSession(request, {
      siteKey,
      message: 'price please',
      history,
      ip: (await ipHeader(2))['x-forwarded-for'],
    })
    const stream = await request.get(`/api/chat/stream?sid=${sid}`)
    const body = await stream.text()
    expect(body).toContain(PENDING_ACTION_SENTINEL)

    const leadEmail = `cross006_${Date.now()}@example.com`
    const lead = await request.post('/api/leads', {
      headers: await ipHeader(3),
      data: {
        site_key: siteKey,
        email: leadEmail,
        source: 'escalation',
      },
    })
    expect(lead.ok()).toBeTruthy()

    const { data } = await admin()
      .from('leads')
      .select('email, source, site_id')
      .eq('email', leadEmail)
      .maybeSingle<{ email: string; source: string; site_id: string }>()
    expect(data?.source).toBe('escalation')
    expect(data?.site_id).toBe(siteId)
  })

  test('keyword escalation rule fires on the canned path — sentinel via keyword, not turn_count', async ({
    request,
  }) => {
    // Canned response triggered by "price"; escalation triggered by
    // "help" appearing in the SAME user message. turn_count is 99 so
    // only the keyword escalation can match.
    await seedKeywordResponse(siteId, {
      triggers: ['price'],
      response: 'Pricing starts at $49/mo.',
    })
    await seedTurnCountEscalation(siteId, { turns: 99 })
    await seedKeywordEscalation(siteId, { keywords: ['help'] })

    const sid = await openSession(request, {
      siteKey,
      message: 'help me with price',
      history: [],
      ip: (await ipHeader(4))['x-forwarded-for'],
    })
    const stream = await request.get(`/api/chat/stream?sid=${sid}`)
    const body = await stream.text()
    const idx = body.lastIndexOf(PENDING_ACTION_SENTINEL)
    expect(idx).toBeGreaterThan(-1)
    const trailer = JSON.parse(body.slice(idx + 1)) as {
      pending_action: { via: string; action: string }
    }
    expect(trailer.pending_action.via).toBe('keyword')
    expect(trailer.pending_action.action).toBe('ask_email')
  })

  test('higher-priority response rule wins when two keyword rules overlap', async ({
    request,
  }) => {
    await seedKeywordResponse(siteId, {
      triggers: ['price'],
      response: 'Low-priority answer',
      priority: 1,
    })
    await seedKeywordResponse(siteId, {
      triggers: ['price'],
      response: 'Winning answer',
      priority: 99,
    })

    const sid = await openSession(request, {
      siteKey,
      message: 'what is the price',
      history: [],
      ip: (await ipHeader(5))['x-forwarded-for'],
    })
    const stream = await request.get(`/api/chat/stream?sid=${sid}`)
    const body = await stream.text()
    expect(body).toContain('Winning answer')
    expect(body).not.toContain('Low-priority answer')
  })
})
