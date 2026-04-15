import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpsert = vi.fn()
const mockMaybeSingle = vi.fn()
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn((table: string) => {
  if (table === 'sites') return { select: mockSelect }
  if (table === 'leads') return { upsert: mockUpsert }
  return {}
})

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}))

vi.mock('@/lib/chat/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}))

import { POST, OPTIONS } from '@/app/api/leads/route'
import { checkRateLimit } from '@/lib/chat/rate-limit'

function req(body: unknown, ip = '1.2.3.4') {
  return new Request('http://localhost/api/leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/leads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(checkRateLimit as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      allowed: true,
    })
    mockMaybeSingle.mockReset()
    mockUpsert.mockReset()
    mockUpsert.mockResolvedValue({ error: null })
  })

  it('returns 400 on invalid JSON', async () => {
    const res = await POST(req('not json'))
    expect(res.status).toBe(400)
  })

  it('honeypot: returns 200 without insert when website field filled', async () => {
    const res = await POST(
      req({ site_key: 'sk', email: 'x@y.com', website: 'spam.com' })
    )
    expect(res.status).toBe(200)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('returns 400 when site_key missing', async () => {
    const res = await POST(req({ email: 'x@y.com' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when email missing', async () => {
    const res = await POST(req({ site_key: 'sk' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on invalid email format', async () => {
    const res = await POST(req({ site_key: 'sk', email: 'notanemail' }))
    expect(res.status).toBe(400)
  })

  it('returns 429 when rate limited', async () => {
    ;(checkRateLimit as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      allowed: false,
      retryAfterMs: 1000,
    })
    const res = await POST(req({ site_key: 'sk', email: 'x@y.com' }))
    expect(res.status).toBe(429)
  })

  it('returns 404 when site_key unknown', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null })
    const res = await POST(req({ site_key: 'sk_bad', email: 'x@y.com' }))
    expect(res.status).toBe(404)
  })

  it('returns 201 and upserts on valid request', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'site-1' } })
    const res = await POST(
      req({
        site_key: 'sk_ok',
        email: 'Foo@Bar.com',
        name: ' Alice ',
        message: 'hi',
        source_page: 'https://example.com/x',
      })
    )
    expect(res.status).toBe(201)
    expect(mockUpsert).toHaveBeenCalledOnce()
    const arg = mockUpsert.mock.calls[0][0] as {
      email: string
      name: string
      site_id: string
    }
    expect(arg.email).toBe('foo@bar.com')
    expect(arg.name).toBe('Alice')
    expect(arg.site_id).toBe('site-1')
  })

  it('returns 500 when upsert fails', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'site-1' } })
    mockUpsert.mockResolvedValueOnce({ error: { message: 'db down' } })
    const res = await POST(req({ site_key: 'sk_ok', email: 'x@y.com' }))
    expect(res.status).toBe(500)
  })
})

describe('OPTIONS /api/leads', () => {
  it('returns 204 with CORS', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
