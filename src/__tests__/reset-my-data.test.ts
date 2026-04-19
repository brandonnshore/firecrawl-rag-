import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { Pool } from 'pg'
import {
  hasSupabaseTestEnv,
  serviceRoleClient,
  createTestUser,
  truncateUserData,
  type TestUser,
} from './helpers/supabase'

// M8F8 fresh-start-wipe-script — integration test against real local
// Supabase. Seeds two users with parallel data. Runs reset-my-data.sql
// against one. Asserts his site-scoped + user-scoped rows are 0, his
// profiles row still exists (preserved), and user B is completely
// untouched. VAL-CROSS-010.

const SCRIPT_PATH = resolve(process.cwd(), 'scripts', 'reset-my-data.sql')

const pool = new Pool({
  connectionString:
    process.env.SUPABASE_TEST_DB_URL ||
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  max: 2,
})

async function runReset(userId: string): Promise<void> {
  // pg's prepared-statement path can't run multi-statement scripts, so we
  // pre-substitute the :user_id placeholder here. UUIDs are parsed + cast
  // to ::uuid at use sites, which will reject anything that isn't a real
  // UUID before it reaches a DELETE — so this is not an injection vector.
  if (!/^[0-9a-f-]{32,36}$/i.test(userId)) {
    throw new Error('runReset: userId is not a UUID shape')
  }
  const sql = readFileSync(SCRIPT_PATH, 'utf8')
    .replace(/:'user_id'/g, `'${userId}'`)
    .replace(/:user_id/g, `'${userId}'::uuid`)
    // The \set ON_ERROR_STOP meta-command is psql-only — strip it.
    .replace(/^\\set.*$/gm, '')
  await pool.query(sql)
}

describe.skipIf(!hasSupabaseTestEnv())('reset-my-data.sql', () => {
  const admin = serviceRoleClient()
  let userA: TestUser
  let userB: TestUser
  let siteA: { id: string }
  let siteB: { id: string }

  afterAll(async () => {
    if (userA) await truncateUserData(userA.userId).catch(() => {})
    if (userB) await truncateUserData(userB.userId).catch(() => {})
    await pool.end().catch(() => {})
  })

  beforeEach(async () => {
    const ts = Date.now() + '_' + Math.random().toString(36).slice(2, 7)
    userA = await createTestUser(`reset_a_${ts}@rubycrawl.test`)
    userB = await createTestUser(`reset_b_${ts}@rubycrawl.test`)

    const { data: sA } = await admin
      .from('sites')
      .insert({
        user_id: userA.userId,
        url: 'https://a.example.com',
        site_key: 'sk_reset_a_' + ts,
      })
      .select('id')
      .single<{ id: string }>()
    const { data: sB } = await admin
      .from('sites')
      .insert({
        user_id: userB.userId,
        url: 'https://b.example.com',
        site_key: 'sk_reset_b_' + ts,
      })
      .select('id')
      .single<{ id: string }>()
    siteA = sA!
    siteB = sB!

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
    await admin
      .from('usage_counters')
      .upsert([
        {
          user_id: userA.userId,
          messages_used: 12,
          crawl_pages_used: 34,
          files_stored: 5,
          openai_tokens_used: 67890,
        },
        {
          user_id: userB.userId,
          messages_used: 99,
          crawl_pages_used: 77,
          files_stored: 8,
          openai_tokens_used: 12345,
        },
      ])
    await admin.from('sent_emails').insert([
      { user_id: userA.userId, template: 'welcome', period: 'initial' },
      { user_id: userB.userId, template: 'welcome', period: 'initial' },
    ])
    await admin
      .from('profiles')
      .update({ stripe_customer_id: 'cus_A_' + ts })
      .eq('id', userA.userId)
  })

  async function countAndSnapshot(
    userId: string,
    siteId: string
  ): Promise<{
    profile: { id: string; stripe_customer_id: string | null } | null
    sites: number
    leads: number
    conversations: number
    custom_responses: number
    escalation_rules: number
    sent_emails: number
    usage_counter: { messages_used: number } | null
  }> {
    const { data: profile } = await admin
      .from('profiles')
      .select('id, stripe_customer_id')
      .eq('id', userId)
      .maybeSingle<{ id: string; stripe_customer_id: string | null }>()
    const { count: sites } = await admin
      .from('sites')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    const { count: leads } = await admin
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', siteId)
    const { count: convos } = await admin
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', siteId)
    const { count: resp } = await admin
      .from('custom_responses')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', siteId)
    const { count: rules } = await admin
      .from('escalation_rules')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', siteId)
    const { count: sent } = await admin
      .from('sent_emails')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    const { data: counter } = await admin
      .from('usage_counters')
      .select('messages_used')
      .eq('user_id', userId)
      .maybeSingle<{ messages_used: number }>()
    return {
      profile,
      sites: sites ?? 0,
      leads: leads ?? 0,
      conversations: convos ?? 0,
      custom_responses: resp ?? 0,
      escalation_rules: rules ?? 0,
      sent_emails: sent ?? 0,
      usage_counter: counter,
    }
  }

  it('wipes user A’s site + cascades, zeroes counters, preserves profiles row', async () => {
    await runReset(userA.userId)

    const snapA = await countAndSnapshot(userA.userId, siteA.id)
    expect(snapA.profile?.id).toBe(userA.userId)
    expect(snapA.profile?.stripe_customer_id).toBeNull()
    expect(snapA.sites).toBe(0)
    expect(snapA.leads).toBe(0)
    expect(snapA.conversations).toBe(0)
    expect(snapA.custom_responses).toBe(0)
    expect(snapA.escalation_rules).toBe(0)
    expect(snapA.sent_emails).toBe(0)
    expect(snapA.usage_counter?.messages_used).toBe(0)
  })

  it('leaves user B’s data untouched', async () => {
    await runReset(userA.userId)

    const snapB = await countAndSnapshot(userB.userId, siteB.id)
    expect(snapB.profile?.id).toBe(userB.userId)
    expect(snapB.sites).toBe(1)
    expect(snapB.leads).toBe(1)
    expect(snapB.conversations).toBe(1)
    expect(snapB.custom_responses).toBe(1)
    expect(snapB.escalation_rules).toBe(1)
    expect(snapB.sent_emails).toBe(1)
    expect(snapB.usage_counter?.messages_used).toBe(99)
  })

  it('raises when user_id is not found (safety gate)', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    await expect(runReset(fakeId)).rejects.toThrow(
      /not found in profiles/
    )
  })
})
