import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

/**
 * Service-role seed helpers for Playwright specs. Mirror the shape used
 * by src/tests/helpers so fixture data across vitest + playwright looks
 * the same.
 */

function adminClient(): SupabaseClient {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_TEST_URL ||
    'http://127.0.0.1:54321'
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ||
    ''
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export interface SeedSiteInput {
  userId: string
  url?: string
  siteKey?: string
  crawlStatus?: 'ready' | 'crawling' | 'pending' | 'failed'
}

export interface SeededSite {
  id: string
  site_key: string
  user_id: string
}

export async function seedSite(input: SeedSiteInput): Promise<SeededSite> {
  const admin = adminClient()
  const siteKey = input.siteKey ?? `sk_e2e_${randomUUID().slice(0, 16)}`
  const { data, error } = await admin
    .from('sites')
    .insert({
      user_id: input.userId,
      url: input.url ?? 'https://example.com',
      site_key: siteKey,
      crawl_status: input.crawlStatus ?? 'ready',
    })
    .select('id, site_key, user_id')
    .single<SeededSite>()
  if (error || !data) {
    throw new Error(`seedSite failed: ${error?.message ?? 'no data'}`)
  }
  return data
}

export async function seedUsageCounter(
  userId: string,
  overrides: {
    messages_used?: number
    crawl_pages_used?: number
    files_stored?: number
  } = {}
): Promise<void> {
  const admin = adminClient()
  await admin.from('usage_counters').upsert({
    user_id: userId,
    messages_used: overrides.messages_used ?? 0,
    crawl_pages_used: overrides.crawl_pages_used ?? 0,
    files_stored: overrides.files_stored ?? 0,
  })
}

export async function setProfilePlan(
  userId: string,
  planId: string | null
): Promise<void> {
  const admin = adminClient()
  await admin.from('profiles').update({ plan_id: planId }).eq('id', userId)
}

export async function setSubscriptionStatus(
  userId: string,
  status: 'trialing' | 'active' | 'past_due' | 'cancelled',
  extras: {
    trial_ends_at?: string | null
    current_period_end?: string | null
    stripe_customer_id?: string | null
    stripe_subscription_id?: string | null
  } = {}
): Promise<void> {
  const admin = adminClient()
  const update: Record<string, unknown> = { subscription_status: status }
  if (extras.trial_ends_at !== undefined)
    update.trial_ends_at = extras.trial_ends_at
  if (extras.current_period_end !== undefined)
    update.current_period_end = extras.current_period_end
  if (extras.stripe_customer_id !== undefined)
    update.stripe_customer_id = extras.stripe_customer_id
  if (extras.stripe_subscription_id !== undefined)
    update.stripe_subscription_id = extras.stripe_subscription_id
  await admin.from('profiles').update(update).eq('id', userId)
}

export async function cleanupUserData(userId: string): Promise<void> {
  const admin = adminClient()
  await admin.from('sites').delete().eq('user_id', userId)
  await admin.from('usage_counters').delete().eq('user_id', userId)
  await admin.from('sent_emails').delete().eq('user_id', userId)
}
