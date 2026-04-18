/**
 * Sub-nav entries for /dashboard/settings/*. Order matches VAL-SET-002.
 */
export interface SettingsNavItem {
  label: string
  href: string
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { label: 'Site', href: '/dashboard/settings/site' },
  { label: 'Knowledge', href: '/dashboard/settings/knowledge' },
  { label: 'Responses', href: '/dashboard/settings/responses' },
  { label: 'Escalation', href: '/dashboard/settings/escalation' },
  { label: 'Billing', href: '/dashboard/settings/billing' },
]

/**
 * Active-state resolver for the settings sub-nav. Matches on prefix so
 * nested routes (e.g. /dashboard/settings/site/edit) still highlight the
 * parent. Returns the best match (longest prefix).
 */
export function isActiveSubRoute(pathname: string, href: string): boolean {
  if (pathname === href) return true
  return pathname.startsWith(href + '/')
}
