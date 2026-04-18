/**
 * VAL-RLS-014: 50 parallel cross-user reads never cross-pollute.
 *
 * Fires 50 concurrent SELECTs alternating between user A and user B, each
 * asserting their own rows only. Timing + per-iteration row counts logged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestUser,
  clientAs,
  truncateUserData,
  hasSupabaseTestEnv,
} from './helpers/supabase'
import { seedUserFixture, type UserFixture } from './helpers/rls-fixtures'

describe.skipIf(!hasSupabaseTestEnv())('RLS: 50 concurrent cross-user reads', () => {
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

  it(
    '50 alternating concurrent sites reads — no cross-pollution',
    async () => {
      const aClient = clientAs(userA.user.jwt)
      const bClient = clientAs(userB.user.jwt)

      const t0 = performance.now()
      const ops = Array.from({ length: 50 }, (_, i) => async () => {
        const isA = i % 2 === 0
        const client = isA ? aClient : bClient
        const { data, error } = await client.from('sites').select('id, user_id')
        return { isA, data, error }
      })

      const results = await Promise.all(ops.map((op) => op()))
      const elapsed = performance.now() - t0

      for (const { isA, data, error } of results) {
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
        expect(data?.[0].user_id).toBe(isA ? userA.user.userId : userB.user.userId)
      }

      // Log to meet evidence requirement (test output with timing)
      console.log(
        `[rls-concurrent] 50 reads in ${elapsed.toFixed(1)}ms (${(elapsed / 50).toFixed(1)}ms avg)`
      )
    },
    30_000
  )
})
