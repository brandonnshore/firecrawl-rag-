import type { SVGProps } from 'react'
import {
  IconHome,
  IconEye,
  IconCode,
  IconMail,
  IconChat,
  IconSettings,
  IconCard,
} from '@/components/icons'

export interface NavItem {
  label: string
  href: string
  Icon: (props: SVGProps<SVGSVGElement>) => React.ReactElement
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', Icon: IconHome },
  { label: 'Preview', href: '/dashboard/preview', Icon: IconEye },
  { label: 'Embed', href: '/dashboard/embed', Icon: IconCode },
  { label: 'Leads', href: '/dashboard/leads', Icon: IconMail },
  { label: 'Conversations', href: '/dashboard/conversations', Icon: IconChat },
  { label: 'Settings', href: '/dashboard/settings', Icon: IconSettings },
  { label: 'Billing', href: '/dashboard/settings/billing', Icon: IconCard },
]

/**
 * Longest-prefix active-state resolver. Required now that Billing lives
 * under Settings — without it, pathname=/dashboard/settings/billing would
 * light up BOTH Settings (prefix match) and Billing. The more specific
 * href wins.
 */
export function resolveActiveHref(
  pathname: string,
  hrefs: readonly string[]
): string {
  let best = ''
  for (const href of hrefs) {
    const isExact = pathname === href
    const isPrefix = pathname.startsWith(href + '/')
    if ((isExact || isPrefix) && href.length > best.length) best = href
  }
  return best
}
