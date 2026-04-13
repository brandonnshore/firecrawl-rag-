export interface NavItem {
  label: string
  href: string
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Preview', href: '/dashboard/preview' },
  { label: 'Embed', href: '/dashboard/embed' },
  { label: 'Leads', href: '/dashboard/leads' },
  { label: 'Conversations', href: '/dashboard/conversations' },
  { label: 'Settings', href: '/dashboard/settings' },
  { label: 'Billing', href: '/dashboard/billing' },
]
