import { SettingsSidebar } from './settings-sidebar'

/**
 * Layout wrapping /dashboard/settings/* sub-routes. The parent
 * /dashboard layout already gates on auth (redirects guests to /login),
 * so unauthenticated visits to any /dashboard/settings/* route redirect
 * automatically — covered by VAL-SET-007.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:gap-10">
      <SettingsSidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
