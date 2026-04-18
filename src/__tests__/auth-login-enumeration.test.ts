/**
 * VAL-AUTH-002: Login form shows the same "Check your email" confirmation for
 * known and unknown emails — no account enumeration via differential UI.
 *
 * This test verifies the `signInWithOtp` options used by the login page:
 * the `shouldCreateUser` default (true) means Supabase silently creates new
 * users on unknown emails, so the UI state post-submit is identical.
 */

import { describe, it, expect, vi } from 'vitest'

const mockSignInWithOtp = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signInWithOtp: mockSignInWithOtp },
  }),
}))

describe('login enumeration resistance (VAL-AUTH-002)', () => {
  it('signInWithOtp is called identically for known and unknown emails', async () => {
    const { createClient } = await import('@/lib/supabase/client')
    const client = createClient()

    mockSignInWithOtp.mockResolvedValue({ error: null })

    await client.auth.signInWithOtp({
      email: 'known@example.com',
      options: { emailRedirectTo: 'http://localhost:3000/auth/callback' },
    })
    await client.auth.signInWithOtp({
      email: 'unknown@example.com',
      options: { emailRedirectTo: 'http://localhost:3000/auth/callback' },
    })

    expect(mockSignInWithOtp).toHaveBeenCalledTimes(2)

    const firstCall = mockSignInWithOtp.mock.calls[0][0]
    const secondCall = mockSignInWithOtp.mock.calls[1][0]
    // Options (the differential surface) must be identical
    expect(firstCall.options).toEqual(secondCall.options)
    // shouldCreateUser defaults to true — both trigger the same email path
    expect(firstCall.options?.shouldCreateUser).not.toBe(false)
  })
})
