/**
 * M5F1 supplementary-files-schema-storage — table + RLS + Storage bucket.
 *
 * Asserts:
 *   - Table exists with required columns + constraints
 *   - UNIQUE(site_id, content_hash) dedupe at DB level
 *   - RLS: user A cannot SELECT user B's files
 *   - ON DELETE CASCADE: deleting a site removes its files rows
 *   - Storage bucket 'knowledge-files' present
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  hasSupabaseTestEnv,
  serviceRoleClient,
  createTestUser,
  clientAs,
  truncateUserData,
  type TestUser,
} from './helpers/supabase'

async function insertSite(user: TestUser): Promise<string> {
  const admin = serviceRoleClient()
  const { data, error } = await admin
    .from('sites')
    .insert({
      user_id: user.userId,
      url: 'https://example.test',
      crawl_status: 'ready',
    })
    .select('id')
    .single<{ id: string }>()
  if (error) throw error
  return data!.id
}

async function insertFile(
  siteId: string,
  overrides: Record<string, unknown> = {}
) {
  const admin = serviceRoleClient()
  return admin
    .from('supplementary_files')
    .insert({
      site_id: siteId,
      filename: 'spec.pdf',
      storage_path: `${siteId}/file-${crypto.randomUUID()}.pdf`,
      bytes: 1024,
      content_hash: `hash_${crypto.randomUUID()}`,
      ...overrides,
    })
    .select('id, status')
    .single<{ id: string; status: string }>()
}

describe.skipIf(!hasSupabaseTestEnv())('M5F1 supplementary_files schema', () => {
  let userA: TestUser
  let userB: TestUser
  let siteAId: string
  let siteBId: string

  beforeEach(async () => {
    userA = await createTestUser()
    userB = await createTestUser()
    siteAId = await insertSite(userA)
    siteBId = await insertSite(userB)
  })

  afterEach(async () => {
    await truncateUserData(userA.userId)
    await truncateUserData(userB.userId)
  })

  describe('shape + defaults', () => {
    it('insert happy path returns id with status=queued', async () => {
      const { data, error } = await insertFile(siteAId)
      expect(error).toBeNull()
      expect(data?.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(data?.status).toBe('queued')
    })

    it('bytes CHECK (> 0) rejects zero-byte row', async () => {
      const { error } = await insertFile(siteAId, { bytes: 0 })
      expect(error).not.toBeNull()
    })

    it('status CHECK rejects invalid state', async () => {
      const { error } = await insertFile(siteAId, { status: 'gibberish' })
      expect(error).not.toBeNull()
    })
  })

  describe('dedupe — UNIQUE(site_id, content_hash)', () => {
    it('second insert with same (site_id, content_hash) conflicts', async () => {
      const hash = 'hash_dedupe_test'
      const first = await insertFile(siteAId, { content_hash: hash })
      expect(first.error).toBeNull()

      const second = await insertFile(siteAId, { content_hash: hash })
      expect(second.error).not.toBeNull()
      // 23505 = unique_violation
      expect(second.error?.code).toBe('23505')
    })

    it('same content_hash allowed across different sites', async () => {
      const hash = 'hash_cross_site_ok'
      const a = await insertFile(siteAId, { content_hash: hash })
      const b = await insertFile(siteBId, { content_hash: hash })
      expect(a.error).toBeNull()
      expect(b.error).toBeNull()
    })
  })

  describe('RLS: owner SELECT only', () => {
    it('user A can SELECT own file rows', async () => {
      await insertFile(siteAId)
      const client = clientAs(userA.jwt)
      const { data, error } = await client
        .from('supplementary_files')
        .select('id')
        .eq('site_id', siteAId)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it("user A cannot SELECT user B's file rows", async () => {
      await insertFile(siteBId)
      const client = clientAs(userA.jwt)
      const { data, error } = await client
        .from('supplementary_files')
        .select('id')
        .eq('site_id', siteBId)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('anon client reads zero rows', async () => {
      await insertFile(siteAId)
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(
        process.env.SUPABASE_TEST_URL!,
        process.env.SUPABASE_TEST_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const { data } = await anon.from('supplementary_files').select('id')
      expect(data).toEqual([])
    })
  })

  describe('cascade: deleting site removes files', () => {
    it('supplementary_files row deleted when parent site deleted', async () => {
      const { data: file } = await insertFile(siteAId)
      const admin = serviceRoleClient()

      await admin.from('sites').delete().eq('id', siteAId)

      const { data: after } = await admin
        .from('supplementary_files')
        .select('id')
        .eq('id', file!.id)
      expect(after).toEqual([])
    })
  })

  describe('Storage bucket', () => {
    it('knowledge-files bucket exists', async () => {
      const admin = serviceRoleClient()
      const { data } = await admin
        .from('buckets')
        .select('id, name, public')
        .eq('id', 'knowledge-files')
        .single()

      // buckets table lives in the storage schema — Supabase JS surfaces it
      // via the storage API when we use .from() against the storage namespace.
      // If the above fails, query via raw SQL via the pg pool.
      if (data) {
        expect(data.id).toBe('knowledge-files')
        expect(data.public).toBe(false)
      } else {
        const { Pool } = await import('pg')
        const pool = new Pool({
          connectionString:
            process.env.SUPABASE_TEST_DB_URL ||
            'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
        })
        try {
          const { rows } = await pool.query(
            `select id, public from storage.buckets where id = 'knowledge-files'`
          )
          expect(rows).toHaveLength(1)
          expect(rows[0].public).toBe(false)
        } finally {
          await pool.end()
        }
      }
    })
  })
})
