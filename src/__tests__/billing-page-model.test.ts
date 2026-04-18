import { describe, it, expect } from 'vitest'
import {
  buildBillingViewModel,
  type Plan,
  type ProfileInput,
  type InvoiceSummary,
} from '@/lib/billing/page-model'

const PLANS: Plan[] = [
  {
    id: 'starter',
    display_name: 'Starter',
    price_cents: 2499,
    monthly_message_limit: 2000,
    monthly_crawl_page_limit: 500,
    supplementary_file_limit: 25,
    stripe_price_id: 'price_starter',
  },
  {
    id: 'pro',
    display_name: 'Pro',
    price_cents: 4999,
    monthly_message_limit: 7500,
    monthly_crawl_page_limit: 1500,
    supplementary_file_limit: 100,
    stripe_price_id: 'price_pro',
  },
  {
    id: 'scale',
    display_name: 'Scale',
    price_cents: 9900,
    monthly_message_limit: 25000,
    monthly_crawl_page_limit: 5000,
    supplementary_file_limit: 500,
    stripe_price_id: 'price_scale',
  },
]

const NOW = new Date('2026-05-01T00:00:00Z').getTime()
const FUTURE = new Date('2026-05-08T00:00:00Z').toISOString()
const PAST = new Date('2026-04-15T00:00:00Z').toISOString()

const EMPTY_INVOICES: InvoiceSummary[] = []

function profile(over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    plan_id: null,
    subscription_status: null,
    trial_ends_at: null,
    current_period_end: null,
    cancel_at_period_end: false,
    ...over,
  }
}

describe('buildBillingViewModel', () => {
  describe('state derivation', () => {
    it('no_subscription when subscription_status null', () => {
      const vm = buildBillingViewModel({
        profile: profile(),
        plans: PLANS,
        invoices: EMPTY_INVOICES,
        nowMs: NOW,
      })
      expect(vm.state).toBe('no_subscription')
      expect(vm.currentPlan).toBeNull()
      expect(vm.showUpgradeCta).toBe(true)
      expect(vm.showPortalCta).toBe(false)
    })

    it('trialing when status=trialing and trial_ends_at in future', () => {
      const vm = buildBillingViewModel({
        profile: profile({
          subscription_status: 'trialing',
          trial_ends_at: FUTURE,
        }),
        plans: PLANS,
        invoices: EMPTY_INVOICES,
        nowMs: NOW,
      })
      expect(vm.state).toBe('trialing')
      expect(vm.trialCountdownDays).toBe(7)
      expect(vm.showPortalCta).toBe(true)
    })

    it('other_inactive when trialing + trial expired', () => {
      const vm = buildBillingViewModel({
        profile: profile({
          subscription_status: 'trialing',
          trial_ends_at: PAST,
        }),
        plans: PLANS,
        invoices: EMPTY_INVOICES,
        nowMs: NOW,
      })
      expect(vm.state).toBe('other_inactive')
      expect(vm.trialCountdownDays).toBeNull()
    })

    it('active when status=active, nextInvoiceIso populated', () => {
      const vm = buildBillingViewModel({
        profile: profile({
          plan_id: 'pro',
          subscription_status: 'active',
          current_period_end: FUTURE,
        }),
        plans: PLANS,
        invoices: EMPTY_INVOICES,
        nowMs: NOW,
      })
      expect(vm.state).toBe('active')
      expect(vm.currentPlan?.id).toBe('pro')
      expect(vm.nextInvoiceIso).toBe(FUTURE)
      expect(vm.showPortalCta).toBe(true)
      expect(vm.showUpgradeCta).toBe(false)
    })

    it('past_due', () => {
      const vm = buildBillingViewModel({
        profile: profile({
          plan_id: 'starter',
          subscription_status: 'past_due',
          current_period_end: FUTURE,
        }),
        plans: PLANS,
        invoices: EMPTY_INVOICES,
        nowMs: NOW,
      })
      expect(vm.state).toBe('past_due')
      expect(vm.statusPill.tone).toBe('danger')
      expect(vm.showUpgradeCta).toBe(true)
      expect(vm.showPortalCta).toBe(true)
    })

    it('canceled_active when canceled but period still in future', () => {
      const vm = buildBillingViewModel({
        profile: profile({
          plan_id: 'pro',
          subscription_status: 'canceled',
          current_period_end: FUTURE,
        }),
        plans: PLANS,
        invoices: EMPTY_INVOICES,
        nowMs: NOW,
      })
      expect(vm.state).toBe('canceled_active')
      expect(vm.showUpgradeCta).toBe(false)
      expect(vm.showPortalCta).toBe(true)
    })

    it('canceled_expired when canceled and period past', () => {
      const vm = buildBillingViewModel({
        profile: profile({
          plan_id: 'pro',
          subscription_status: 'canceled',
          current_period_end: PAST,
        }),
        plans: PLANS,
        invoices: EMPTY_INVOICES,
        nowMs: NOW,
      })
      expect(vm.state).toBe('canceled_expired')
      expect(vm.showUpgradeCta).toBe(true)
    })
  })

  describe('status pill', () => {
    it('Active / success for plain active', () => {
      const vm = buildBillingViewModel({
        profile: profile({
          plan_id: 'starter',
          subscription_status: 'active',
          current_period_end: FUTURE,
        }),
        plans: PLANS,
        invoices: EMPTY_INVOICES,
        nowMs: NOW,
      })
      expect(vm.statusPill).toEqual({ label: 'Active', tone: 'success' })
    })

    it('Canceling warning pill for active + cancel_at_period_end', () => {
      const vm = buildBillingViewModel({
        profile: profile({
          plan_id: 'starter',
          subscription_status: 'active',
          current_period_end: FUTURE,
          cancel_at_period_end: true,
        }),
        plans: PLANS,
        invoices: EMPTY_INVOICES,
        nowMs: NOW,
      })
      expect(vm.statusPill.label).toBe('Canceling')
      expect(vm.statusPill.tone).toBe('warning')
    })
  })

  describe('invoices', () => {
    it('caps list at 12', () => {
      const many: InvoiceSummary[] = Array.from({ length: 20 }, (_, i) => ({
        id: `in_${i}`,
        number: `R-${i}`,
        amount_paid_cents: 2499,
        currency: 'usd',
        status: 'paid',
        created_sec: 1000 + i,
        pdf_url: null,
      }))
      const vm = buildBillingViewModel({
        profile: profile({
          plan_id: 'starter',
          subscription_status: 'active',
          current_period_end: FUTURE,
        }),
        plans: PLANS,
        invoices: many,
        nowMs: NOW,
      })
      expect(vm.invoices).toHaveLength(12)
      expect(vm.invoices[0].id).toBe('in_0')
    })
  })
})
