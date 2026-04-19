/**
 * M6F1 custom-responses-schema — table + RLS + cascades.
 *
 * Asserts:
 *   - Table exists with required columns + constraints (trigger_type CHECK,
 *     triggers NOT EMPTY, response NOT EMPTY).
 *   - RLS: owner can read/insert/update/delete through sites.user_id; user A
 *     sees zero of user B's rules; anon sees zero.
 *   - ON DELETE CASCADE from sites.
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
    .from('custom_responses')
    .insert({
      site_id: siteId,
      trigger_type: 'keyword',
      triggers: ['pricing', 'cost'],
      response: 'Our pricing starts at $49/mo.',
      priority: 0,
      is_active: true,
      ...overrides,
    })
    .select('id, trigger_type, priority, is_active')
    .single<{
      id: string
      trigger_type: string
      priority: number
      is_active: boolean
    }>()
}

describe.skipIf(!hasSupabaseTestEnv())('M6F1 custom_responses schema', () => {
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
      expect(data?.trigger_type).toBe('keyword')
      expect(data?.priority).toBe(0)
      expect(data?.is_active).toBe(true)
    })

    it('trigger_type CHECK rejects unknown value', async () => {
      const { error } = await insertRule(siteAId, { trigger_type: 'gibberish' })
      expect(error).not.toBeNull()
    })

    it('empty triggers array rejected', async () => {
      const { error } = await insertRule(siteAId, { triggers: [] })
      expect(error).not.toBeNull()
    })

    it('empty response rejected', async () => {
      const { error } = await insertRule(siteAId, { response: '' })
      expect(error).not.toBeNull()
    })

    it('intent trigger_type accepted', async () => {
      const { data, error } = await insertRule(siteAId, {
        trigger_type: 'intent',
        triggers: ['hours'],
        response: "We're open 9-5.",
      })
      expect(error).toBeNull()
      expect(data?.trigger_type).toBe('intent')
    })
  })

  describe('RLS: owner CRUD, peer isolation', () => {
    it('user A can SELECT own site rules', async () => {
      await insertRule(siteAId)
      const client = clientAs(userA.jwt)
      const { data, error } = await client
        .from('custom_responses')
        .select('id')
        .eq('site_id', siteAId)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it("user A cannot SELECT user B's rules", async () => {
      await insertRule(siteBId)
      const client = clientAs(userA.jwt)
      const { data } = await client
        .from('custom_responses')
        .select('id')
        .eq('site_id', siteBId)
      expect(data).toEqual([])
    })

    it('anon client reads zero rules', async () => {
      await insertRule(siteAId)
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(
        process.env.SUPABASE_TEST_URL!,
        process.env.SUPABASE_TEST_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const { data } = await anon.from('custom_responses').select('id')
      expect(data).toEqual([])
    })

    it('user A can INSERT into own site', async () => {
      const client = clientAs(userA.jwt)
      const { data, error } = await client
        .from('custom_responses')
        .insert({
          site_id: siteAId,
          trigger_type: 'keyword',
          triggers: ['hello'],
          response: 'hi there',
        })
        .select('id')
        .single<{ id: string }>()
      expect(error).toBeNull()
      expect(data?.id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it("user A cannot INSERT into user B's site", async () => {
      const client = clientAs(userA.jwt)
      const { error } = await client
        .from('custom_responses')
        .insert({
          site_id: siteBId,
          trigger_type: 'keyword',
          triggers: ['hello'],
          response: 'hi there',
        })
      expect(error).not.toBeNull()
    })

    it('user A can UPDATE own rule', async () => {
      const { data: created } = await insertRule(siteAId)
      const client = clientAs(userA.jwt)
      const { error } = await client
        .from('custom_responses')
        .update({ response: 'updated' })
        .eq('id', created!.id)
      expect(error).toBeNull()

      const admin = serviceRoleClient()
      const { data: row } = await admin
        .from('custom_responses')
        .select('response')
        .eq('id', created!.id)
        .single<{ response: string }>()
      expect(row?.response).toBe('updated')
    })

    it("user A cannot UPDATE user B's rule", async () => {
      const { data: created } = await insertRule(siteBId, {
        response: 'original',
      })
      const client = clientAs(userA.jwt)
      // RLS hides B's row from the UPDATE; we expect zero rows affected, not an error.
      await client
        .from('custom_responses')
        .update({ response: 'pwned' })
        .eq('id', created!.id)

      const admin = serviceRoleClient()
      const { data: row } = await admin
        .from('custom_responses')
        .select('response')
        .eq('id', created!.id)
        .single<{ response: string }>()
      expect(row?.response).toBe('original')
    })

    it('user A can DELETE own rule', async () => {
      const { data: created } = await insertRule(siteAId)
      const client = clientAs(userA.jwt)
      const { error } = await client
        .from('custom_responses')
        .delete()
        .eq('id', created!.id)
      expect(error).toBeNull()

      const admin = serviceRoleClient()
      const { data } = await admin
        .from('custom_responses')
        .select('id')
        .eq('id', created!.id)
      expect(data).toEqual([])
    })
  })

  describe('cascade: deleting site removes rules', () => {
    it('custom_responses rows deleted when parent site deleted', async () => {
      const { data: rule } = await insertRule(siteAId)
      const admin = serviceRoleClient()

      await admin.from('sites').delete().eq('id', siteAId)

      const { data: after } = await admin
        .from('custom_responses')
        .select('id')
        .eq('id', rule!.id)
      expect(after).toEqual([])
    })
  })
})
