import { test as base, expect, type Page } from '@playwright/test'
import { Pool } from 'pg'

/**
 * Playwright auth fixture — produces an authenticated browser context
 * without round-tripping the real Supabase OTP magic-link mail flow.
 *
 * Strategy:
 *   1. Call POST /auth/v1/signup with a random email + password. That
 *      creates a real auth.users row AND returns a full ES256-signed
 *      session the local Auth API will trust on later /auth/v1/user
 *      calls made by middleware.
 *   2. Package the returned session object as a Supabase SSR cookie
 *      (base64-<base64url(JSON.stringify(session))>) and write it to
 *      page.context() before navigation.
 *
 * After the fixture yields, `authedPage.goto('/dashboard')` lands on
 * /dashboard and `supabase.auth.getUser()` on the server returns the
 * test user. pg access is retained so specs that want to cleanup or
 * seed tangential rows can still do so via the service role.
 */

export interface SeededUser {
  userId: string
  email: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  rawSession: RawSession
}

interface RawSession {
  access_token: string
  token_type: string
  expires_in: number
  expires_at: number
  refresh_token: string
  user: Record<string, unknown>
}

const DEFAULT_BASE_URL = 'http://localhost:3000'
const DEFAULT_DB_URL =
  process.env.SUPABASE_TEST_DB_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_TEST_URL ||
  'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_TEST_ANON_KEY ||
  ''

let pool: Pool | null = null
export function pg(): Pool {
  if (!pool) pool = new Pool({ connectionString: DEFAULT_DB_URL, max: 2 })
  return pool
}

/**
 * Signs up a fresh user via the real Supabase Auth API and returns the
 * full session. Email is namespaced with a timestamp + random suffix so
 * reruns don't collide.
 */
export async function createSeededUser(
  emailPrefix = 'e2e'
): Promise<SeededUser> {
  const email = `${emailPrefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 7)}@rubycrawl.test`
  const password = 'E2eT3st_' + Math.random().toString(36).slice(2, 10)

  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    throw new Error(
      `signup failed (${res.status}): ${await res.text().catch(() => '')}`
    )
  }
  const body = (await res.json()) as RawSession & {
    user?: { id?: string }
  }
  if (!body.access_token || !body.user?.id) {
    throw new Error('signup response missing access_token or user.id')
  }
  return {
    userId: body.user.id,
    email,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_at,
    rawSession: body,
  }
}

function storageRefFromUrl(url: string): string {
  // supabase-js v2 derives its storage key from the host:
  //   http://127.0.0.1:54321 -> sb-127-auth-token
  //   https://xxx.supabase.co -> sb-xxx-auth-token
  return new URL(url).hostname.split('.')[0]
}

export const STORAGE_REF = storageRefFromUrl(SUPABASE_URL)
export const COOKIE_NAME = `sb-${STORAGE_REF}-auth-token`

function base64url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export function buildAuthCookieValue(user: SeededUser): string {
  return `base64-${base64url(JSON.stringify(user.rawSession))}`
}

export async function signInPage(
  page: Page,
  user: SeededUser,
  baseURL = DEFAULT_BASE_URL
): Promise<void> {
  const url = new URL(baseURL)
  await page.context().addCookies([
    {
      name: COOKIE_NAME,
      value: buildAuthCookieValue(user),
      domain: url.hostname,
      path: '/',
      httpOnly: false,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
      expires: user.expiresAt,
    },
  ])
}

interface AuthFixtures {
  seededUser: SeededUser
  authedPage: Page
}

export const test = base.extend<AuthFixtures>({
  seededUser: async ({}, yieldValue) => {
    const user = await createSeededUser()
    await yieldValue(user)
  },
  authedPage: async ({ page, seededUser, baseURL }, yieldValue) => {
    await signInPage(page, seededUser, baseURL ?? DEFAULT_BASE_URL)
    await yieldValue(page)
  },
})

export { expect }
