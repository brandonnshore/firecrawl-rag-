/**
 * VAL-AUTH-013 integration: after site-key rotation, the old key no longer
 * resolves to a site, and the new key does. Exercises the real Supabase
 * local stack (service-role lookup path used by /api/chat/session).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestUser,
  truncateUserData,
  hasSupabaseTestEnv,
  serviceRoleClient,
} from './helpers/supabase'
import { seedUserFixture, type UserFixture } from './helpers/rls-fixtures'
import crypto from 'crypto'

describe.skipIf(!hasSupabaseTestEnv())('site-key rotation invalidates old key', () => {
  let fixture: UserFixture

  beforeAll(async () => {
    fixture = await seedUserFixture(await createTestUser())
  })

  afterAll(async () => {
    await truncateUserData(fixture.user.userId)
  })

  it('lookup by OLD key returns the site; after rotation the old key misses and the new key hits', async () => {
    const admin = serviceRoleClient()

    // Pre-rotation: site exists with original key
    const { data: pre } = await admin
      .from('sites')
      .select('id')
      .eq('site_key', fixture.siteKey)
      .maybeSingle()
    expect(pre?.id).toBe(fixture.siteId)

    // Rotate (simulate POST /api/sites/rotate-key body-less call at the DB layer)
    const newKey = crypto.randomBytes(16).toString('hex')
    const { data: rotated, error } = await admin
      .from('sites')
      .update({ site_key: newKey })
      .eq('user_id', fixture.user.userId)
      .select('id, site_key')
      .single()

    expect(error).toBeNull()
    expect(rotated?.site_key).toBe(newKey)

    // Post-rotation: old key no longer resolves, new key does
    const { data: afterOld } = await admin
      .from('sites')
      .select('id')
      .eq('site_key', fixture.siteKey)
      .maybeSingle()
    expect(afterOld).toBeNull()

    const { data: afterNew } = await admin
      .from('sites')
      .select('id')
      .eq('site_key', newKey)
      .maybeSingle()
    expect(afterNew?.id).toBe(fixture.siteId)
  })
})
