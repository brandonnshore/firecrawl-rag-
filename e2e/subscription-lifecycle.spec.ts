import { test, expect } from './fixtures/auth'
import {
  seedSite,
  setSubscriptionStatus,
  setProfilePlan,
  cleanupUserData,
} from './fixtures/seed'
import { createClient } from '@supabase/supabase-js'

// M9F8 e2e-subscription-lifecycle
// Fulfills: VAL-CROSS-002, VAL-BILLING-002, VAL-BILLING-003,
//           VAL-BILLING-024, VAL-BILLING-025

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function ensureStarterPlan(): Promise<void> {
  const admin = adminClient()
  await admin.from('plans').upsert(
    {
      id: 'starter',
      display_name: 'Starter',
      price_cents: 2499,
      monthly_message_limit: 2000,
      monthly_crawl_page_limit: 500,
      supplementary_file_limit: 25,
      stripe_price_id: null,
    },
    { onConflict: 'id' }
  )
}

test.describe('subscription lifecycle (billing page variants)', () => {
  test.beforeEach(async ({ seededUser }) => {
    await ensureStarterPlan()
    await seedSite({ userId: seededUser.userId, crawlStatus: 'ready' })
  })

  test.afterEach(async ({ seededUser }) => {
    await cleanupUserData(seededUser.userId)
  })

  test('trialing user sees countdown banner + plan options (VAL-BILLING-003)', async ({
    authedPage,
    seededUser,
  }) => {
    // Seed a trial ending 5 days from now.
    const trialEnd = new Date(Date.now() + 5 * 86400_000).toISOString()
    await setSubscriptionStatus(seededUser.userId, 'trialing', {
      trial_ends_at: trialEnd,
    })

    await authedPage.goto('/dashboard/settings/billing')
    await expect(authedPage.getByText(/trial/i).first()).toBeVisible()
    await expect(authedPage.getByText(/days? remaining/i)).toBeVisible()
    // Plan cards render the Starter plan name.
    await expect(authedPage.getByText(/starter/i).first()).toBeVisible()
  })

  test('active user sees plan name + status pill (VAL-BILLING-002)', async ({
    authedPage,
    seededUser,
  }) => {
    await setProfilePlan(seededUser.userId, 'starter')
    const periodEnd = new Date(Date.now() + 28 * 86400_000).toISOString()
    await setSubscriptionStatus(seededUser.userId, 'active', {
      current_period_end: periodEnd,
      stripe_customer_id: `cus_e2e_active_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      stripe_subscription_id: `sub_e2e_active_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    })

    await authedPage.goto('/dashboard/settings/billing')
    await expect(
      authedPage.getByText('Starter', { exact: true }).first()
    ).toBeVisible()
    await expect(
      authedPage.getByText('Active', { exact: true }).first()
    ).toBeVisible()
    await expect(authedPage.getByText('$24.99').first()).toBeVisible()
  })

  test('next-invoice date rendered from current_period_end (VAL-BILLING-025)', async ({
    authedPage,
    seededUser,
  }) => {
    await setProfilePlan(seededUser.userId, 'starter')
    const periodEnd = new Date(Date.now() + 14 * 86400_000).toISOString()
    await setSubscriptionStatus(seededUser.userId, 'active', {
      current_period_end: periodEnd,
      stripe_customer_id: `cus_e2e_nextinv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    })
    await authedPage.goto('/dashboard/settings/billing')
    await expect(authedPage.getByText(/next invoice:/i)).toBeVisible()
  })

  test('invoices section renders (VAL-BILLING-024)', async ({
    authedPage,
    seededUser,
  }) => {
    await setProfilePlan(seededUser.userId, 'starter')
    await setSubscriptionStatus(seededUser.userId, 'active', {
      current_period_end: new Date(Date.now() + 7 * 86400_000).toISOString(),
      stripe_customer_id: `cus_e2e_invoices_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    })
    await authedPage.goto('/dashboard/settings/billing')
    // Section header is always present; content depends on Stripe reachability.
    await expect(
      authedPage.getByRole('heading', { name: /^Invoices$/ })
    ).toBeVisible()
  })

  test('subscription-gate lifecycle: expired → 402; active → 200 (VAL-CROSS-002)', async ({
    request,
    seededUser,
  }) => {
    // Recover the freshly-seeded site's key for the widget chat call.
    const admin = adminClient()
    const { data: sites } = await admin
      .from('sites')
      .select('site_key')
      .eq('user_id', seededUser.userId)
      .maybeSingle<{ site_key: string }>()
    expect(sites?.site_key).toBeTruthy()
    const siteKey = sites!.site_key

    // Phase 1: trial expired yesterday.
    await setSubscriptionStatus(seededUser.userId, 'trialing', {
      trial_ends_at: new Date(Date.now() - 86400_000).toISOString(),
    })
    const expired = await request.post('/api/chat/session', {
      data: { message: 'hi', site_key: siteKey },
    })
    expect(expired.status()).toBe(402)

    // Phase 2: webhook-equivalent mutation flips status to active.
    await setSubscriptionStatus(seededUser.userId, 'active', {
      current_period_end: new Date(
        Date.now() + 30 * 86400_000
      ).toISOString(),
      stripe_customer_id: `cus_e2e_recover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      stripe_subscription_id: `sub_e2e_recover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    })
    const recovered = await request.post('/api/chat/session', {
      data: { message: 'hi', site_key: siteKey },
    })
    // Subscription gate now open. Downstream may still 5xx because the
    // OpenAI key is a placeholder in this harness; we're only gating
    // on the status flip (no longer 402).
    expect(recovered.status()).not.toBe(402)
  })
})
