import { LegalFooter, LEGAL_CONTACT_EMAIL } from '@/components/legal/LegalFooter'

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
      <p className="mt-2 text-xs text-[color:var(--ink-tertiary)]">
        Effective 2026-04-19. By creating an account you agree to these
        Terms. If you don&rsquo;t agree, don&rsquo;t use the service.
      </p>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          1. What RubyCrawl does
        </h2>
        <p>
          RubyCrawl crawls a website you control, indexes its content, and
          serves an embeddable AI chatbot that answers visitor questions
          using that content. You are the controller of the content and the
          chat transcripts; RubyCrawl is the processor.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          2. Acceptable use
        </h2>
        <ul className="list-disc pl-5">
          <li>You may only crawl sites you own or have permission to crawl.</li>
          <li>
            You may not use the chatbot to distribute illegal, harassing,
            deceptive, or infringing material.
          </li>
          <li>
            You may not attempt to extract other customers&rsquo; data or
            bypass rate limits, quotas, or the subscription gate.
          </li>
          <li>
            Automated scraping of RubyCrawl&rsquo;s own pages or endpoints is
            prohibited except through the officially documented widget and
            API surfaces.
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          3. Subscriptions and billing
        </h2>
        <p>
          RubyCrawl is billed monthly through Stripe. Each plan includes a
          monthly cap on chat messages, crawled pages, and supplementary
          files. Exceeding a cap returns a 402 response until the next
          billing period or an upgrade.
        </p>
        <p>
          You may cancel at any time via the customer portal. Cancellation
          takes effect at the end of the current billing period. Refunds
          are not issued for partial periods except where required by law.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          4. Your content
        </h2>
        <p>
          You retain all rights to the site content and files you upload.
          You grant RubyCrawl a non-exclusive licence to process that
          content solely to provide the service (crawling, embedding,
          retrieval, chat completion, display).
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          5. Warranties and liability
        </h2>
        <p>
          The service is provided on an &ldquo;as is&rdquo; basis. RubyCrawl
          makes no warranty that the chatbot&rsquo;s answers are accurate,
          complete, or fit for any particular purpose. To the maximum extent
          permitted by law, aggregate liability is limited to the fees you
          paid in the three months preceding the claim.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          6. Termination
        </h2>
        <p>
          We may suspend or terminate accounts that violate Section 2 with
          notice to the email on file. You may delete your account at any
          time from Settings &rsaquo; Site &rsaquo; Delete Account. See the{' '}
          <a href="/privacy" className="underline">
            Privacy Policy
          </a>{' '}
          for how deletion cascades across processors.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
        <h2 className="text-lg font-semibold text-[color:var(--ink-primary)]">
          7. Contact
        </h2>
        <p>
          Questions about these terms:{' '}
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
