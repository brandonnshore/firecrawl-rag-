/**
 * VAL-RLS-012: Anonymous user (no JWT) reads 0 rows from user-scoped tables.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  createTestUser,
  truncateUserData,
  hasSupabaseTestEnv,
} from './helpers/supabase'
import { seedUserFixture, type UserFixture } from './helpers/rls-fixtures'

function anonClient() {
  return createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

describe.skipIf(!hasSupabaseTestEnv())('RLS: anonymous reads nothing', () => {
  let fixture: UserFixture

  beforeAll(async () => {
    fixture = await seedUserFixture(await createTestUser())
  })

  afterAll(async () => {
    await truncateUserData(fixture.user.userId)
  })

  for (const table of [
    'sites',
    'pages',
    'embeddings',
    'leads',
    'conversations',
    'profiles',
  ] as const) {
    it(`anon cannot read ${table}`, async () => {
      const anon = anonClient()
      const { data, error } = await anon.from(table).select('*')
      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  }
})
