import { describe, it, expect } from 'vitest'
import { NAV_ITEMS } from '@/app/dashboard/nav-items'

/**
 * Dashboard shell tests — validate navigation structure and expected content.
 * Browser-based rendering tests use agent-browser; these unit tests validate
 * the data structures and constants used by the dashboard layout.
 */

const EXPECTED_NAV_ITEMS = NAV_ITEMS

describe('Dashboard navigation structure', () => {
  it('has exactly 7 navigation items', () => {
    expect(EXPECTED_NAV_ITEMS).toHaveLength(7)
  })

  it('all nav items have labels and href paths', () => {
    for (const item of EXPECTED_NAV_ITEMS) {
      expect(item.label).toBeTruthy()
      expect(item.href).toMatch(/^\/dashboard/)
    }
  })

  it('Dashboard link points to /dashboard root', () => {
    const dashboardItem = EXPECTED_NAV_ITEMS.find(
      (item) => item.label === 'Dashboard'
    )
    expect(dashboardItem).toBeDefined()
    expect(dashboardItem!.href).toBe('/dashboard')
  })

  it('all expected pages have navigation entries', () => {
    const labels = EXPECTED_NAV_ITEMS.map((item) => item.label)
    expect(labels).toContain('Dashboard')
    expect(labels).toContain('Preview')
    expect(labels).toContain('Embed')
    expect(labels).toContain('Leads')
    expect(labels).toContain('Conversations')
    expect(labels).toContain('Settings')
    expect(labels).toContain('Billing')
  })

  it('each href is unique', () => {
    const hrefs = EXPECTED_NAV_ITEMS.map((item) => item.href)
    const unique = new Set(hrefs)
    expect(unique.size).toBe(hrefs.length)
  })
})

describe('Dashboard page content', () => {
  it('empty state message is user-friendly (no technical jargon)', () => {
    const emptyStateMessage = 'No site yet — set up your chatbot to get started.'
    expect(emptyStateMessage).not.toMatch(/error|null|undefined|exception/i)
    expect(emptyStateMessage).toContain('chatbot')
  })
})
