'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SETTINGS_NAV_ITEMS, isActiveSubRoute } from './nav-items'

/**
 * Left sub-nav rendered inside /dashboard/settings/* routes. Matches the
 * visual weight of the main dashboard sidebar but scopes itself to the
 * five settings sub-routes.
 *
 * Mobile (< 640px): the sidebar re-flows as a horizontal tab strip above
 * the content — see hidden/visible class switches.
 */
export function SettingsSidebar() {
  const pathname = usePathname() ?? ''

  return (
    <>
      {/* Mobile: horizontal tab strip */}
      <nav
        className="border-b border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-2 sm:hidden"
        aria-label="Settings sections"
      >
        <ul className="-mx-2 flex gap-1 overflow-x-auto px-2 py-2">
          {SETTINGS_NAV_ITEMS.map((item) => {
            const active = isActiveSubRoute(pathname, item.href)
            return (
              <li key={item.href} className="flex-shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`btn-press focus-ring rounded-md px-3 py-1.5 text-[13px] font-medium ${
                    active
                      ? 'bg-[color:var(--bg-subtle)] text-[color:var(--ink-primary)]'
                      : 'text-[color:var(--ink-secondary)] hover:bg-[color:var(--bg-subtle)] hover:text-[color:var(--ink-primary)]'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Desktop: vertical sidebar */}
      <aside
        className="hidden w-48 flex-shrink-0 sm:block"
        aria-label="Settings sections"
      >
        <nav>
          <ul className="space-y-0.5">
            {SETTINGS_NAV_ITEMS.map((item) => {
              const active = isActiveSubRoute(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`btn-press focus-ring block rounded-md px-2.5 py-1.5 text-[13px] font-medium ${
                      active
                        ? 'bg-[color:var(--bg-subtle)] text-[color:var(--ink-primary)]'
                        : 'text-[color:var(--ink-secondary)] hover:bg-[color:var(--bg-subtle)] hover:text-[color:var(--ink-primary)]'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
    </>
  )
}
