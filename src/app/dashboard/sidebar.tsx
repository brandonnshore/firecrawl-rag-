'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS } from './nav-items'
import { SignOutButton } from './sign-out-button'

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex h-full w-60 flex-col border-r border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)]">
      <div className="flex h-14 items-center px-5">
        <Link
          href="/dashboard"
          className="focus-ring btn-press text-[15px] font-semibold tracking-tight text-[color:var(--ink-primary)]"
        >
          RubyCrawl
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ label, href, Icon }) => {
            const isActive =
              href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(href)

            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`btn-press focus-ring group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium ${
                    isActive
                      ? 'bg-[color:var(--bg-subtle)] text-[color:var(--ink-primary)]'
                      : 'text-[color:var(--ink-secondary)] hover:bg-[color:var(--bg-subtle)] hover:text-[color:var(--ink-primary)]'
                  }`}
                >
                  <Icon
                    width={15}
                    height={15}
                    className={
                      isActive
                        ? 'text-[color:var(--ink-primary)]'
                        : 'text-[color:var(--ink-tertiary)] group-hover:text-[color:var(--ink-secondary)]'
                    }
                  />
                  <span>{label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-[color:var(--border-hairline)] p-3">
        <SignOutButton />
      </div>
    </aside>
  )
}
