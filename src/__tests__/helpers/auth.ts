/**
 * Auth test helpers — produce a valid session without round-tripping a magic
 * link or hitting the OTP rate limit (which blocked foundation round 1).
 *
 * Rather than `supabase.auth.admin.generateLink` (the local stack's auth admin
 * API rejects HS256 service tokens), we reuse the pg-direct user creation from
 * helpers/supabase.ts and mint an HS256-signed access/refresh token pair that
 * PostgREST and middleware accept.
 */

import jwt from 'jsonwebtoken'
import { createTestUser, type TestUser } from './supabase'

export interface TestSession {
  user: TestUser
  accessToken: string
  refreshToken: string
}

function supabaseJwtSecret(): string {
  return (
    process.env.SUPABASE_TEST_JWT_SECRET ||
    'super-secret-jwt-token-with-at-least-32-characters-long'
  )
}

/**
 * Creates a fresh test user and returns a ready-to-use access/refresh token
 * pair. Callers set the session on a Supabase JS client via
 * `supabase.auth.setSession({ access_token, refresh_token })` and are then
 * treated as that user by PostgREST + Next.js middleware.
 */
export async function createTestSessionViaAdmin(
  email?: string
): Promise<TestSession> {
  const user = await createTestUser(email)
  const accessToken = user.jwt
  const refreshToken = jwt.sign(
    {
      sub: user.userId,
      email: user.email,
      iat: Math.floor(Date.now() / 1000),
    },
    supabaseJwtSecret(),
    { algorithm: 'HS256' }
  )
  return { user, accessToken, refreshToken }
}
