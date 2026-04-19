import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// M8F4 transactional-email — proves the four one-shot emails fire
// correctly and the sent_emails ledger gates duplicate sends. Covers
// VAL-HARD-006, VAL-HARD-007, VAL-HARD-008, VAL-HARD-009.

type SendResult = { ok: boolean; id?: string; error?: string; skipped?: string }
const sendEmailMock = vi.fn<
  (...args: unknown[]) => Promise<SendResult>
>()

vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}))

import {
  sendOnce,
  sendWelcomeEmail,
  sendTrialEndingEmail,
  sendQuotaWarningEmail,
  sendPaymentFailedEmail,
} from '@/lib/email/transactional'
import {
  renderWelcome,
  renderTrialEnding,
  renderQuotaWarning,
  renderPaymentFailed,
} from '@/lib/email/templates'
import type { SupabaseClient } from '@supabase/supabase-js'

interface InsertCall {
  user_id: string
  template: string
  period: string
}

function mockAdmin(opts: {
  insertErrorCode?: string
  insertErrorMessage?: string
} = {}) {
  const inserts: InsertCall[] = []
  const insert = vi.fn((row: InsertCall) => {
    inserts.push(row)
    if (opts.insertErrorCode) {
      return Promise.resolve({
        error: {
          code: opts.insertErrorCode,
          message: opts.insertErrorMessage ?? 'mock_error',
        },
      })
    }
    return Promise.resolve({ error: null })
  })
  const from = vi.fn((table: string) => {
    if (table === 'sent_emails') return { insert }
    throw new Error(`unexpected table ${table}`)
  })
  return {
    admin: { from } as unknown as SupabaseClient,
    inserts,
  }
}

describe('sendOnce (M8F4 idempotency core)', () => {
  beforeEach(() => {
    sendEmailMock.mockReset()
    sendEmailMock.mockResolvedValue({ ok: true, id: 'resend-1' })
  })

  it('inserts the ledger row and sends the email on first call', async () => {
    const { admin, inserts } = mockAdmin()
    const res = await sendOnce({
      admin,
      userId: 'user-A',
      template: 'welcome',
      period: 'initial',
      to: 'a@example.com',
      render: () => ({ subject: 's', html: 'h', text: 't' }),
    })
    expect(res).toEqual({ status: 'sent', id: 'resend-1' })
    expect(inserts).toEqual([
      { user_id: 'user-A', template: 'welcome', period: 'initial' },
    ])
    expect(sendEmailMock).toHaveBeenCalledOnce()
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: 'a@example.com',
      subject: 's',
      html: 'h',
      text: 't',
    })
  })

  it('returns duplicate and does NOT send when the ledger already has the row (23505)', async () => {
    const { admin } = mockAdmin({ insertErrorCode: '23505' })
    const render = vi.fn(() => ({ subject: 's', html: 'h', text: 't' }))
    const res = await sendOnce({
      admin,
      userId: 'user-B',
      template: 'quota_warning',
      period: '2026-04-01',
      to: 'b@example.com',
      render,
    })
    expect(res).toEqual({ status: 'duplicate' })
    expect(render).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('surfaces non-conflict insert errors', async () => {
    const { admin } = mockAdmin({
      insertErrorCode: '23502',
      insertErrorMessage: 'not_null_violation',
    })
    const res = await sendOnce({
      admin,
      userId: 'user-C',
      template: 'welcome',
      period: 'initial',
      to: 'c@example.com',
      render: () => ({ subject: 's', html: 'h', text: 't' }),
    })
    expect(res).toEqual({ status: 'error', error: 'not_null_violation' })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('propagates Resend transport errors without deleting the ledger row', async () => {
    const { admin } = mockAdmin()
    sendEmailMock.mockResolvedValue({ ok: false, error: 'rate_limited' })
    const res = await sendOnce({
      admin,
      userId: 'user-D',
      template: 'welcome',
      period: 'initial',
      to: 'd@example.com',
      render: () => ({ subject: 's', html: 'h', text: 't' }),
    })
    expect(res).toEqual({ status: 'error', error: 'rate_limited' })
  })
})

describe('template wrappers', () => {
  beforeEach(() => {
    sendEmailMock.mockReset()
    sendEmailMock.mockResolvedValue({ ok: true, id: 'e1' })
  })

  it('sendWelcomeEmail: template=welcome, period=initial (VAL-HARD-006)', async () => {
    const { admin, inserts } = mockAdmin()
    const res = await sendWelcomeEmail(admin, 'user-1', {
      email: 'alice@example.com',
    })
    expect(res.status).toBe('sent')
    expect(inserts[0]).toEqual({
      user_id: 'user-1',
      template: 'welcome',
      period: 'initial',
    })
    const call = sendEmailMock.mock.calls[0][0] as {
      to: string
      subject: string
      html: string
    }
    expect(call.to).toBe('alice@example.com')
    expect(call.subject.toLowerCase()).toContain('welcome')
    expect(call.html).toContain('alice@example.com')
  })

  it('sendTrialEndingEmail: period = YYYY-MM-DD of trial end (VAL-HARD-007)', async () => {
    const { admin, inserts } = mockAdmin()
    const res = await sendTrialEndingEmail(admin, 'user-2', {
      email: 'bob@example.com',
      trialEndsAt: '2026-04-22T14:00:00Z',
    })
    expect(res.status).toBe('sent')
    expect(inserts[0]).toEqual({
      user_id: 'user-2',
      template: 'trial_ending',
      period: '2026-04-22',
    })
  })

  it('sendTrialEndingEmail: second fire on same day is a duplicate (VAL-HARD-007 idempotency)', async () => {
    const { admin } = mockAdmin({ insertErrorCode: '23505' })
    const res = await sendTrialEndingEmail(admin, 'user-2', {
      email: 'bob@example.com',
      trialEndsAt: '2026-04-22T14:00:00Z',
    })
    expect(res.status).toBe('duplicate')
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('sendQuotaWarningEmail: period = billing period_start (VAL-HARD-008)', async () => {
    const { admin, inserts } = mockAdmin()
    const res = await sendQuotaWarningEmail(
      admin,
      'user-3',
      '2026-04-01T00:00:00Z',
      { email: 'carol@example.com', used: 1600, limit: 2000 }
    )
    expect(res.status).toBe('sent')
    expect(inserts[0]).toEqual({
      user_id: 'user-3',
      template: 'quota_warning',
      period: '2026-04-01T00:00:00Z',
    })
    const call = sendEmailMock.mock.calls[0][0] as { subject: string; html: string }
    expect(call.subject).toMatch(/80%/)
    expect(call.html).toContain('1,600')
  })

  it('sendPaymentFailedEmail: period = invoice_id so one email per invoice (VAL-HARD-009)', async () => {
    const { admin, inserts } = mockAdmin()
    const res = await sendPaymentFailedEmail(
      admin,
      'user-4',
      'in_1NABC',
      { email: 'dave@example.com', amountCents: 2499, currency: 'usd' }
    )
    expect(res.status).toBe('sent')
    expect(inserts[0]).toEqual({
      user_id: 'user-4',
      template: 'payment_failed',
      period: 'in_1NABC',
    })
    const call = sendEmailMock.mock.calls[0][0] as { html: string; text: string }
    expect(call.html).toContain('24.99 USD')
    expect(call.text).toContain('24.99 USD')
  })
})

describe('template rendering (shape)', () => {
  it('renderWelcome interpolates the email', () => {
    const t = renderWelcome({ email: 'alice@x.com' })
    expect(t.subject.length).toBeGreaterThan(0)
    expect(t.html).toContain('alice@x.com')
    expect(t.text).toContain('alice@x.com')
  })

  it('renderTrialEnding includes the trial-end date', () => {
    const t = renderTrialEnding({
      email: 'b@x.com',
      trialEndsAt: '2026-04-22T00:00:00Z',
    })
    expect(t.html).toContain('2026-04-22')
    expect(t.text).toContain('2026-04-22')
  })

  it('renderQuotaWarning computes percentage rounding', () => {
    const t = renderQuotaWarning({ email: 'c@x.com', used: 1600, limit: 2000 })
    expect(t.subject).toContain('80%')
    expect(t.html).toContain('80%')
  })

  it('renderPaymentFailed formats the currency amount', () => {
    const t = renderPaymentFailed({
      email: 'd@x.com',
      amountCents: 9900,
      currency: 'usd',
    })
    expect(t.html).toContain('99.00 USD')
  })
})

describe('sendEmail (runtime guards)', () => {
  const OLD_KEY = process.env.RESEND_API_KEY

  beforeEach(() => {
    delete process.env.RESEND_API_KEY
  })

  afterEach(() => {
    if (OLD_KEY) process.env.RESEND_API_KEY = OLD_KEY
    else delete process.env.RESEND_API_KEY
  })

  it('no-ops when RESEND_API_KEY is absent (dev + CI safe)', async () => {
    const { sendEmail } = await vi.importActual<
      typeof import('@/lib/email/send')
    >('@/lib/email/send')
    const res = await sendEmail({
      to: 'x@y.com',
      subject: 's',
      html: 'h',
      text: 't',
    })
    expect(res).toEqual({ ok: true, skipped: 'no_key' })
  })

  it('rejects when recipient is empty', async () => {
    process.env.RESEND_API_KEY = 're' + '_' + 'test_' + 'x'.repeat(12)
    const { sendEmail } = await vi.importActual<
      typeof import('@/lib/email/send')
    >('@/lib/email/send')
    const res = await sendEmail({
      to: '',
      subject: 's',
      html: 'h',
      text: 't',
    })
    expect(res.ok).toBe(false)
    expect(res.skipped).toBe('no_recipient')
  })
})
