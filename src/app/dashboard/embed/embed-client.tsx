'use client'

import { useState } from 'react'
import { IconCheck, IconCopy, IconMail } from '@/components/icons'

const platforms = [
  'WordPress',
  'Squarespace',
  'Wix',
  'Shopify',
  'Webflow',
  'HTML / Custom',
] as const

type Platform = (typeof platforms)[number]

const platformInstructions: Record<Platform, string> = {
  WordPress:
    'Appearance → Editor (or the "Insert Headers and Footers" plugin).\nPaste the code before the closing </body> tag.\nSave and publish.',
  Squarespace:
    'Settings → Advanced → Code Injection.\nPaste in the "Footer" field.\nSave.',
  Wix: 'Settings → Custom Code → Add Code.\nPaste the code. Placement: "Body — end".\nApply.',
  Shopify:
    'Online Store → Themes → Actions → Edit code.\nOpen theme.liquid. Paste before </body>.\nSave.',
  Webflow:
    'Project Settings → Custom Code.\nPaste in the "Footer Code" field.\nPublish.',
  'HTML / Custom':
    'Open your HTML file.\nPaste the code before </body>.\nDeploy.',
}

export default function EmbedClient({ siteKey }: { siteKey: string }) {
  const [platform, setPlatform] = useState<Platform>('HTML / Custom')
  const [copied, setCopied] = useState(false)
  const [origin] = useState(() =>
    typeof window !== 'undefined' ? window.location.origin : ''
  )

  const embedCode = `<!-- RubyCrawl Chat Widget -->
<script
  src="${origin}/rubycrawl-loader.js"
  data-site-key="${siteKey}"
  data-api-base="${origin}"
  async
></script>`

  const handleCopy = async () => {
    await navigator.clipboard.writeText(embedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const emailSubject = encodeURIComponent(
    'Add RubyCrawl chatbot to our website'
  )
  const emailBody = encodeURIComponent(
    `Hi,\n\nPlease add this chat widget to our website. Paste the code before the closing </body> tag:\n\n${embedCode}\n\nInstructions for ${platform}:\n${platformInstructions[platform]}\n\nCSP note: if the site uses a Content Security Policy, add:\n  script-src ${origin};\n  connect-src ${origin};\n\nThanks!`
  )

  return (
    <div className="rc-enter">
      <header className="mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Embed
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Add it to your website.
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[color:var(--ink-secondary)]">
          One script tag, any platform. Loads lazily — it won&apos;t slow your
          site.
        </p>
      </header>

      <section className="mb-8">
        <p className="mb-3 text-xs font-medium tracking-tight text-[color:var(--ink-secondary)]">
          Platform
        </p>
        <div className="flex flex-wrap gap-1.5">
          {platforms.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`btn-press focus-ring rounded-full px-3.5 py-1.5 text-xs font-medium ${
                platform === p
                  ? 'bg-[color:var(--ink-primary)] text-[color:var(--bg-surface)]'
                  : 'border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] text-[color:var(--ink-secondary)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--ink-primary)]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-8 grid grid-cols-1 gap-8 md:grid-cols-[1fr_1.3fr]">
        <div>
          <p className="mb-3 text-xs font-medium tracking-tight text-[color:var(--ink-secondary)]">
            Instructions for {platform}
          </p>
          <ol className="space-y-2 text-sm leading-relaxed text-[color:var(--ink-secondary)]">
            {platformInstructions[platform].split('\n').map((line, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="font-mono text-[11px] text-[color:var(--ink-tertiary)]">
                  0{i + 1}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium tracking-tight text-[color:var(--ink-secondary)]">
              Embed code
            </p>
            <button
              onClick={handleCopy}
              className="btn-press focus-ring inline-flex items-center gap-1.5 rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[color:var(--ink-primary)] hover:border-[color:var(--border-strong)]"
            >
              {copied ? (
                <>
                  <IconCheck width={12} height={12} />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <IconCopy width={12} height={12} />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-inset)] p-4 text-[12px] leading-relaxed text-[color:var(--ink-primary)]">
            <code className="font-mono">{embedCode}</code>
          </pre>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 border-t border-[color:var(--border-hairline)] pt-6">
        <a
          href={`mailto:?subject=${emailSubject}&body=${emailBody}`}
          className="btn-press focus-ring inline-flex items-center gap-2 text-sm font-medium text-[color:var(--ink-secondary)] hover:text-[color:var(--ink-primary)]"
        >
          <IconMail width={14} height={14} />
          <span>Email these instructions to your developer</span>
        </a>

        <details className="group text-xs text-[color:var(--ink-tertiary)]">
          <summary className="cursor-pointer list-none select-none hover:text-[color:var(--ink-secondary)]">
            Content Security Policy (CSP) requirements
          </summary>
          <div className="mt-3 space-y-2 rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-inset)] p-3">
            <p className="text-[color:var(--ink-secondary)]">
              If your site uses a Content Security Policy, add:
            </p>
            <code className="block font-mono text-[11px] text-[color:var(--ink-primary)]">
              script-src {origin || 'https://your-app.com'};
              <br />
              connect-src {origin || 'https://your-app.com'};
            </code>
          </div>
        </details>
      </section>
    </div>
  )
}
