import { LegalFooter, LEGAL_CONTACT_EMAIL } from '@/components/legal/LegalFooter'

export const metadata = {
  title: 'Privacy Policy — RubyCrawl',
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
        Legal
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
        Privacy Policy
      </h1>
      <p className="mt-2 text-xs text-[color:var(--ink-tertiary)]">
        Effective 2026-04-19. This Policy describes what personal information
        RubyCrawl (&ldquo;RubyCrawl&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;)
        collects, how we use it, and the rights you have over it.
      </p>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          1. What we collect
        </h2>
        <p>
          <strong>Account data:</strong> email address and authentication
          metadata managed by Supabase.
        </p>
        <p>
          <strong>Site content:</strong> public HTML and files from the domain
          you crawl, fetched through Firecrawl and stored as embeddings in our
          Supabase database (pgvector).
        </p>
        <p>
          <strong>Supplementary files:</strong> PDFs, spreadsheets, and text
          documents you upload to augment the AI&rsquo;s knowledge. Stored in
          Supabase Storage under your user id.
        </p>
        <p>
          <strong>Chat transcripts:</strong> visitor messages, assistant
          replies, and any leads captured through the widget.
        </p>
        <p>
          <strong>Billing data:</strong> Stripe customer and subscription
          identifiers. We never see or store payment card numbers.
        </p>
        <p>
          <strong>Telemetry:</strong> error and performance data captured by
          Sentry for the purpose of diagnosing incidents.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          2. Processors (sub-processors)
        </h2>
        <p>
          We rely on the following third parties to deliver the service. Each
          is contractually bound by our Data Processing Addendum:
        </p>
        <ul className="list-disc pl-5">
          <li>
            <strong>Supabase</strong> &mdash; authentication, Postgres
            database, file storage, real-time subscriptions.
          </li>
          <li>
            <strong>OpenAI</strong> &mdash; text embeddings
            (text-embedding-3-small) and chat completions (gpt-4o-mini).
          </li>
          <li>
            <strong>Firecrawl</strong> &mdash; website crawling and
            markdown extraction.
          </li>
          <li>
            <strong>Stripe</strong> &mdash; subscription billing, invoices,
            and the customer portal.
          </li>
          <li>
            <strong>Upstash</strong> &mdash; Redis-backed rate limiting.
          </li>
          <li>
            <strong>Resend</strong> &mdash; transactional email delivery
            (welcome, trial ending, quota warnings, payment failures).
          </li>
          <li>
            <strong>Sentry</strong> &mdash; error monitoring with
            user_id/request_id tags to correlate incidents.
          </li>
        </ul>
        <p>
          See the <a href="/dpa" className="underline">DPA</a> for the
          current authorised sub-processor list.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          3. How we use information
        </h2>
        <p>
          To operate and improve RubyCrawl: provisioning accounts, crawling
          your site, answering your visitors&rsquo; questions, billing you
          correctly, sending service emails, and investigating outages.
        </p>
        <p>
          We do not sell personal information. We do not use your site&rsquo;s
          content or chat transcripts to train foundation models.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          4. Data retention
        </h2>
        <p>
          Account data and content persist for the life of your account. You
          can delete everything at any time from Settings &rsaquo; Site
          &rsaquo; Delete Account. Deletion cascades across all processors
          listed above within 30 days.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          5. Your rights (GDPR / CCPA)
        </h2>
        <p>
          You can access, correct, export, or delete your personal
          information at any time. Email us at{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="underline">
            {LEGAL_CONTACT_EMAIL}
          </a>{' '}
          and we will respond within 30 days.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          6. Contact
        </h2>
        <p>
          Privacy questions:{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>

      <LegalFooter />
    </main>
  )
}
