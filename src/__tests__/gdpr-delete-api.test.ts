import { describe, it, expect, vi, beforeEach } from 'vitest'

// M8F5 account-deletion-gdpr — unit-level tests for DELETE /api/account:
//   401 when not authenticated, 400 when email doesn't match,
//   200 when caller's email matches, session signOut called on success.

const mockGetUser = vi.fn()
const mockSignOut = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser, signOut: mockSignOut },
  })),
}))

const mockDelete = vi.fn()
vi.mock('@/lib/account/delete', () => ({
  deleteUserAccount: (...args: unknown[]) => mockDelete(...args),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ __admin: true })),
}))

vi.mock('@/lib/stripe/client', () => ({
  stripeClient: vi.fn(() => ({
    subscriptions: {
      cancel: vi.fn().mockResolvedValue({}),
    },
  })),
}))

import { DELETE } from '@/app/api/account/route'

function req(body: unknown): Request {
  return new Request('http://localhost/api/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('DELETE /api/account', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockSignOut.mockReset()
    mockDelete.mockReset()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await DELETE(req({ email: 'x@y.com' }))
    expect(res.status).toBe(401)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 400 when body is invalid JSON', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@x.com' } },
    })
    const bad = new Request('http://localhost/api/account', {
      method: 'DELETE',
      body: 'not json',
    })
    const res = await DELETE(bad)
    expect(res.status).toBe(400)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('returns 400 email_mismatch when typed email differs from auth email', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'alice@x.com' } },
    })
    const res = await DELETE(req({ email: 'bob@x.com' }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('email_mismatch')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('accepts case-insensitive matches (VAL-GDPR-002)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'Alice@X.com' } },
    })
    mockDelete.mockResolvedValue({
      stripe: 'none',
      storage: 'ok',
      authUser: 'deleted',
      storageFilesDeleted: 0,
    })
    const res = await DELETE(req({ email: 'alice@x.com ' }))
    expect(res.status).toBe(200)
    expect(mockDelete).toHaveBeenCalledOnce()
  })

  it('runs deleteUserAccount and signs out when email matches', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'alice@x.com' } },
    })
    mockDelete.mockResolvedValue({
      stripe: 'canceled',
      storage: 'ok',
      authUser: 'deleted',
      storageFilesDeleted: 3,
    })
    mockSignOut.mockResolvedValue(undefined)

    const res = await DELETE(req({ email: 'alice@x.com' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      log: { authUser: string; storageFilesDeleted: number }
    }
    expect(body.ok).toBe(true)
    expect(body.log.authUser).toBe('deleted')
    expect(body.log.storageFilesDeleted).toBe(3)
    expect(mockSignOut).toHaveBeenCalledOnce()

    // deleteUserAccount receives an admin + userId + cancelStripe callback.
    const call = mockDelete.mock.calls[0][0] as {
      userId: string
      cancelStripeSubscription?: (id: string) => Promise<void>
    }
    expect(call.userId).toBe('u1')
    expect(typeof call.cancelStripeSubscription).toBe('function')
  })

  it('returns 500 when deletion fails (authUser !== deleted)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@x.com' } },
    })
    mockDelete.mockResolvedValue({
      stripe: 'none',
      storage: 'ok',
      authUser: 'error',
      authUserError: 'boom',
    })
    const res = await DELETE(req({ email: 'a@x.com' }))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('delete_failed')
  })
})
