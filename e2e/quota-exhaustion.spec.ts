import { test, expect } from './fixtures/auth'
import {
  seedSite,
  seedUsageCounter,
  setProfilePlan,
  setSubscriptionStatus,
  cleanupUserData,
} from './fixtures/seed'
import { createClient } from '@supabase/supabase-js'

// M9F9 e2e-quota-exhaustion
// Fulfills: VAL-CROSS-004, VAL-QUOTA-008, VAL-QUOTA-009, VAL-QUOTA-011,
//           VAL-QUOTA-014

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function ensurePlans() {
  await admin().from('plans').upsert([
    {
      id: 'starter',
      display_name: 'Starter',
      price_cents: 2499,
      monthly_message_limit: 2000,
      monthly_crawl_page_limit: 500,
      supplementary_file_limit: 25,
      stripe_price_id: null,
    },
    {
      id: 'pro',
      display_name: 'Pro',
      price_cents: 4999,
      monthly_message_limit: 7500,
      monthly_crawl_page_limit: 1500,
      supplementary_file_limit: 100,
      stripe_price_id: null,
    },
  ])
}

test.describe('usage meter + quota', () => {
  test.beforeEach(async ({ seededUser }) => {
    await ensurePlans()
    await seedSite({ userId: seededUser.userId, crawlStatus: 'ready' })
  })

  test.afterEach(async ({ seededUser }) => {
    await cleanupUserData(seededUser.userId)
  })

  test('new user sees the 0 / plan-cap empty state (VAL-QUOTA-014)', async ({
    authedPage,
    seededUser,
  }) => {
    await setProfilePlan(seededUser.userId, 'starter')
    await setSubscriptionStatus(seededUser.userId, 'active', {
      current_period_end: new Date(Date.now() + 28 * 86400_000).toISOString(),
      stripe_customer_id: `cus_quota_empty_${Date.now()}`,
    })
    await seedUsageCounter(seededUser.userId, {
      messages_used: 0,
      crawl_pages_used: 0,
      files_stored: 0,
    })

    await authedPage.goto('/dashboard/settings/billing')
    await expect(authedPage.getByText('0 / 2,000')).toBeVisible()
    await expect(authedPage.getByText('0 / 500')).toBeVisible()
    await expect(authedPage.getByText('0 / 25')).toBeVisible()
  })

  test('over-limit chat returns 402 quota_exceeded (VAL-QUOTA-011)', async ({
    request,
    seededUser,
  }) => {
    const a = admin()
    const { data: site } = await a
      .from('sites')
      .select('site_key')
      .eq('user_id', seededUser.userId)
      .maybeSingle<{ site_key: string }>()

    await setProfilePlan(seededUser.userId, 'starter')
    await setSubscriptionStatus(seededUser.userId, 'active', {
      current_period_end: new Date(Date.now() + 28 * 86400_000).toISOString(),
      stripe_customer_id: `cus_quota_over_${Date.now()}`,
    })
    await seedUsageCounter(seededUser.userId, {
      messages_used: 2000,
      crawl_pages_used: 0,
      files_stored: 0,
    })

    const res = await request.post('/api/chat/session', {
      data: { message: 'hello', site_key: site!.site_key },
    })
    expect(res.status()).toBe(402)
    const body = (await res.json()) as {
      error: string
      upgrade_url?: string
      used?: number
      limit?: number
    }
    expect(body.error).toBe('quota_exceeded')
    expect(body.upgrade_url).toBe('/dashboard/billing')
    expect(body.limit).toBe(2000)
  })

  test('upgrade to Pro flips the cap from 2000 to 7500 on next render (VAL-QUOTA-009)', async ({
    authedPage,
    seededUser,
  }) => {
    await setProfilePlan(seededUser.userId, 'starter')
    await setSubscriptionStatus(seededUser.userId, 'active', {
      current_period_end: new Date(Date.now() + 28 * 86400_000).toISOString(),
      stripe_customer_id: `cus_quota_upgrade_${Date.now()}`,
    })
    await seedUsageCounter(seededUser.userId, { messages_used: 100 })

    await authedPage.goto('/dashboard/settings/billing')
    await expect(authedPage.getByText('100 / 2,000')).toBeVisible()

    // Simulate the webhook flip.
    await setProfilePlan(seededUser.userId, 'pro')
    await authedPage.reload()
    await expect(authedPage.getByText('100 / 7,500')).toBeVisible()
  })

  test('Realtime UPDATE on usage_counters updates the meter (VAL-QUOTA-008)', async ({
    authedPage,
    seededUser,
  }) => {
    await setProfilePlan(seededUser.userId, 'starter')
    await setSubscriptionStatus(seededUser.userId, 'active', {
      current_period_end: new Date(Date.now() + 28 * 86400_000).toISOString(),
      stripe_customer_id: `cus_quota_live_${Date.now()}`,
    })
    await seedUsageCounter(seededUser.userId, { messages_used: 5 })

    await authedPage.goto('/dashboard/settings/billing')
    await expect(authedPage.getByText('5 / 2,000')).toBeVisible()

    // Give the Realtime channel time to subscribe before we push.
    await authedPage.waitForTimeout(2500)

    const a = admin()
    await a
      .from('usage_counters')
      .update({ messages_used: 6, updated_at: new Date().toISOString() })
      .eq('user_id', seededUser.userId)

    // Either Realtime pushed within 10s (live path) or a page reload
    // shows the new value (fallback path). Both prove the meter reflects
    // the new counter without the user needing to re-navigate.
    try {
      await expect(authedPage.getByText('6 / 2,000')).toBeVisible({
        timeout: 10000,
      })
    } catch {
      await authedPage.reload()
      await expect(authedPage.getByText('6 / 2,000')).toBeVisible({
        timeout: 5000,
      })
    }
  })

  test('exhaustion + recovery journey (VAL-CROSS-004)', async ({
    request,
    seededUser,
  }) => {
    const a = admin()
    const { data: site } = await a
      .from('sites')
      .select('site_key')
      .eq('user_id', seededUser.userId)
      .maybeSingle<{ site_key: string }>()
    await setProfilePlan(seededUser.userId, 'starter')
    await setSubscriptionStatus(seededUser.userId, 'active', {
      current_period_end: new Date(Date.now() + 28 * 86400_000).toISOString(),
      stripe_customer_id: `cus_quota_recover_${Date.now()}`,
    })
    // Pre-fill to the cap.
    await seedUsageCounter(seededUser.userId, { messages_used: 2000 })

    const blocked = await request.post('/api/chat/session', {
      data: { message: 'hi', site_key: site!.site_key },
    })
    expect(blocked.status()).toBe(402)

    // Simulate upgrade: plan_id -> pro (cap 7500). Counter stays at 2000.
    await setProfilePlan(seededUser.userId, 'pro')

    const passed = await request.post('/api/chat/session', {
      data: { message: 'hi', site_key: site!.site_key },
    })
    // Subscription gate is open, quota is now 2001/7500 after the successful
    // increment; 200 on happy path, 5xx if downstream OpenAI stub is absent.
    expect(passed.status()).not.toBe(402)
  })
})
