import Link from 'next/link'

export const LEGAL_CONTACT_EMAIL = 'brandon@rubycrawl.app'

/**
 * Footer row shared by /privacy, /terms, /dpa. Links to the other two
 * public legal pages + contact. Rendered as a <nav> for accessibility.
 */
export function LegalFooter() {
  return (
    <footer className="mt-16 border-t border-[color:var(--border-hairline)] pt-6 text-xs text-[color:var(--ink-tertiary)]">
      <nav aria-label="Legal pages" className="flex flex-wrap gap-4">
        <Link
          href="/privacy"
          className="underline-offset-2 hover:underline focus-visible:underline"
        >
          Privacy Policy
        </Link>
        <Link
          href="/terms"
          className="underline-offset-2 hover:underline focus-visible:underline"
        >
          Terms of Service
        </Link>
        <Link
          href="/dpa"
          className="underline-offset-2 hover:underline focus-visible:underline"
        >
          Data Processing Addendum
        </Link>
        <a
          href={`mailto:${LEGAL_CONTACT_EMAIL}`}
          className="underline-offset-2 hover:underline focus-visible:underline"
        >
          {LEGAL_CONTACT_EMAIL}
        </a>
      </nav>
      <p className="mt-4">
        RubyCrawl &middot; Last updated 2026-04-19
      </p>
    </footer>
  )
}
