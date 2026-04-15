'use client'

import { useState } from 'react'

const platforms = [
  'WordPress',
  'Squarespace',
  'Wix',
  'Shopify',
  'Webflow',
  'HTML / Custom',
]

const platformInstructions: Record<string, string> = {
  WordPress:
    '1. Go to Appearance → Editor (or use a plugin like "Insert Headers and Footers")\n2. Paste the code before the closing </body> tag\n3. Save and publish',
  Squarespace:
    '1. Go to Settings → Advanced → Code Injection\n2. Paste the code in the "Footer" section\n3. Save',
  Wix: '1. Go to Settings → Custom Code\n2. Click "Add Code"\n3. Paste the code, set placement to "Body - end"\n4. Apply',
  Shopify:
    '1. Go to Online Store → Themes → Actions → Edit code\n2. Open theme.liquid\n3. Paste the code before </body>\n4. Save',
  Webflow:
    '1. Go to Project Settings → Custom Code\n2. Paste in the "Footer Code" section\n3. Publish your site',
  'HTML / Custom':
    '1. Open your HTML file\n2. Paste the code before the closing </body> tag\n3. Save and deploy',
}

export default function EmbedClient({ siteKey }: { siteKey: string }) {
  const [platform, setPlatform] = useState('HTML / Custom')
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
    `Hi,\n\nPlease add this chat widget to our website. Paste the following code before the closing </body> tag:\n\n${embedCode}\n\n${platformInstructions[platform] || ''}\n\nCSP Note: If the site uses a Content Security Policy, add:\nscript-src ${origin};\nconnect-src ${origin};\n\nThanks!`
  )

  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="mb-2 text-2xl font-bold">Add to your website</h1>
      <p className="mb-6 text-zinc-500">
        Choose your platform and follow the instructions.
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        {platforms.map((p) => (
          <button
            key={p}
            onClick={() => setPlatform(p)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              platform === p
                ? 'bg-indigo-500 text-white'
                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="mb-6 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800">
        <h3 className="mb-2 font-medium">Instructions for {platform}</h3>
        <pre className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
          {platformInstructions[platform]}
        </pre>
      </div>

      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium">Embed code</label>
        <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm text-green-400">
          {embedCode}
        </pre>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <button
          onClick={handleCopy}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
        >
          {copied ? '✓ Copied!' : 'Copy code'}
        </button>
        <a
          href={`mailto:?subject=${emailSubject}&body=${emailBody}`}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300"
        >
          Email to developer
        </a>
      </div>

      <details className="text-sm text-zinc-500">
        <summary className="cursor-pointer hover:text-zinc-700">
          Content Security Policy (CSP) requirements
        </summary>
        <p className="mt-2">
          If your website uses a Content Security Policy, add these directives:
        </p>
        <code className="mt-1 block rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
          script-src {origin || 'https://your-app.com'}; connect-src{' '}
          {origin || 'https://your-app.com'};
        </code>
      </details>
    </div>
  )
}
