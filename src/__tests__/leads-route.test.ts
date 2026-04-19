import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn()
const mockUpdateRun = vi.fn()
// .update(row).eq('site_id', ...).eq('email', ...) — two chained .eq calls.
const mockUpdateEq2 = vi.fn(() => mockUpdateRun())
const mockUpdateEq1 = vi.fn(() => ({ eq: mockUpdateEq2 }))
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq1 }))
const mockMaybeSingle = vi.fn()
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn((table: string) => {
  if (table === 'sites') return { select: mockSelect }
  if (table === 'leads') {
    return { insert: mockInsert, update: mockUpdate }
  }
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
    mockInsert.mockReset()
    mockUpdate.mockClear()
    mockUpdateEq1.mockClear()
    mockUpdateEq2.mockClear()
    mockUpdateRun.mockReset()
    mockInsert.mockResolvedValue({ error: null })
    mockUpdateRun.mockResolvedValue({ error: null })
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
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns 400 when site_key missing', async () => {
    const res = await POST(req({ email: 'x@y.com' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when neither email nor phone is provided', async () => {
    const res = await POST(req({ site_key: 'sk' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('email_or_phone_required')
  })

  it('returns 400 on invalid email format', async () => {
    const res = await POST(req({ site_key: 'sk', email: 'notanemail' }))
    expect(res.status).toBe(400)
  })

  it('400 on invalid source value', async () => {
    const res = await POST(
      req({ site_key: 'sk', email: 'x@y.com', source: 'bogus' })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_source')
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

  it('returns 201 and inserts on valid request', async () => {
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
    expect(mockInsert).toHaveBeenCalledOnce()
    const arg = mockInsert.mock.calls[0][0] as {
      email: string
      name: string
      site_id: string
    }
    expect(arg.email).toBe('foo@bar.com')
    expect(arg.name).toBe('Alice')
    expect(arg.site_id).toBe('site-1')
  })

  it('falls back to UPDATE when insert returns 23505 (partial unique index conflict)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'site-1' } })
    mockInsert.mockResolvedValueOnce({
      error: { code: '23505', message: 'duplicate key' },
    })
    const res = await POST(req({ site_key: 'sk_ok', email: 'dup@y.com' }))
    expect(res.status).toBe(201)
    expect(mockUpdate).toHaveBeenCalledOnce()
    expect(mockUpdateEq1).toHaveBeenCalledWith('site_id', 'site-1')
    expect(mockUpdateEq2).toHaveBeenCalledWith('email', 'dup@y.com')
  })

  it('returns 500 when insert fails with a non-conflict error', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'site-1' } })
    mockInsert.mockResolvedValueOnce({ error: { message: 'db down' } })
    const res = await POST(req({ site_key: 'sk_ok', email: 'x@y.com' }))
    expect(res.status).toBe(500)
  })

  it('returns 500 when the fallback UPDATE fails after a 23505', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'site-1' } })
    mockInsert.mockResolvedValueOnce({
      error: { code: '23505', message: 'duplicate key' },
    })
    mockUpdateRun.mockResolvedValueOnce({ error: { message: 'update failed' } })
    const res = await POST(req({ site_key: 'sk_ok', email: 'x@y.com' }))
    expect(res.status).toBe(500)
  })

  it('VAL-ESCAL-011: source=escalation + email inserts with source flag', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'site-1' } })
    const res = await POST(
      req({
        site_key: 'sk_ok',
        email: 'v@acme.test',
        source: 'escalation',
      })
    )
    expect(res.status).toBe(201)
    expect(mockInsert).toHaveBeenCalledOnce()
    const row = mockInsert.mock.calls[0][0] as {
      email: string
      source: string
    }
    expect(row.email).toBe('v@acme.test')
    expect(row.source).toBe('escalation')
  })

  it('VAL-ESCAL-012: phone-only lead inserts with email=null', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'site-1' } })
    const res = await POST(
      req({
        site_key: 'sk_ok',
        phone: '+15550123',
        source: 'escalation',
      })
    )
    expect(res.status).toBe(201)
    expect(mockInsert).toHaveBeenCalledOnce()
    const row = mockInsert.mock.calls[0][0] as {
      email: string | null
      phone: string
      source: string
    }
    expect(row.email).toBeNull()
    expect(row.phone).toBe('+15550123')
    expect(row.source).toBe('escalation')
  })

  it('VAL-ESCAL-013: show_form payload preserves extra_fields + promoted name', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'site-1' } })
    const res = await POST(
      req({
        site_key: 'sk_ok',
        email: 'v@acme.test',
        name: 'Alice',
        extra_fields: { message: 'Interested in Pro' },
        source: 'escalation',
      })
    )
    expect(res.status).toBe(201)
    const row = mockInsert.mock.calls[0][0] as {
      extra_fields: Record<string, unknown>
      name: string
    }
    expect(row.name).toBe('Alice')
    expect(row.extra_fields).toEqual({ message: 'Interested in Pro' })
  })
})

describe('OPTIONS /api/leads', () => {
  it('returns 204 with CORS', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
