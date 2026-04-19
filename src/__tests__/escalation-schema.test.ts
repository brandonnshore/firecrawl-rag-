/**
 * M7F1 escalation-rules-schema — table + RLS + conversations.needs_human.
 *
 * Asserts:
 *   - Table exists with required columns + CHECK constraints
 *   - RLS owner-scoped for SELECT/INSERT/UPDATE/DELETE
 *   - ON DELETE CASCADE from sites
 *   - conversations.needs_human boolean default false
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  hasSupabaseTestEnv,
  serviceRoleClient,
  createTestUser,
  clientAs,
  truncateUserData,
  type TestUser,
} from './helpers/supabase'

async function insertSite(user: TestUser): Promise<string> {
  const admin = serviceRoleClient()
  const { data, error } = await admin
    .from('sites')
    .insert({
      user_id: user.userId,
      url: 'https://example.test',
      crawl_status: 'ready',
    })
    .select('id')
    .single<{ id: string }>()
  if (error) throw error
  return data!.id
}

async function insertRule(
  siteId: string,
  overrides: Record<string, unknown> = {}
) {
  const admin = serviceRoleClient()
  return admin
    .from('escalation_rules')
    .insert({
      site_id: siteId,
      rule_type: 'turn_count',
      config: { turns: 3 },
      action: 'ask_email',
      action_config: {},
      priority: 0,
      is_active: true,
      ...overrides,
    })
    .select('id, rule_type, action, priority, is_active')
    .single<{
      id: string
      rule_type: string
      action: string
      priority: number
      is_active: boolean
    }>()
}

describe.skipIf(!hasSupabaseTestEnv())('M7F1 escalation_rules schema', () => {
  let userA: TestUser
  let userB: TestUser
  let siteAId: string
  let siteBId: string

  beforeEach(async () => {
    userA = await createTestUser()
    userB = await createTestUser()
    siteAId = await insertSite(userA)
    siteBId = await insertSite(userB)
  })

  afterEach(async () => {
    await truncateUserData(userA.userId)
    await truncateUserData(userB.userId)
  })

  describe('shape + defaults', () => {
    it('insert happy path returns id with defaults', async () => {
      const { data, error } = await insertRule(siteAId)
      expect(error).toBeNull()
      expect(data?.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(data?.rule_type).toBe('turn_count')
      expect(data?.action).toBe('ask_email')
      expect(data?.priority).toBe(0)
      expect(data?.is_active).toBe(true)
    })

    it('rule_type CHECK rejects unknown value', async () => {
      const { error } = await insertRule(siteAId, { rule_type: 'gibberish' })
      expect(error).not.toBeNull()
    })

    it('action CHECK rejects unknown value', async () => {
      const { error } = await insertRule(siteAId, { action: 'launch_missile' })
      expect(error).not.toBeNull()
    })

    it('accepts each of the five actions', async () => {
      const actions = [
        'ask_email',
        'ask_phone',
        'show_form',
        'calendly_link',
        'handoff',
      ]
      for (const action of actions) {
        const { data, error } = await insertRule(siteAId, { action })
        expect(error).toBeNull()
        expect(data?.action).toBe(action)
      }
    })

    it('accepts keyword + intent rule types', async () => {
      const kw = await insertRule(siteAId, {
        rule_type: 'keyword',
        config: { keywords: ['price'] },
      })
      const intent = await insertRule(siteAId, {
        rule_type: 'intent',
        config: { intents: ['complaint'] },
        action: 'handoff',
      })
      expect(kw.error).toBeNull()
      expect(intent.error).toBeNull()
    })
  })

  describe('RLS: owner CRUD, peer isolation', () => {
    it('user A can SELECT own rules', async () => {
      await insertRule(siteAId)
      const client = clientAs(userA.jwt)
      const { data } = await client
        .from('escalation_rules')
        .select('id')
        .eq('site_id', siteAId)
      expect(data).toHaveLength(1)
    })

    it("user A cannot SELECT user B's rules", async () => {
      await insertRule(siteBId)
      const client = clientAs(userA.jwt)
      const { data } = await client
        .from('escalation_rules')
        .select('id')
        .eq('site_id', siteBId)
      expect(data).toEqual([])
    })

    it('anon reads zero rules', async () => {
      await insertRule(siteAId)
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(
        process.env.SUPABASE_TEST_URL!,
        process.env.SUPABASE_TEST_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const { data } = await anon.from('escalation_rules').select('id')
      expect(data).toEqual([])
    })

    it('user A can INSERT into own site', async () => {
      const client = clientAs(userA.jwt)
      const { error } = await client.from('escalation_rules').insert({
        site_id: siteAId,
        rule_type: 'turn_count',
        config: { turns: 3 },
        action: 'ask_email',
      })
      expect(error).toBeNull()
    })

    it("user A cannot INSERT into user B's site", async () => {
      const client = clientAs(userA.jwt)
      const { error } = await client.from('escalation_rules').insert({
        site_id: siteBId,
        rule_type: 'turn_count',
        config: { turns: 3 },
        action: 'ask_email',
      })
      expect(error).not.toBeNull()
    })

    it('user A can UPDATE own rule; cannot pwn user B', async () => {
      const { data: rule } = await insertRule(siteAId)
      const { data: otherRule } = await insertRule(siteBId, { priority: 5 })
      const client = clientAs(userA.jwt)

      await client
        .from('escalation_rules')
        .update({ priority: 99 })
        .eq('id', rule!.id)
      await client
        .from('escalation_rules')
        .update({ priority: 99 })
        .eq('id', otherRule!.id)

      const admin = serviceRoleClient()
      const { data: own } = await admin
        .from('escalation_rules')
        .select('priority')
        .eq('id', rule!.id)
        .single<{ priority: number }>()
      const { data: other } = await admin
        .from('escalation_rules')
        .select('priority')
        .eq('id', otherRule!.id)
        .single<{ priority: number }>()
      expect(own?.priority).toBe(99)
      expect(other?.priority).toBe(5)
    })
  })

  describe('cascade: deleting site removes rules', () => {
    it('rows vanish when parent site deleted', async () => {
      const { data: rule } = await insertRule(siteAId)
      const admin = serviceRoleClient()
      await admin.from('sites').delete().eq('id', siteAId)
      const { data: after } = await admin
        .from('escalation_rules')
        .select('id')
        .eq('id', rule!.id)
      expect(after).toEqual([])
    })
  })

  describe('conversations.needs_human column', () => {
    it('new conversation defaults to needs_human=false', async () => {
      const admin = serviceRoleClient()
      const { data, error } = await admin
        .from('conversations')
        .insert({
          site_id: siteAId,
          visitor_id: 'v_test',
          messages: [],
          message_count: 0,
        })
        .select('needs_human')
        .single<{ needs_human: boolean }>()
      expect(error).toBeNull()
      expect(data?.needs_human).toBe(false)
    })

    it('UPDATE to needs_human=true persists', async () => {
      const admin = serviceRoleClient()
      const { data: created } = await admin
        .from('conversations')
        .insert({ site_id: siteAId, visitor_id: 'v_test', messages: [] })
        .select('id')
        .single<{ id: string }>()
      await admin
        .from('conversations')
        .update({ needs_human: true })
        .eq('id', created!.id)
      const { data: after } = await admin
        .from('conversations')
        .select('needs_human')
        .eq('id', created!.id)
        .single<{ needs_human: boolean }>()
      expect(after?.needs_human).toBe(true)
    })
  })
})
