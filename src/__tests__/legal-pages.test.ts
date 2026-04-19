import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PrivacyPage from '@/app/privacy/page'
import TermsPage from '@/app/terms/page'
import DpaPage from '@/app/dpa/page'

// M8F3 legal-pages — VAL-HARD-003 (/privacy renders), VAL-HARD-004
// (/terms renders), VAL-HARD-005 (/dpa renders). Each page must return
// > 1KB of content, link to the other two via the footer, list our data
// processors, and show a contact email. We render each server component
// to static markup and assert on the HTML string.

const EXPECTED_PROCESSORS = [
  'Supabase',
  'OpenAI',
  'Firecrawl',
  'Stripe',
  'Upstash',
  'Resend',
  'Sentry',
]

const CONTACT_EMAIL = 'brandon@rubycrawl.app'

function renderPage(Page: () => React.ReactElement): string {
  return renderToStaticMarkup(Page())
}

describe('/privacy (VAL-HARD-003)', () => {
  const html = renderPage(PrivacyPage)

  it('renders a body larger than 1KB', () => {
    expect(html.length).toBeGreaterThan(1024)
  })

  it('links to /terms and /dpa in the footer', () => {
    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/dpa"')
  })

  it('lists each of our data processors by name', () => {
    for (const p of EXPECTED_PROCESSORS) {
      expect(html, `missing processor ${p}`).toContain(p)
    }
  })

  it('exposes the contact email', () => {
    expect(html).toContain(CONTACT_EMAIL)
  })
})

describe('/terms (VAL-HARD-004)', () => {
  const html = renderPage(TermsPage)

  it('renders a body larger than 1KB', () => {
    expect(html.length).toBeGreaterThan(1024)
  })

  it('links to /privacy and /dpa in the footer', () => {
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/dpa"')
  })

  it('exposes the contact email', () => {
    expect(html).toContain(CONTACT_EMAIL)
  })
})

describe('/dpa (VAL-HARD-005)', () => {
  const html = renderPage(DpaPage)

  it('renders a body larger than 1KB', () => {
    expect(html.length).toBeGreaterThan(1024)
  })

  it('links to /privacy and /terms in the footer', () => {
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/terms"')
  })

  it('lists each sub-processor by name (GDPR Art. 28)', () => {
    for (const p of EXPECTED_PROCESSORS) {
      expect(html, `missing processor ${p}`).toContain(p)
    }
  })

  it('exposes the contact email for data requests', () => {
    expect(html).toContain(CONTACT_EMAIL)
  })
})
