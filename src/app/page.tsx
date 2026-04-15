import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <span className="text-xl font-bold">RubyCrawl</span>
        <Link
          href="/login"
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
        >
          Sign in
        </Link>
      </nav>

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl">
          An AI chatbot for your website in 3 minutes
        </h1>
        <p className="mx-auto mb-8 max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          Paste your website URL. We&apos;ll crawl it and give you an embeddable
          chatbot that knows everything about your business. Answer visitor
          questions, capture leads, and book appointments — 24/7.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-indigo-500 px-8 py-4 text-lg font-medium text-white transition-colors hover:bg-indigo-600"
        >
          Start free trial →
        </Link>
        <p className="mt-3 text-sm text-zinc-500">
          7-day free trial. No credit card required.
        </p>
      </section>

      <section className="bg-zinc-50 px-6 py-16 dark:bg-zinc-900">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-12 text-center text-2xl font-bold">How it works</h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            <Step
              num="1"
              title="Paste your URL"
              desc="Enter your website address. That's it."
            />
            <Step
              num="2"
              title="We crawl & train"
              desc="We read every page and train an AI chatbot on your content."
            />
            <Step
              num="3"
              title="Embed & go live"
              desc="Copy one line of code to your site. Your chatbot is live."
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h2 className="mb-4 text-2xl font-bold">Simple pricing</h2>
        <div className="rounded-xl border border-zinc-200 p-8 dark:border-zinc-700">
          <p className="mb-2 text-4xl font-bold">
            $24.99
            <span className="text-lg font-normal text-zinc-500">/month</span>
          </p>
          <p className="mb-6 text-zinc-500">
            Everything included. 7-day free trial.
          </p>
          <ul className="mx-auto mb-6 max-w-xs space-y-2 text-left text-sm">
            <li>✓ Crawl up to 100 pages</li>
            <li>✓ 500 chat messages/month</li>
            <li>✓ Lead capture</li>
            <li>✓ Calendly & Maps integration</li>
            <li>✓ Dashboard analytics</li>
            <li>✓ Embeddable widget</li>
          </ul>
          <Link
            href="/login"
            className="inline-block rounded-lg bg-indigo-500 px-6 py-3 font-medium text-white hover:bg-indigo-600"
          >
            Start free trial
          </Link>
        </div>
      </section>

      <footer className="border-t border-zinc-100 px-6 py-8 text-center text-sm text-zinc-400 dark:border-zinc-800">
        <p>© 2026 RubyCrawl. All rights reserved.</p>
      </footer>
    </div>
  )
}

function Step({
  num,
  title,
  desc,
}: {
  num: string
  title: string
  desc: string
}) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-600">
        {num}
      </div>
      <h3 className="mb-1 font-semibold">{title}</h3>
      <p className="text-sm text-zinc-500">{desc}</p>
    </div>
  )
}
