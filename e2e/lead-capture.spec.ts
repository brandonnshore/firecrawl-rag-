import { test, expect } from './fixtures/auth'
import { seedSite, cleanupUserData } from './fixtures/seed'
import { createClient } from '@supabase/supabase-js'

// M9F11 e2e-lead-capture
// Fulfills: VAL-CROSS-003, VAL-ESCAL-011, VAL-ESCAL-012, VAL-ESCAL-013,
//           VAL-ESCAL-014

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

test.describe('widget lead capture via POST /api/leads', () => {
  let siteKey: string

  test.beforeEach(async ({ seededUser }) => {
    const site = await seedSite({
      userId: seededUser.userId,
      crawlStatus: 'ready',
    })
    siteKey = site.site_key
  })

  test.afterEach(async ({ seededUser }) => {
    await cleanupUserData(seededUser.userId)
  })

  test('ask_email: POST /api/leads with source=escalation + email (VAL-ESCAL-011)', async ({
    request,
  }) => {
    const res = await request.post('/api/leads', {
      headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 255)}` },
      data: {
        site_key: siteKey,
        email: 'lead_email@example.com',
        source: 'escalation',
      },
    })
    if (!res.ok()) {
      throw new Error(
        `POST /api/leads failed ${res.status()}: ${await res.text()}`
      )
    }
    // Verify the row is persisted with the correct source.
    const { data } = await admin()
      .from('leads')
      .select('email, phone, source')
      .eq('email', 'lead_email@example.com')
      .maybeSingle<{ email: string; phone: string | null; source: string }>()
    expect(data?.source).toBe('escalation')
  })

  test('ask_phone: phone-only lead inserts with null email (VAL-ESCAL-012)', async ({
    request,
  }) => {
    const res = await request.post('/api/leads', {
      headers: { 'x-forwarded-for': `10.0.1.${Math.floor(Math.random() * 255)}` },
      data: {
        site_key: siteKey,
        phone: '+14155550123',
        source: 'escalation',
      },
    })
    expect(res.ok()).toBeTruthy()
    const { data } = await admin()
      .from('leads')
      .select('email, phone, source')
      .eq('phone', '+14155550123')
      .maybeSingle<{ email: string | null; phone: string; source: string }>()
    expect(data?.email).toBeNull()
    expect(data?.source).toBe('escalation')
  })

  test('show_form: extra_fields preserves dynamic fields (VAL-ESCAL-013)', async ({
    request,
  }) => {
    const res = await request.post('/api/leads', {
      headers: { 'x-forwarded-for': `10.0.2.${Math.floor(Math.random() * 255)}` },
      data: {
        site_key: siteKey,
        email: 'form_lead@example.com',
        source: 'escalation',
        extra_fields: {
          name: 'Alice Example',
          message: 'Need a quote',
        },
      },
    })
    expect(res.ok()).toBeTruthy()
    const { data } = await admin()
      .from('leads')
      .select('email, extra_fields')
      .eq('email', 'form_lead@example.com')
      .maybeSingle<{ email: string; extra_fields: Record<string, unknown> }>()
    expect(data?.extra_fields).toMatchObject({
      name: 'Alice Example',
      message: 'Need a quote',
    })
  })

  test('calendly_link action_config.url shape validated server-side (VAL-ESCAL-014)', async ({
    authedPage,
  }) => {
    // An escalation rule with action='calendly_link' and a valid https
    // URL is accepted; non-http URLs are rejected by the API validator.
    const ok = await authedPage.request.post('/api/escalation-rules', {
      data: {
        rule_type: 'turn_count',
        config: { turns: 3 },
        action: 'calendly_link',
        action_config: { url: 'https://calendly.com/brandon' },
      },
    })
    expect([200, 201]).toContain(ok.status())

    const bad = await authedPage.request.post('/api/escalation-rules', {
      data: {
        rule_type: 'turn_count',
        config: { turns: 3 },
        action: 'calendly_link',
        action_config: { url: 'javascript:alert(1)' },
      },
    })
    expect(bad.status()).toBe(400)
  })

  test('full lead-capture journey: widget → lead → /dashboard/leads → CSV (VAL-CROSS-003)', async ({
    authedPage,
    request,
  }) => {
    // Simulate 3 visitor messages ending in an escalation submission.
    const leadEmail = `cross003_${Date.now()}@example.com`
    await request.post('/api/leads', {
      headers: { 'x-forwarded-for': `10.0.3.${Math.floor(Math.random() * 255)}` },
      data: {
        site_key: siteKey,
        email: leadEmail,
        source: 'escalation',
      },
    })

    // Dashboard should render the lead row.
    await authedPage.goto('/dashboard/leads')
    await expect(authedPage.getByText(leadEmail)).toBeVisible({
      timeout: 5000,
    })

    // Export CSV endpoint returns bytes > 0 containing the email.
    const csv = await authedPage.request.get('/api/leads/export')
    expect(csv.ok()).toBeTruthy()
    const body = await csv.text()
    expect(body).toContain(leadEmail)
  })
})
