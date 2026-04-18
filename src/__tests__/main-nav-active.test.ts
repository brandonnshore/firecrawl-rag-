import { describe, it, expect } from 'vitest'
import { resolveActiveHref, NAV_ITEMS } from '@/app/dashboard/nav-items'

const HREFS = NAV_ITEMS.map((n) => n.href)

describe('resolveActiveHref — longest-prefix match', () => {
  it('exact /dashboard matches /dashboard', () => {
    expect(resolveActiveHref('/dashboard', HREFS)).toBe('/dashboard')
  })

  it('/dashboard/settings/site highlights Settings (not Billing)', () => {
    expect(resolveActiveHref('/dashboard/settings/site', HREFS)).toBe(
      '/dashboard/settings'
    )
  })

  it('/dashboard/settings/billing highlights Billing (more specific wins)', () => {
    expect(resolveActiveHref('/dashboard/settings/billing', HREFS)).toBe(
      '/dashboard/settings/billing'
    )
  })

  it('/dashboard/settings/billing/invoices still highlights Billing', () => {
    expect(resolveActiveHref('/dashboard/settings/billing/invoices', HREFS)).toBe(
      '/dashboard/settings/billing'
    )
  })

  it('/dashboard/leads highlights Leads', () => {
    expect(resolveActiveHref('/dashboard/leads', HREFS)).toBe('/dashboard/leads')
  })

  it('unknown path matches nothing (returns empty)', () => {
    expect(resolveActiveHref('/somewhere/else', HREFS)).toBe('')
  })
})
