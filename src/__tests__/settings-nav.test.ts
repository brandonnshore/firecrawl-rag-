import { describe, it, expect } from 'vitest'
import {
  SETTINGS_NAV_ITEMS,
  isActiveSubRoute,
} from '@/app/dashboard/settings/nav-items'

describe('SETTINGS_NAV_ITEMS', () => {
  it('VAL-SET-002: contains exactly 5 entries in order Site, Knowledge, Responses, Escalation, Billing', () => {
    expect(SETTINGS_NAV_ITEMS.map((i) => i.label)).toEqual([
      'Site',
      'Knowledge',
      'Responses',
      'Escalation',
      'Billing',
    ])
  })

  it('all items link under /dashboard/settings/*', () => {
    for (const item of SETTINGS_NAV_ITEMS) {
      expect(item.href.startsWith('/dashboard/settings/')).toBe(true)
    }
  })
})

describe('isActiveSubRoute', () => {
  it('exact match is active', () => {
    expect(isActiveSubRoute('/dashboard/settings/site', '/dashboard/settings/site')).toBe(true)
  })

  it('nested route matches parent', () => {
    expect(
      isActiveSubRoute('/dashboard/settings/site/edit', '/dashboard/settings/site')
    ).toBe(true)
  })

  it('sibling route does not match', () => {
    expect(
      isActiveSubRoute('/dashboard/settings/knowledge', '/dashboard/settings/site')
    ).toBe(false)
  })

  it('prefix-coincident but different segment does not match', () => {
    // 'sitemap' must NOT match 'site' by prefix
    expect(
      isActiveSubRoute('/dashboard/settings/sitemap', '/dashboard/settings/site')
    ).toBe(false)
  })

  it('parent /dashboard/settings does not match any sub-route', () => {
    expect(
      isActiveSubRoute('/dashboard/settings', '/dashboard/settings/site')
    ).toBe(false)
  })
})
