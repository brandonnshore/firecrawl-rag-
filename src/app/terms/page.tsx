/**
 * Placeholder Terms of Service page. M8 hardening-launch replaces this
 * with real legal copy authored with counsel. Keeping this stub in place
 * so the ToS link from /login (VAL-TOS-002) resolves to a 200 page today.
 */

export const metadata = {
  title: 'Terms of Service — RubyCrawl',
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
        Legal
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
        Terms of Service
      </h1>
      <p className="mt-6 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        RubyCrawl is currently in private beta. By using the service you
        agree that it&rsquo;s provided as-is, that you&rsquo;ll only crawl
        sites you own or have permission to crawl, and that you won&rsquo;t
        use the platform to serve illegal, harassing, or deceptive content.
        Full terms will be published before general availability.
      </p>
      <p className="mt-6 text-xs text-[color:var(--ink-tertiary)]">
        Questions: brandon@rubycrawl.app.
      </p>
    </main>
  )
}
