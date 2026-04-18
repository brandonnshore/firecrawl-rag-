import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExchangeCodeForSession = vi.fn()
const mockVerifyOtp = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
      verifyOtp: mockVerifyOtp,
    },
  })),
}))

import { GET } from '@/app/auth/callback/route'

function getRedirect(response: Response): string | null {
  return response.headers.get('location')
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to /dashboard after successful ?code= exchange', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    const request = new Request('http://localhost:3000/auth/callback?code=abc123')
    const response = await GET(request)

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('abc123')
    expect(response.status).toBe(307)
    expect(getRedirect(response)).toBe('http://localhost:3000/dashboard')
  })

  it('redirects to the sanitized ?next= path after successful exchange', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    const request = new Request(
      'http://localhost:3000/auth/callback?code=abc123&next=/dashboard/setup'
    )
    const response = await GET(request)

    expect(getRedirect(response)).toBe('http://localhost:3000/dashboard/setup')
  })

  it('rejects external ?next= values (VAL-AUTH-005)', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    const request = new Request(
      'http://localhost:3000/auth/callback?code=abc123&next=https://evil.example.com'
    )
    const response = await GET(request)

    expect(getRedirect(response)).toBe('http://localhost:3000/dashboard')
  })

  it('rejects protocol-relative ?next=', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })
    const request = new Request(
      'http://localhost:3000/auth/callback?code=abc123&next=//evil.com'
    )
    const response = await GET(request)

    expect(getRedirect(response)).toBe('http://localhost:3000/dashboard')
  })

  it('accepts ?token_hash=&type= magiclink form and verifies OTP', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { session: {} }, error: null })
    const request = new Request(
      'http://localhost:3000/auth/callback?token_hash=hashxyz&type=magiclink'
    )
    const response = await GET(request)

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: 'hashxyz',
      type: 'magiclink',
    })
    expect(getRedirect(response)).toBe('http://localhost:3000/dashboard')
  })

  it('accepts ?token_hash=&type=email form', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { session: {} }, error: null })
    const request = new Request(
      'http://localhost:3000/auth/callback?token_hash=hashxyz&type=email'
    )
    const response = await GET(request)

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      token_hash: 'hashxyz',
      type: 'email',
    })
    expect(getRedirect(response)).toBe('http://localhost:3000/dashboard')
  })

  it('redirects to /login?error= when ?code= exchange fails', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: 'expired' },
    })
    const request = new Request('http://localhost:3000/auth/callback?code=bad')
    const response = await GET(request)

    const loc = getRedirect(response)
    expect(loc).toMatch(/\/login\?error=auth_callback_error/)
  })

  it('redirects to /login?error= when ?token_hash= verifyOtp fails (VAL-AUTH-012: single-use)', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: null,
      error: { message: 'Token has expired or is invalid' },
    })
    const request = new Request(
      'http://localhost:3000/auth/callback?token_hash=replay&type=magiclink'
    )
    const response = await GET(request)

    expect(getRedirect(response)).toMatch(/\/login\?error=auth_callback_error/)
  })

  it('redirects to /login?error= when no auth params present', async () => {
    const request = new Request('http://localhost:3000/auth/callback')
    const response = await GET(request)

    expect(getRedirect(response)).toMatch(/\/login\?error=auth_callback_error/)
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })
})
