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

/**
 * Creates a verified test user via admin API and returns an access token.
 * Uses a random password so we can log in without hitting the OTP path.
 */
export async function createTestUser(email?: string): Promise<TestUser> {
  const admin = serviceRoleClient()
  const mail = email ?? `test-${crypto.randomUUID()}@rubycrawl.test`
  const password = `pw-${crypto.randomUUID()}`

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: mail,
    password,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    throw new Error(`createTestUser failed: ${createErr?.message ?? 'no user returned'}`)
  }

  // profiles row is typically created by a trigger; ensure it exists
  await admin
    .from('profiles')
    .upsert(
      { id: created.user.id, email: mail },
      { onConflict: 'id' }
    )

  // Exchange password for an access token using the anon client
  const anon = createClient(
    requireEnv('SUPABASE_TEST_URL'),
    requireEnv('SUPABASE_TEST_ANON_KEY')
  )
  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({
    email: mail,
    password,
  })
  if (signInErr || !session.session) {
    throw new Error(`signInWithPassword failed: ${signInErr?.message ?? 'no session'}`)
  }

  return {
    userId: created.user.id,
    email: mail,
    jwt: session.session.access_token,
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
