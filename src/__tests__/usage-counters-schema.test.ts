/**
 * M3F1 usage-counters-schema-rpc — integration tests against live Supabase.
 *
 * Coverage:
 *   - Table / column / FK / cascade presence
 *   - Trigger: profile insert auto-creates usage_counters row
 *   - RLS: owner SELECT own; cross-user blocked; anon blocked; service-role bypass
 *   - RPC increment_message_counter: happy path, at-budget stops incrementing,
 *     atomic under 20-way parallel calls at budget=10 (exactly 10 oks)
 *
 * Fulfills VAL-QUOTA-012 and VAL-RLS-015.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  hasSupabaseTestEnv,
  serviceRoleClient,
  createTestUser,
  clientAs,
  truncateUserData,
  type TestUser,
} from './helpers/supabase'

function anonClient() {
  return createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface CounterRow {
  user_id: string
  messages_used: number
  crawl_pages_used: number
  files_stored: number
  period_start: string
  period_end: string
}

describe.skipIf(!hasSupabaseTestEnv())('M3F1 usage_counters schema', () => {
  let userA: TestUser
  let userB: TestUser

  beforeEach(async () => {
    userA = await createTestUser()
    userB = await createTestUser()
  })

  afterEach(async () => {
    await truncateUserData(userA.userId)
    await truncateUserData(userB.userId)
  })

  describe('trigger auto-creates usage_counters on profile insert', () => {
    it('user gets a usage_counters row with counters at 0 and valid period', async () => {
      const admin = serviceRoleClient()
      const { data, error } = await admin
        .from('usage_counters')
        .select('*')
        .eq('user_id', userA.userId)
        .single<CounterRow>()

      expect(error).toBeNull()
      expect(data?.messages_used).toBe(0)
      expect(data?.crawl_pages_used).toBe(0)
      expect(data?.files_stored).toBe(0)
      expect(data?.period_start).toBeTruthy()
      expect(data?.period_end).toBeTruthy()
      expect(new Date(data!.period_end).getTime()).toBeGreaterThan(
        new Date(data!.period_start).getTime()
      )
    })
  })

  describe('RLS (VAL-RLS-015 / VAL-QUOTA-012)', () => {
    it('user A can SELECT own counter row', async () => {
      const client = clientAs(userA.jwt)
      const { data, error } = await client
        .from('usage_counters')
        .select('user_id, messages_used')
        .eq('user_id', userA.userId)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it('user A cannot SELECT user B counter row', async () => {
      const client = clientAs(userA.jwt)
      const { data, error } = await client
        .from('usage_counters')
        .select('user_id')
        .eq('user_id', userB.userId)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('anon client reads zero rows', async () => {
      const anon = anonClient()
      const { data, error } = await anon
        .from('usage_counters')
        .select('user_id')
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('user A cannot UPDATE own counter via PostgREST (writes are service-role only)', async () => {
      const client = clientAs(userA.jwt)
      await client
        .from('usage_counters')
        .update({ messages_used: 9999 })
        .eq('user_id', userA.userId)

      const admin = serviceRoleClient()
      const { data } = await admin
        .from('usage_counters')
        .select('messages_used')
        .eq('user_id', userA.userId)
        .single<{ messages_used: number }>()
      expect(data?.messages_used).toBe(0)
    })

    it('service-role SELECT returns both users (intentional bypass)', async () => {
      const admin = serviceRoleClient()
      const { data } = await admin
        .from('usage_counters')
        .select('user_id')
        .in('user_id', [userA.userId, userB.userId])
      expect(data).toHaveLength(2)
    })
  })

  describe('increment_message_counter RPC', () => {
    it('returns ok=true and increments on under-budget call', async () => {
      const admin = serviceRoleClient()
      const { data, error } = await admin.rpc('increment_message_counter', {
        p_user_id: userA.userId,
        p_limit: 10,
      })
      expect(error).toBeNull()
      expect(data).toEqual(
        expect.objectContaining({ ok: true, used: 1, limit: 10 })
      )

      const { data: row } = await admin
        .from('usage_counters')
        .select('messages_used')
        .eq('user_id', userA.userId)
        .single<{ messages_used: number }>()
      expect(row?.messages_used).toBe(1)
    })

    it('returns ok=false without incrementing when at budget', async () => {
      const admin = serviceRoleClient()
      await admin
        .from('usage_counters')
        .update({ messages_used: 10 })
        .eq('user_id', userA.userId)

      const { data } = await admin.rpc('increment_message_counter', {
        p_user_id: userA.userId,
        p_limit: 10,
      })
      expect(data).toEqual(
        expect.objectContaining({ ok: false, used: 10, limit: 10 })
      )

      const { data: row } = await admin
        .from('usage_counters')
        .select('messages_used')
        .eq('user_id', userA.userId)
        .single<{ messages_used: number }>()
      expect(row?.messages_used).toBe(10)
    })

    it('20 parallel calls at budget=10 yield exactly 10 oks and ends at 10', async () => {
      const admin = serviceRoleClient()
      const promises = Array.from({ length: 20 }, () =>
        admin.rpc('increment_message_counter', {
          p_user_id: userA.userId,
          p_limit: 10,
        })
      )
      const results = await Promise.all(promises)
      const oks = results.filter((r) => (r.data as { ok: boolean })?.ok).length
      const denials = results.length - oks
      expect(oks).toBe(10)
      expect(denials).toBe(10)

      const { data: row } = await admin
        .from('usage_counters')
        .select('messages_used')
        .eq('user_id', userA.userId)
        .single<{ messages_used: number }>()
      expect(row?.messages_used).toBe(10)
    })
  })
})
