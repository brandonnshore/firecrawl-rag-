/**
 * VAL-RLS-008: Widget with valid site_key reads only that site's embeddings.
 * VAL-RLS-009: Widget with wrong site_key returns zero rows (no schema leak).
 * VAL-RLS-010: Widget can insert lead only for valid site_id.
 *
 * The widget is anonymous (no auth JWT). The API validates site_key in code
 * and then uses the service-role client for reads/writes — so the "RLS check"
 * here is actually a sanity check that an anonymous client reading embeddings
 * directly gets zero rows (because the embeddings SELECT policy requires
 * auth.uid() matching the owning site's user_id).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  createTestUser,
  truncateUserData,
  hasSupabaseTestEnv,
  serviceRoleClient,
} from './helpers/supabase'
import { seedUserFixture, type UserFixture } from './helpers/rls-fixtures'

function anonClient() {
  return createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

describe.skipIf(!hasSupabaseTestEnv())('RLS: widget (anonymous) site_key scoping', () => {
  let userA: UserFixture
  let userB: UserFixture

  beforeAll(async () => {
    userA = await seedUserFixture(await createTestUser())
    userB = await seedUserFixture(await createTestUser())
  })

  afterAll(async () => {
    await truncateUserData(userA.user.userId)
    await truncateUserData(userB.user.userId)
  })

  it('anonymous client (no JWT) reads zero rows from embeddings (VAL-RLS-008/009)', async () => {
    const anon = anonClient()
    const { data, error } = await anon.from('embeddings').select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('anonymous read with bogus site_key filter yields zero rows and no schema leak', async () => {
    const anon = anonClient()
    const { data, error } = await anon
      .from('embeddings')
      .select('id')
      .eq('site_id', '00000000-0000-0000-0000-000000000000')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('service-role client scoped to site A sees only A rows, not B', async () => {
    const admin = serviceRoleClient()
    const { data: aRows } = await admin
      .from('embeddings')
      .select('id')
      .eq('site_id', userA.siteId)
    const { data: bRows } = await admin
      .from('embeddings')
      .select('id')
      .eq('site_id', userB.siteId)
    expect(aRows).toHaveLength(1)
    expect(bRows).toHaveLength(1)
    // Ensure the filter, not RLS, is what scopes them — different sites return different rows.
    expect(aRows?.[0].id).not.toBe(bRows?.[0].id)
  })

  it('VAL-RLS-010: anonymous INSERT into leads for a bogus site_id fails', async () => {
    const anon = anonClient()
    const { error } = await anon
      .from('leads')
      .insert({
        site_id: '00000000-0000-0000-0000-000000000000',
        email: 'widget@test.local',
      })
    // FK or RLS error — either way, the insert is rejected.
    expect(error).not.toBeNull()
  })

  it('VAL-RLS-010: anonymous INSERT into leads for a real site_id succeeds (RLS policy allows when site has site_key)', async () => {
    const anon = anonClient()
    const uniqueEmail = `widget-${Date.now()}@test.local`
    // Use default (minimal return) — anon cannot SELECT leads back after insert
    // per "Users access own site leads" policy, which is correct defense in depth.
    // Production widget uses service-role via the API route.
    const { error } = await anon
      .from('leads')
      .insert({ site_id: userA.siteId, email: uniqueEmail })

    expect(error).toBeNull()

    // Service-role readback to confirm the row landed.
    const { data: inserted } = await serviceRoleClient()
      .from('leads')
      .select('id, email')
      .eq('email', uniqueEmail)
    expect(inserted).toHaveLength(1)
  })
})
