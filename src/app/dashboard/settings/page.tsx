import { redirect } from 'next/navigation'

/**
 * VAL-SET-001: /dashboard/settings lands on /dashboard/settings/site.
 */
export default function SettingsIndex() {
  redirect('/dashboard/settings/site')
}
