/**
 * VAL-RLS-011: Service role bypasses RLS (intentional).
 *
 * Required for Firecrawl + Stripe webhook paths. A service-role client can
 * SELECT rows from multiple users.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestUser,
  truncateUserData,
  hasSupabaseTestEnv,
  serviceRoleClient,
} from './helpers/supabase'
import { seedUserFixture, type UserFixture } from './helpers/rls-fixtures'

describe.skipIf(!hasSupabaseTestEnv())('RLS: service role bypass', () => {
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

  it('service-role SELECT returns rows across multiple users', async () => {
    const admin = serviceRoleClient()
    const { data, error } = await admin
      .from('sites')
      .select('id, user_id')
      .in('user_id', [userA.user.userId, userB.user.userId])

    expect(error).toBeNull()
    expect(data).toHaveLength(2)
    const ids = new Set(data?.map((r) => r.user_id))
    expect(ids.has(userA.user.userId)).toBe(true)
    expect(ids.has(userB.user.userId)).toBe(true)
  })
})
