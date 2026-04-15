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
  { label: 'Billing', href: '/dashboard/billing', Icon: IconCard },
]
