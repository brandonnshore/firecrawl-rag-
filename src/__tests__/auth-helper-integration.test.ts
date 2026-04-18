/**
 * Integration smoke test for helpers/auth.createTestSessionViaAdmin —
 * confirms the returned access token resolves to the correct user via a
 * real supabase JS client (mirrors what Playwright will do for E2E).
 */

import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  truncateUserData,
  hasSupabaseTestEnv,
} from './helpers/supabase'
import { createTestSessionViaAdmin } from './helpers/auth'

describe.skipIf(!hasSupabaseTestEnv())('createTestSessionViaAdmin integration', () => {
  const created: string[] = []

  afterAll(async () => {
    for (const uid of created) await truncateUserData(uid)
  })

  it('returns a JWT that PostgREST accepts as that user', async () => {
    const session = await createTestSessionViaAdmin()
    created.push(session.user.userId)

    const client = createClient(
      process.env.SUPABASE_TEST_URL!,
      process.env.SUPABASE_TEST_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${session.accessToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    )

    // Reading your own profile via the authenticated client should work
    // (profiles RLS: id = auth.uid()).
    const { data, error } = await client
      .from('profiles')
      .select('id, email')
      .eq('id', session.user.userId)
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBe(session.user.userId)
    expect(data?.email).toBe(session.user.email)
  })
})
