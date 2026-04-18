import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}))

// In-memory rotation rate limit is isolated from the chat/leads limiter;
// reset between tests via the exported helper.
import {
  _resetRotationRateLimit,
} from '@/lib/sites/rotation-rate-limit'
import { POST } from '@/app/api/sites/rotate-key/route'

function makeRequest(): Request {
  return new Request('http://localhost:3000/api/sites/rotate-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
}

function authedSupabase() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  const updateSingleMock = vi.fn().mockResolvedValue({
    data: { id: 'site-1', site_key: 'new-key-hex' },
    error: null,
  })
  const updateSelectMock = vi.fn().mockReturnValue({ single: updateSingleMock })
  const updateEqMock = vi.fn().mockReturnValue({ select: updateSelectMock })
  const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'sites') return { update: updateMock }
    return {}
  })

  return { updateMock, updateEqMock, updateSelectMock, updateSingleMock }
}

describe('POST /api/sites/rotate-key', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetRotationRateLimit()
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await POST(makeRequest())
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })

  it('returns 200 with a newly rotated site_key for an authenticated user', async () => {
    authedSupabase()
    const response = await POST(makeRequest())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.site_key).toBe('new-key-hex')
  })

  it('calls sites.update with a fresh 32-char hex site_key scoped to the caller', async () => {
    const { updateMock, updateEqMock } = authedSupabase()
    await POST(makeRequest())

    expect(updateMock).toHaveBeenCalledTimes(1)
    const payload = updateMock.mock.calls[0][0] as { site_key: string }
    expect(payload.site_key).toMatch(/^[a-f0-9]{32}$/)
    expect(updateEqMock).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns 404 when the user has no site', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    const updateSingleMock = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    })
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single: updateSingleMock }),
        }),
      }),
    })

    const response = await POST(makeRequest())
    expect(response.status).toBe(404)
  })

  it('rate-limits to 5 rotations per user per hour (6th returns 429)', async () => {
    authedSupabase()
    for (let i = 0; i < 5; i++) {
      const r = await POST(makeRequest())
      expect(r.status).toBe(200)
    }
    const sixth = await POST(makeRequest())
    expect(sixth.status).toBe(429)
    expect(sixth.headers.get('Retry-After')).toBeDefined()
  })

  it('rate limit is scoped per-user (user-2 not blocked by user-1 exhaustion)', async () => {
    authedSupabase()
    for (let i = 0; i < 5; i++) {
      await POST(makeRequest())
    }
    // Switch user
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null })
    const response = await POST(makeRequest())
    expect(response.status).toBe(200)
  })
})
