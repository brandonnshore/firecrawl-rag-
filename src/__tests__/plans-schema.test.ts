/**
 * M2F1 plans-schema-migration — seed integrity + RLS contract.
 *
 * Asserts:
 *   - 3 seed rows (starter, pro, scale) with caps matching mission.md.
 *   - Anon client can SELECT plans (public plan list).
 *   - Anon client cannot INSERT / UPDATE / DELETE (service-role only).
 *   - Service-role client CAN write plans (used by create-stripe-prices script).
 *   - profiles.plan_id FK present, nullable; profiles.current_period_start added.
 */

import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  hasSupabaseTestEnv,
  serviceRoleClient,
  createTestUser,
  truncateUserData,
} from './helpers/supabase'

function anonClient() {
  return createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface PlanRow {
  id: string
  display_name: string
  price_cents: number
  monthly_message_limit: number
  monthly_crawl_page_limit: number
  supplementary_file_limit: number
  stripe_price_id: string | null
}

describe.skipIf(!hasSupabaseTestEnv())('M2F1 plans schema', () => {
  describe('seed data', () => {
    it('has exactly 3 plans: starter, pro, scale', async () => {
      const admin = serviceRoleClient()
      const { data, error } = await admin
        .from('plans')
        .select('id')
        .order('price_cents', { ascending: true })

      expect(error).toBeNull()
      expect(data?.map((r) => r.id)).toEqual(['starter', 'pro', 'scale'])
    })

    it('starter caps match mission.md (2499c / 2000 msg / 500 pages / 25 files)', async () => {
      const admin = serviceRoleClient()
      const { data, error } = await admin
        .from('plans')
        .select('*')
        .eq('id', 'starter')
        .single<PlanRow>()

      expect(error).toBeNull()
      expect(data?.price_cents).toBe(2499)
      expect(data?.monthly_message_limit).toBe(2000)
      expect(data?.monthly_crawl_page_limit).toBe(500)
      expect(data?.supplementary_file_limit).toBe(25)
    })

    it('pro caps match mission.md (4999c / 7500 / 1500 / 100)', async () => {
      const admin = serviceRoleClient()
      const { data } = await admin
        .from('plans')
        .select('*')
        .eq('id', 'pro')
        .single<PlanRow>()

      expect(data?.price_cents).toBe(4999)
      expect(data?.monthly_message_limit).toBe(7500)
      expect(data?.monthly_crawl_page_limit).toBe(1500)
      expect(data?.supplementary_file_limit).toBe(100)
    })

    it('scale caps match mission.md (9900c / 25000 / 5000 / 500)', async () => {
      const admin = serviceRoleClient()
      const { data } = await admin
        .from('plans')
        .select('*')
        .eq('id', 'scale')
        .single<PlanRow>()

      expect(data?.price_cents).toBe(9900)
      expect(data?.monthly_message_limit).toBe(25000)
      expect(data?.monthly_crawl_page_limit).toBe(5000)
      expect(data?.supplementary_file_limit).toBe(500)
    })
  })

  describe('RLS: public read', () => {
    it('anon SELECT returns all 3 plans', async () => {
      const anon = anonClient()
      const { data, error } = await anon.from('plans').select('id, price_cents')
      expect(error).toBeNull()
      expect(data).toHaveLength(3)
    })
  })

  describe('RLS: anon writes blocked', () => {
    it('anon INSERT rejected', async () => {
      const anon = anonClient()
      const { error } = await anon.from('plans').insert({
        id: 'rogue',
        display_name: 'Rogue',
        price_cents: 1,
        monthly_message_limit: 1,
        monthly_crawl_page_limit: 1,
        supplementary_file_limit: 1,
      })
      expect(error).not.toBeNull()

      const admin = serviceRoleClient()
      const { data } = await admin.from('plans').select('id').eq('id', 'rogue')
      expect(data).toEqual([])
    })

    it('anon UPDATE silently affects 0 rows', async () => {
      const anon = anonClient()
      await anon
        .from('plans')
        .update({ price_cents: 1 })
        .eq('id', 'starter')

      const admin = serviceRoleClient()
      const { data } = await admin
        .from('plans')
        .select('price_cents')
        .eq('id', 'starter')
        .single<{ price_cents: number }>()
      expect(data?.price_cents).toBe(2499)
    })

    it('anon DELETE silently affects 0 rows', async () => {
      const anon = anonClient()
      await anon.from('plans').delete().eq('id', 'starter')

      const admin = serviceRoleClient()
      const { data } = await admin.from('plans').select('id').eq('id', 'starter')
      expect(data).toHaveLength(1)
    })
  })

  describe('service-role writes (used by create-stripe-prices script)', () => {
    it('can UPDATE stripe_price_id', async () => {
      const admin = serviceRoleClient()
      const marker = `price_test_${Date.now()}`
      const { error } = await admin
        .from('plans')
        .update({ stripe_price_id: marker })
        .eq('id', 'starter')
      expect(error).toBeNull()

      const { data } = await admin
        .from('plans')
        .select('stripe_price_id')
        .eq('id', 'starter')
        .single<{ stripe_price_id: string }>()
      expect(data?.stripe_price_id).toBe(marker)

      // Cleanup
      await admin
        .from('plans')
        .update({ stripe_price_id: null })
        .eq('id', 'starter')
    })
  })

  describe('profiles extension', () => {
    it('plan_id column exists, nullable, FK to plans', async () => {
      const user = await createTestUser()
      try {
        const admin = serviceRoleClient()

        // Set plan_id
        const { error } = await admin
          .from('profiles')
          .update({ plan_id: 'starter' })
          .eq('id', user.userId)
        expect(error).toBeNull()

        // Read back
        const { data } = await admin
          .from('profiles')
          .select('plan_id, current_period_start, current_period_end')
          .eq('id', user.userId)
          .single<{
            plan_id: string | null
            current_period_start: string | null
            current_period_end: string | null
          }>()
        expect(data?.plan_id).toBe('starter')

        // Invalid FK rejected
        const { error: fkErr } = await admin
          .from('profiles')
          .update({ plan_id: 'bogus' })
          .eq('id', user.userId)
        expect(fkErr).not.toBeNull()
      } finally {
        await truncateUserData(user.userId)
      }
    })

    it('subscription_status accepts canceled (Stripe spelling)', async () => {
      const user = await createTestUser()
      try {
        const admin = serviceRoleClient()
        const { error } = await admin
          .from('profiles')
          .update({ subscription_status: 'canceled' })
          .eq('id', user.userId)
        expect(error).toBeNull()
      } finally {
        await truncateUserData(user.userId)
      }
    })
  })
})
