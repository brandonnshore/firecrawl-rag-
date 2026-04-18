/**
 * VAL-RLS-006: User A cannot UPDATE user B's site.
 * VAL-RLS-007: User A cannot DELETE user B's leads.
 *
 * RLS blocks cross-user mutations silently — result is 0 rows affected and
 * the target row is unchanged afterwards (verified via service-role read).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestUser,
  clientAs,
  truncateUserData,
  hasSupabaseTestEnv,
  serviceRoleClient,
} from './helpers/supabase'
import { seedUserFixture, type UserFixture } from './helpers/rls-fixtures'

describe.skipIf(!hasSupabaseTestEnv())('RLS: cross-user mutations blocked', () => {
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

  it("user A's UPDATE on user B's site affects 0 rows and B's site is unchanged", async () => {
    const aClient = clientAs(userA.user.jwt)
    const { data: updatedRows, error } = await aClient
      .from('sites')
      .update({ name: 'pwned' })
      .eq('id', userB.siteId)
      .select('id')

    expect(error).toBeNull()
    expect(updatedRows).toEqual([])

    const admin = serviceRoleClient()
    const { data: sanity } = await admin
      .from('sites')
      .select('name')
      .eq('id', userB.siteId)
      .single()
    expect(sanity?.name).not.toBe('pwned')
  })

  it("user A's DELETE on user B's leads affects 0 rows", async () => {
    const aClient = clientAs(userA.user.jwt)
    const { data: deleted, error } = await aClient
      .from('leads')
      .delete()
      .eq('id', userB.leadId)
      .select('id')

    expect(error).toBeNull()
    expect(deleted).toEqual([])

    const admin = serviceRoleClient()
    const { data: stillThere } = await admin
      .from('leads')
      .select('id')
      .eq('id', userB.leadId)
    expect(stillThere).toHaveLength(1)
  })
})
