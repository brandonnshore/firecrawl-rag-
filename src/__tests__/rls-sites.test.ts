/**
 * VAL-RLS-001: User A cannot SELECT user B's sites.
 *
 * With user A's JWT, querying `sites` for user B's rows returns 0 rows —
 * Supabase RLS policy `Users own their sites (user_id = auth.uid())`
 * filters out cross-user rows silently (no error, no leak).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestUser,
  clientAs,
  truncateUserData,
  hasSupabaseTestEnv,
} from './helpers/supabase'
import { seedUserFixture, type UserFixture } from './helpers/rls-fixtures'

describe.skipIf(!hasSupabaseTestEnv())('RLS: sites cross-user isolation', () => {
  let userA: UserFixture
  let userB: UserFixture

  beforeAll(async () => {
    const a = await createTestUser()
    const b = await createTestUser()
    userA = await seedUserFixture(a)
    userB = await seedUserFixture(b)
  })

  afterAll(async () => {
    await truncateUserData(userA.user.userId)
    await truncateUserData(userB.user.userId)
  })

  it("user A cannot read user B's sites by user_id", async () => {
    const client = clientAs(userA.user.jwt)
    const { data, error } = await client
      .from('sites')
      .select('id, user_id')
      .eq('user_id', userB.user.userId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("user A cannot read user B's site by id", async () => {
    const client = clientAs(userA.user.jwt)
    const { data, error } = await client
      .from('sites')
      .select('id')
      .eq('id', userB.siteId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('user A can read their own site', async () => {
    const client = clientAs(userA.user.jwt)
    const { data, error } = await client
      .from('sites')
      .select('id')
      .eq('id', userA.siteId)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})
