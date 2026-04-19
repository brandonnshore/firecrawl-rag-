import { LegalFooter, LEGAL_CONTACT_EMAIL } from '@/components/legal/LegalFooter'

export const metadata = {
  title: 'Data Processing Addendum — RubyCrawl',
}

export default function DpaPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
        Legal
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
        Data Processing Addendum
      </h1>
      <p className="mt-2 text-xs text-[color:var(--ink-tertiary)]">
        Effective 2026-04-19. This Addendum (the &ldquo;DPA&rdquo;) supplements
        the <a href="/terms" className="underline">Terms of Service</a> and
        governs RubyCrawl&rsquo;s processing of personal data on behalf of
        customers under GDPR Art. 28 and comparable laws.
      </p>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          1. Roles
        </h2>
        <p>
          Customer is the controller of personal data processed through
          RubyCrawl. RubyCrawl is the processor. Each authorised sub-processor
          in Section 4 processes data only under RubyCrawl&rsquo;s
          instructions.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          2. Scope of processing
        </h2>
        <p>
          RubyCrawl processes personal data to: operate authentication,
          crawl and index the customer&rsquo;s own website, answer the
          customer&rsquo;s visitors via the chat widget, store leads the
          visitor chooses to submit, meter usage, send service emails, and
          diagnose outages.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          3. Security measures
        </h2>
        <ul className="list-disc pl-5">
          <li>
            Row-level security enforced on every user-scoped Postgres table;
            service-role key used only at four server-only boundaries
            (chat/session, leads, crawl webhook, file processing).
          </li>
          <li>
            Customer data is logically isolated by user_id and, for public
            endpoints, by site_key validated against the owning site.
          </li>
          <li>Encryption in transit (TLS) and at rest (Supabase, Stripe).</li>
          <li>
            Least-privilege access: dashboard users see only their own rows
            via RLS; RubyCrawl operators use break-glass service-role access
            logged in audit logs.
          </li>
          <li>
            Rate limits backed by Upstash prevent abuse of the public
            widget, crawl, and file-upload endpoints.
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          4. Authorised sub-processors
        </h2>
        <p>The following sub-processors are engaged as of the effective date:</p>
        <ul className="list-disc pl-5">
          <li>
            <strong>Supabase</strong>, Inc. &mdash; authentication, Postgres
            database with pgvector, object storage, real-time pub/sub.
            Region: us-east-1.
          </li>
          <li>
            <strong>OpenAI</strong>, L.L.C. &mdash; text embeddings
            (text-embedding-3-small) and chat completions (gpt-4o-mini).
          </li>
          <li>
            <strong>Firecrawl</strong> &mdash; website crawling and markdown
            extraction; async webhook callbacks.
          </li>
          <li>
            <strong>Stripe</strong>, Inc. &mdash; subscription billing,
            invoices, customer portal, webhook signature verification.
          </li>
          <li>
            <strong>Upstash</strong>, Inc. &mdash; Redis-backed sliding-window
            rate limiting across the public widget, crawl, and file-upload
            surfaces.
          </li>
          <li>
            <strong>Resend</strong> &mdash; transactional email (welcome,
            trial ending, quota warnings, payment failure).
          </li>
          <li>
            <strong>Sentry</strong> &mdash; error monitoring with tags
            environment, user_id, request_id.
          </li>
        </ul>
        <p>
          We will provide at least 30 days&rsquo; notice before engaging a
          new sub-processor. Customers may object to a new sub-processor by
          emailing{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="underline">
            {LEGAL_CONTACT_EMAIL}
          </a>{' '}
          within the notice window.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          5. International transfers
        </h2>
        <p>
          Personal data may be transferred to sub-processors located outside
          your country, including the United States. Where required,
          transfers are governed by Standard Contractual Clauses.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          6. Data-subject requests
        </h2>
        <p>
          Customer may fulfil data-subject access, correction, portability,
          and erasure requests using the self-service controls
          (Settings &rsaquo; Site &rsaquo; Delete Account) or by contacting{' '}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="underline">
            {LEGAL_CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          7. Breach notification
        </h2>
        <p>
          RubyCrawl will notify the Customer without undue delay after
          becoming aware of a personal data breach affecting Customer data.
        </p>
      </section>

      <LegalFooter />
    </main>
  )
}
