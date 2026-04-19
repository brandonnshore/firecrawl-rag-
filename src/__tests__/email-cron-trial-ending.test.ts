import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// M8F4 — the trial-ending cron. Tests the auth gate, the query window,
// iteration, idempotency-duplicate reporting, and error surfacing.

const sendTrialEndingMock = vi.fn()

vi.mock('@/lib/email/transactional', () => ({
  sendTrialEndingEmail: (...args: unknown[]) => sendTrialEndingMock(...args),
}))

const gteFn = vi.fn()
const ltFn = vi.fn()
const eqFn = vi.fn()
const selectFn = vi.fn()

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table ${table}`)
      return { select: selectFn }
    },
  }),
}))

import { GET } from '@/app/api/cron/trial-ending/route'

function buildChain(result: { data: unknown; error: unknown }) {
  ltFn.mockResolvedValue(result)
  gteFn.mockReturnValue({ lt: ltFn })
  eqFn.mockReturnValue({ gte: gteFn })
  selectFn.mockReturnValue({ eq: eqFn })
}

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/trial-ending', { headers })
}

describe('GET /api/cron/trial-ending (M8F4 / VAL-HARD-007)', () => {
  const OLD_SECRET = process.env.CRON_SECRET

  beforeEach(() => {
    sendTrialEndingMock.mockReset()
    selectFn.mockReset()
    eqFn.mockReset()
    gteFn.mockReset()
    ltFn.mockReset()
    delete process.env.CRON_SECRET
  })

  afterEach(() => {
    if (OLD_SECRET) process.env.CRON_SECRET = OLD_SECRET
    else delete process.env.CRON_SECRET
  })

  it('rejects unauthorized requests when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 'shh'
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('allows access with a valid bearer token', async () => {
    process.env.CRON_SECRET = 'shh'
    buildChain({ data: [], error: null })
    const res = await GET(req({ authorization: 'Bearer shh' }))
    expect(res.status).toBe(200)
  })

  it('queries profiles in the trialing window (between +3d and +4d)', async () => {
    buildChain({ data: [], error: null })
    await GET(req())
    expect(eqFn).toHaveBeenCalledWith('subscription_status', 'trialing')
    expect(gteFn).toHaveBeenCalledOnce()
    expect(ltFn).toHaveBeenCalledOnce()
    const gteArgs = gteFn.mock.calls[0] as [string, string]
    const ltArgs = ltFn.mock.calls[0] as [string, string]
    expect(gteArgs[0]).toBe('trial_ends_at')
    expect(ltArgs[0]).toBe('trial_ends_at')
    // 3d window exactly: from+24h === to
    const fromMs = Date.parse(gteArgs[1])
    const toMs = Date.parse(ltArgs[1])
    expect(toMs - fromMs).toBe(24 * 3_600_000)
  })

  it('dispatches one email per candidate and tallies outcomes', async () => {
    buildChain({
      data: [
        { id: 'u1', email: 'a@x.com', trial_ends_at: '2026-04-22T00:00:00Z' },
        { id: 'u2', email: 'b@x.com', trial_ends_at: '2026-04-22T00:00:00Z' },
        { id: 'u3', email: 'c@x.com', trial_ends_at: '2026-04-22T00:00:00Z' },
      ],
      error: null,
    })
    sendTrialEndingMock
      .mockResolvedValueOnce({ status: 'sent', id: 'e1' })
      .mockResolvedValueOnce({ status: 'duplicate' })
      .mockResolvedValueOnce({ status: 'error', error: 'smtp_down' })

    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      candidates: number
      sent: number
      duplicates: number
      errors: string[]
    }
    expect(body).toEqual({
      candidates: 3,
      sent: 1,
      duplicates: 1,
      errors: ['smtp_down'],
    })
    expect(sendTrialEndingMock).toHaveBeenCalledTimes(3)
  })

  it('re-running on the same day sees duplicates (ledger idempotency)', async () => {
    buildChain({
      data: [
        { id: 'u1', email: 'a@x.com', trial_ends_at: '2026-04-22T00:00:00Z' },
      ],
      error: null,
    })
    sendTrialEndingMock.mockResolvedValue({ status: 'duplicate' })
    const res = await GET(req())
    const body = (await res.json()) as { sent: number; duplicates: number }
    expect(body.sent).toBe(0)
    expect(body.duplicates).toBe(1)
  })
})
