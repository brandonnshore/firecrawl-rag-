/**
 * Supabase test harness helpers — used by RLS and integration tests against
 * the local Supabase stack started by `supabase start`.
 *
 * Environment variables (set by CI / supabase start):
 *   SUPABASE_TEST_URL               API URL, e.g. http://127.0.0.1:54321
 *   SUPABASE_TEST_ANON_KEY          anon JWT for creating user-scoped clients
 *   SUPABASE_TEST_SERVICE_ROLE_KEY  service-role JWT for privileged setup/teardown
 *
 * Helpers are JWT-based: createTestUser returns a short-lived access token
 * that tests pass to clientAs() to obtain an authenticated Supabase client.
 * No dependency on cookies / the Next.js runtime.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import jwt from 'jsonwebtoken'
import { Pool, type Pool as PgPool } from 'pg'

export interface TestUser {
  userId: string
  email: string
  jwt: string
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

/**
 * Supabase JWT secret used to sign test access tokens. PostgREST (the layer
 * RLS tests hit) accepts HS256-signed tokens for the local stack — the auth
 * admin API is bypassed so we sidestep its newer asymmetric-key requirements.
 */
function supabaseJwtSecret(): string {
  return (
    process.env.SUPABASE_TEST_JWT_SECRET ||
    'super-secret-jwt-token-with-at-least-32-characters-long'
  )
}

export function hasSupabaseTestEnv(): boolean {
  return (
    !!process.env.SUPABASE_TEST_URL &&
    !!process.env.SUPABASE_TEST_ANON_KEY &&
    !!process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
  )
}

export function serviceRoleClient(): SupabaseClient {
  return createClient(
    requireEnv('SUPABASE_TEST_URL'),
    requireEnv('SUPABASE_TEST_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

let _pool: PgPool | undefined
function pgPool(): PgPool {
  if (!_pool) {
    _pool = new Pool({
      connectionString:
        process.env.SUPABASE_TEST_DB_URL ||
        'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      max: 4,
    })
  }
  return _pool
}

export async function closeTestPool(): Promise<void> {
  if (_pool) {
    await _pool.end()
    _pool = undefined
  }
}

function signUserJwt(userId: string, email: string): string {
  const nowSec = Math.floor(Date.now() / 1000)
  return jwt.sign(
    {
      aud: 'authenticated',
      role: 'authenticated',
      sub: userId,
      email,
      iat: nowSec,
      exp: nowSec + 60 * 60,
    },
    supabaseJwtSecret(),
    { algorithm: 'HS256' }
  )
}

/**
 * Creates a verified test user by inserting directly into auth.users (via the
 * service-role REST endpoint is restricted; we use a raw SQL RPC through
 * PostgreSQL's admin connection when possible). Returns a freshly signed
 * HS256 JWT that PostgREST accepts for RLS evaluation.
 */
export async function createTestUser(email?: string): Promise<TestUser> {
  const admin = serviceRoleClient()
  const mail = email ?? `test-${crypto.randomUUID()}@rubycrawl.test`
  const userId = crypto.randomUUID()

  // Insert into auth.users directly via pg — the auth admin REST API on the
  // local stack rejects HS256-signed service tokens. Trigger populates profiles.
  const pool = pgPool()
  await pool.query(
    `insert into auth.users
       (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values
       ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        $2, now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        now(), now())`,
    [userId, mail]
  )

  // Ensure profiles row exists (the trigger should handle it, but upsert
  // defensively in case test DB lacks the trigger).
  await admin
    .from('profiles')
    .upsert({ id: userId, email: mail }, { onConflict: 'id' })

  return {
    userId,
    email: mail,
    jwt: signUserJwt(userId, mail),
  }
}

/**
 * Returns a Supabase client authenticated as the given user JWT. All queries
 * executed through this client are subject to that user's RLS policies.
 */
export function clientAs(jwt: string): SupabaseClient {
  return createClient(
    requireEnv('SUPABASE_TEST_URL'),
    requireEnv('SUPABASE_TEST_ANON_KEY'),
    {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )
}

/**
 * Removes all data for the given user across user-scoped tables. Uses
 * service-role to bypass RLS. Safe to call in afterEach hooks.
 */
export async function truncateUserData(userId: string): Promise<void> {
  const admin = serviceRoleClient()
  // Delete in FK-safe order. Sites cascade to pages/embeddings/leads/conversations.
  await admin.from('leads').delete().eq('user_id', userId)
  await admin.from('conversations').delete().eq('user_id', userId)
  await admin.from('sites').delete().eq('user_id', userId)
  await admin.auth.admin.deleteUser(userId).catch(() => {
    /* idempotent */
  })
}
