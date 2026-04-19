import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Pool } from 'pg'
import {
  hasSupabaseTestEnv,
  serviceRoleClient,
  createTestUser,
  truncateUserData,
  type TestUser,
} from './helpers/supabase'
import { deleteUserAccount } from '@/lib/account/delete'

// Local Supabase rejects the admin API with HS256/secret-key; delete
// auth.users via pg so the cascade fires as it does in production.
const pgPool = new Pool({
  connectionString:
    process.env.SUPABASE_TEST_DB_URL ||
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 2,
})
async function pgDeleteAuthUser(
  userId: string
): Promise<{ error?: string }> {
  try {
    await pgPool.query('delete from auth.users where id = $1', [userId])
    return {}
  } catch (err) {
    return { error: (err as Error).message }
  }
}

// M8F5 account-deletion-gdpr — integration test proving that deleting
// one user wipes every user-scoped row while leaving a second user's
// data untouched. Covers VAL-GDPR-003 cascade and VAL-CROSS-010-adjacent
// scope isolation.

describe.skipIf(!hasSupabaseTestEnv())('deleteUserAccount (GDPR cascade)', () => {
  const admin = serviceRoleClient()
  let userA: TestUser
  let userB: TestUser
  let siteA: { id: string }
  let siteB: { id: string }

  afterAll(async () => {
    // Best-effort sweep of anything left if a test bailed mid-run.
    if (userA) await truncateUserData(userA.userId).catch(() => {})
    if (userB) await truncateUserData(userB.userId).catch(() => {})
  })

  beforeEach(async () => {
    // Each test creates its own pair so deletes in one test don't starve
    // later tests of a valid FK target. Unique-on-email forces a new JWT.
    const ts = Date.now() + '_' + Math.random().toString(36).slice(2, 7)
    userA = await createTestUser(`gdpr_a_${ts}@rubycrawl.test`)
    userB = await createTestUser(`gdpr_b_${ts}@rubycrawl.test`)

    const { data: sA } = await admin
      .from('sites')
      .insert({
        user_id: userA.userId,
        url: 'https://a.example.com',
        site_key: 'sk_gdpr_a_' + Date.now(),
      })
      .select('id')
      .single<{ id: string }>()
    const { data: sB } = await admin
      .from('sites')
      .insert({
        user_id: userB.userId,
        url: 'https://b.example.com',
        site_key: 'sk_gdpr_b_' + Date.now(),
      })
      .select('id')
      .single<{ id: string }>()
    siteA = sA!
    siteB = sB!

    // Seed rows across every user-scoped surface for BOTH users so the
    // cross-user untouched-assertion is non-trivial.
    await admin.from('usage_counters').upsert([
      { user_id: userA.userId, messages_used: 5 },
      { user_id: userB.userId, messages_used: 7 },
    ])
    await admin.from('leads').insert([
      { site_id: siteA.id, email: 'leadA@x.com', source: 'widget' },
      { site_id: siteB.id, email: 'leadB@x.com', source: 'widget' },
    ])
    await admin.from('conversations').insert([
      { site_id: siteA.id, visitor_id: 'v_a_' + ts },
      { site_id: siteB.id, visitor_id: 'v_b_' + ts },
    ])
    await admin.from('custom_responses').insert([
      {
        site_id: siteA.id,
        trigger_type: 'keyword',
        triggers: ['hello'],
        response: 'hi',
      },
      {
        site_id: siteB.id,
        trigger_type: 'keyword',
        triggers: ['hello'],
        response: 'hi',
      },
    ])
    await admin.from('escalation_rules').insert([
      {
        site_id: siteA.id,
        rule_type: 'turn_count',
        config: { turns: 3 },
        action: 'ask_email',
      },
      {
        site_id: siteB.id,
        rule_type: 'turn_count',
        config: { turns: 3 },
        action: 'ask_email',
      },
    ])
    await admin.from('sent_emails').insert([
      { user_id: userA.userId, template: 'welcome', period: 'initial' },
      { user_id: userB.userId, template: 'welcome', period: 'initial' },
    ])
  })

  async function countOwned(userId: string): Promise<Record<string, number>> {
    const { count: sitesCount } = await admin
      .from('sites')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    const { count: usageCount } = await admin
      .from('usage_counters')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    const { count: sentCount } = await admin
      .from('sent_emails')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    const { count: profileCount } = await admin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('id', userId)
    // Site-scoped tables (leads / responses / escalation_rules) via userId
    // require a join; use a sub-select.
    const { data: ownedSiteIds } = await admin
      .from('sites')
      .select('id')
      .eq('user_id', userId)
    const ids = (ownedSiteIds ?? []).map((r) => (r as { id: string }).id)
    let leads = 0
    let convos = 0
    let responses = 0
    let rules = 0
    if (ids.length > 0) {
      const { count: l } = await admin
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .in('site_id', ids)
      const { count: c } = await admin
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .in('site_id', ids)
      const { count: r } = await admin
        .from('custom_responses')
        .select('*', { count: 'exact', head: true })
        .in('site_id', ids)
      const { count: e } = await admin
        .from('escalation_rules')
        .select('*', { count: 'exact', head: true })
        .in('site_id', ids)
      leads = l ?? 0
      convos = c ?? 0
      responses = r ?? 0
      rules = e ?? 0
    }
    return {
      profiles: profileCount ?? 0,
      sites: sitesCount ?? 0,
      usage_counters: usageCount ?? 0,
      sent_emails: sentCount ?? 0,
      leads,
      conversations: convos,
      custom_responses: responses,
      escalation_rules: rules,
    }
  }

  it('wipes every user-scoped row for the deleted user', async () => {
    const beforeA = await countOwned(userA.userId)
    expect(beforeA.profiles).toBe(1)
    expect(beforeA.sites).toBe(1)
    expect(beforeA.usage_counters).toBe(1)
    expect(beforeA.sent_emails).toBe(1)
    expect(beforeA.leads).toBe(1)
    expect(beforeA.conversations).toBe(1)
    expect(beforeA.custom_responses).toBe(1)
    expect(beforeA.escalation_rules).toBe(1)

    const log = await deleteUserAccount({
      admin,
      userId: userA.userId,
      deleteAuthUser: pgDeleteAuthUser,
    })
    expect(log.authUser).toBe('deleted')

    const afterA = await countOwned(userA.userId)
    expect(afterA).toEqual({
      profiles: 0,
      sites: 0,
      usage_counters: 0,
      sent_emails: 0,
      leads: 0,
      conversations: 0,
      custom_responses: 0,
      escalation_rules: 0,
    })
  })

  it("leaves the other user's data untouched", async () => {
    const beforeB = await countOwned(userB.userId)
    expect(beforeB).toEqual({
      profiles: 1,
      sites: 1,
      usage_counters: 1,
      sent_emails: 1,
      leads: 1,
      conversations: 1,
      custom_responses: 1,
      escalation_rules: 1,
    })

    await deleteUserAccount({
      admin,
      userId: userA.userId,
      deleteAuthUser: pgDeleteAuthUser,
    })

    const afterB = await countOwned(userB.userId)
    expect(afterB).toEqual(beforeB)
  })

  it('invokes cancelStripeSubscription when the user has a subscription id', async () => {
    const subId = 'sub_test_' + Date.now()
    await admin
      .from('profiles')
      .update({ stripe_subscription_id: subId })
      .eq('id', userA.userId)

    const canceled: string[] = []
    const log = await deleteUserAccount({
      admin,
      userId: userA.userId,
      deleteAuthUser: pgDeleteAuthUser,
      cancelStripeSubscription: async (id) => {
        canceled.push(id)
      },
    })
    expect(canceled).toEqual([subId])
    expect(log.stripe).toBe('canceled')
    expect(log.authUser).toBe('deleted')
  })

  it('does not invoke cancelStripeSubscription when no subscription id is set', async () => {
    const canceled: string[] = []
    const log = await deleteUserAccount({
      admin,
      userId: userA.userId,
      deleteAuthUser: pgDeleteAuthUser,
      cancelStripeSubscription: async (id) => {
        canceled.push(id)
      },
    })
    expect(canceled).toEqual([])
    expect(log.stripe).toBe('none')
    expect(log.authUser).toBe('deleted')
  })
})
