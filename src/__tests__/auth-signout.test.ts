import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSignOut = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { signOut: mockSignOut },
  })),
}))

import { POST } from '@/app/api/auth/signout/route'

describe('POST /api/auth/signout (VAL-AUTH-009)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls supabase.auth.signOut()', async () => {
    mockSignOut.mockResolvedValue({ error: null })
    const request = new Request('http://localhost:3000/api/auth/signout', {
      method: 'POST',
    })
    await POST(request)
    expect(mockSignOut).toHaveBeenCalledOnce()
  })

  it('redirects to /login with 302', async () => {
    mockSignOut.mockResolvedValue({ error: null })
    const request = new Request('http://localhost:3000/api/auth/signout', {
      method: 'POST',
    })
    const response = await POST(request)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://localhost:3000/login')
  })
})
