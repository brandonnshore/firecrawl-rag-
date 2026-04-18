/**
 * VAL-RLS-003: User A cannot SELECT user B's pages.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestUser,
  clientAs,
  truncateUserData,
  hasSupabaseTestEnv,
} from './helpers/supabase'
import { seedUserFixture, type UserFixture } from './helpers/rls-fixtures'

describe.skipIf(!hasSupabaseTestEnv())('RLS: pages cross-user isolation', () => {
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

  it("user A cannot read pages belonging to user B's site", async () => {
    const client = clientAs(userA.user.jwt)
    const { data, error } = await client
      .from('pages')
      .select('id')
      .eq('site_id', userB.siteId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('user A can read their own pages', async () => {
    const client = clientAs(userA.user.jwt)
    const { data, error } = await client
      .from('pages')
      .select('id')
      .eq('site_id', userA.siteId)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})
