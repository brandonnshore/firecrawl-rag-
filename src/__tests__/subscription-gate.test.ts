/**
 * M2F5 subscription-gate — the checkSubscription(userId) function that
 * replaces the stub in src/lib/subscription.ts.
 *
 * Status / date combinations (VAL-BILLING-016..020):
 *   - trialing + trial_ends_at future      -> active
 *   - trialing + trial_ends_at past        -> inactive (trial_expired)
 *   - active + current_period_end future   -> active
 *   - active + null period_end (just-synced)-> active (benefit of the doubt)
 *   - past_due                             -> inactive (past_due)
 *   - canceled + period_end future         -> active (paid-through grace)
 *   - canceled + period_end past           -> inactive (canceled)
 *   - incomplete / incomplete_expired / unpaid / paused -> inactive
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: mockFrom,
  })),
}))

import { checkSubscription } from '@/lib/subscription'

function mockProfile(profile: {
  subscription_status: string
  trial_ends_at: string | null
  current_period_end: string | null
}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({ data: profile, error: null }),
          }),
        }),
      }
    }
    return {}
  })
}

const FUTURE_ISO = () => new Date(Date.now() + 7 * 86400_000).toISOString()
const PAST_ISO = () => new Date(Date.now() - 7 * 86400_000).toISOString()

describe('checkSubscription', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('VAL-BILLING-016: trialing + future trial_ends_at', () => {
    it('returns active', async () => {
      mockProfile({
        subscription_status: 'trialing',
        trial_ends_at: FUTURE_ISO(),
        current_period_end: null,
      })
      const r = await checkSubscription('u1')
      expect(r.active).toBe(true)
    })
  })

  describe('VAL-BILLING-020: trialing + expired trial_ends_at', () => {
    it('returns inactive with trial_expired reason', async () => {
      mockProfile({
        subscription_status: 'trialing',
        trial_ends_at: PAST_ISO(),
        current_period_end: null,
      })
      const r = await checkSubscription('u1')
      expect(r.active).toBe(false)
      expect(r.reason).toBe('trial_expired')
      expect(r.upgradeUrl).toBe('/dashboard/billing')
    })
  })

  describe('VAL-BILLING-017: active', () => {
    it('returns active when current_period_end in future', async () => {
      mockProfile({
        subscription_status: 'active',
        trial_ends_at: null,
        current_period_end: FUTURE_ISO(),
      })
      const r = await checkSubscription('u1')
      expect(r.active).toBe(true)
    })

    it('returns active even when current_period_end is null (just-synced)', async () => {
      mockProfile({
        subscription_status: 'active',
        trial_ends_at: null,
        current_period_end: null,
      })
      const r = await checkSubscription('u1')
      expect(r.active).toBe(true)
    })
  })

  describe('VAL-BILLING-018: past_due', () => {
    it('returns inactive with past_due reason', async () => {
      mockProfile({
        subscription_status: 'past_due',
        trial_ends_at: null,
        current_period_end: FUTURE_ISO(),
      })
      const r = await checkSubscription('u1')
      expect(r.active).toBe(false)
      expect(r.reason).toBe('past_due')
      expect(r.upgradeUrl).toBe('/dashboard/billing')
    })
  })

  describe('VAL-BILLING-019: canceled', () => {
    it('returns active when current_period_end still in future (paid-through grace)', async () => {
      mockProfile({
        subscription_status: 'canceled',
        trial_ends_at: null,
        current_period_end: FUTURE_ISO(),
      })
      const r = await checkSubscription('u1')
      expect(r.active).toBe(true)
    })

    it('returns inactive when current_period_end past', async () => {
      mockProfile({
        subscription_status: 'canceled',
        trial_ends_at: null,
        current_period_end: PAST_ISO(),
      })
      const r = await checkSubscription('u1')
      expect(r.active).toBe(false)
      expect(r.reason).toBe('canceled')
    })

    it('returns inactive when current_period_end null', async () => {
      mockProfile({
        subscription_status: 'canceled',
        trial_ends_at: null,
        current_period_end: null,
      })
      const r = await checkSubscription('u1')
      expect(r.active).toBe(false)
    })
  })

  describe('incomplete / incomplete_expired / unpaid / paused', () => {
    it.each(['incomplete', 'incomplete_expired', 'unpaid', 'paused'])(
      'returns inactive for %s',
      async (status) => {
        mockProfile({
          subscription_status: status,
          trial_ends_at: FUTURE_ISO(),
          current_period_end: FUTURE_ISO(),
        })
        const r = await checkSubscription('u1')
        expect(r.active).toBe(false)
        expect(r.upgradeUrl).toBe('/dashboard/billing')
      }
    )
  })

  describe('profile lookup failure', () => {
    it('returns inactive when profile missing', async () => {
      mockFrom.mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' },
            }),
          }),
        }),
      }))
      const r = await checkSubscription('u1')
      expect(r.active).toBe(false)
    })
  })
})
