# M4: Widget + Integration — Execution Document

## Prerequisites
- M3 complete: POST /api/chat/session and GET /api/chat/stream working
- A test site with crawl_status='ready', embeddings populated, site_key known
- Redis on localhost:6379
- pnpm, Vitest, Next.js 16.2.3

## What to Build

1. **Widget Loader & Bubble** — Preact IIFE bundle with Shadow DOM, lazy loading
2. **Widget Chat Panel** — Full chat UI with streaming, accessibility, mobile
3. **Lead Capture API** — Public endpoint + CSV export + widget email capture

---

## Feature 1: Widget Loader & Bubble

### New Directory: `widget/`

This is a SEPARATE package with its own dependencies and build.

### `widget/package.json`

```json
{
  "name": "rubycrawl-widget",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build:loader": "vite build --config vite.config.ts",
    "build:widget": "vite build --config vite.widget.config.ts",
    "build": "npm run build:loader && npm run build:widget",
    "test": "vitest run"
  },
  "dependencies": {
    "preact": "^10.25.0"
  },
  "devDependencies": {
    "@preactjs/preset-vite": "^2.9.0",
    "vite": "^6.3.0",
    "vitest": "^4.1.0",
    "terser": "^5.37.0",
    "typescript": "^5.0.0"
  }
}
```

### `widget/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

### `widget/vite.config.ts` (Loader build)

```typescript
import { defineConfig } from 'vite'
import preact from '@preactjs/preset-vite'

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: 'src/loader.ts',
      name: 'RubyCrawl',
      formats: ['iife'],
      fileName: () => 'rubycrawl-loader.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'terser',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})
```

### `widget/vite.widget.config.ts` (Full widget build)

```typescript
import { defineConfig } from 'vite'
import preact from '@preactjs/preset-vite'

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: 'src/widget.tsx',
      name: 'RubyCrawlWidget',
      formats: ['iife'],
      fileName: () => 'rubycrawl-widget.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    minify: 'terser',
    cssCodeSplit: false,
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})
```

### `widget/src/loader.ts`

```typescript
// Capture script element synchronously BEFORE any async
const currentScript = document.currentScript as HTMLScriptElement | null
const siteKey = currentScript?.getAttribute('data-site-key') || ''
const apiBase = currentScript?.getAttribute('data-api-base') || window.location.origin

if (!siteKey) {
  console.error('[RubyCrawl] Missing data-site-key attribute')
} else {
  initWidget(siteKey, apiBase)
}

function initWidget(siteKey: string, apiBase: string) {
  // Create container
  const container = document.createElement('div')
  container.id = 'rubycrawl-root'
  document.body.appendChild(container)

  // Attach Shadow DOM
  const shadow = container.attachShadow({ mode: 'open' })

  // Inject styles
  const style = document.createElement('style')
  style.textContent = getBubbleCSS()
  shadow.appendChild(style)

  // Check if site is ready before showing bubble
  checkSiteReady(siteKey, apiBase).then((ready) => {
    if (!ready) return // Don't render bubble if site not ready

    // Create bubble
    const bubble = document.createElement('button')
    bubble.className = 'rc-bubble'
    bubble.setAttribute('aria-label', 'Open chat')
    bubble.setAttribute('aria-expanded', 'false')
    bubble.innerHTML = chatIconSVG()
    shadow.appendChild(bubble)

    let panelLoaded = false
    let panelVisible = false

    bubble.addEventListener('click', () => {
      panelVisible = !panelVisible
      bubble.setAttribute('aria-expanded', String(panelVisible))
      bubble.innerHTML = panelVisible ? closeIconSVG() : chatIconSVG()

      if (!panelLoaded) {
        panelLoaded = true
        loadFullWidget(shadow, siteKey, apiBase)
      } else {
        // Toggle panel visibility
        const panel = shadow.querySelector('.rc-panel') as HTMLElement
        if (panel) panel.style.display = panelVisible ? 'flex' : 'none'
      }
    })
  })
}

async function checkSiteReady(siteKey: string, apiBase: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/api/chat/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_key: siteKey, message: '__healthcheck__' }),
    })
    // 503 = not ready, 404 = invalid key, anything else means the endpoint exists
    // We just need to know the site exists and is ready
    // A better approach: create a lightweight /api/widget/status endpoint
    return res.status !== 503 && res.status !== 404
  } catch {
    return false
  }
}

function loadFullWidget(shadow: ShadowRoot, siteKey: string, apiBase: string) {
  const scriptSrc = getWidgetScriptUrl()
  const script = document.createElement('script')
  script.src = scriptSrc
  script.onload = () => {
    const Widget = (window as any).RubyCrawlWidget
    if (Widget) {
      // Inject widget styles
      const widgetStyle = document.createElement('style')
      widgetStyle.textContent = Widget.getStyles()
      shadow.appendChild(widgetStyle)

      // Create panel container
      const panelContainer = document.createElement('div')
      shadow.appendChild(panelContainer)

      // Mount the widget
      Widget.mount(panelContainer, { siteKey, apiBase }, shadow)
    }
  }
  document.head.appendChild(script)
}

function getWidgetScriptUrl(): string {
  if (currentScript?.src) {
    return currentScript.src.replace('rubycrawl-loader.js', 'rubycrawl-widget.js')
  }
  return '/rubycrawl-widget.js'
}

function chatIconSVG(): string {
  return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
}

function closeIconSVG(): string {
  return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
}

function getBubbleCSS(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    .rc-bubble {
      position: fixed; bottom: 20px; right: 20px;
      width: 60px; height: 60px; border-radius: 50%;
      background: #6366f1; color: white; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 999999;
      transition: transform 0.2s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .rc-bubble:hover { transform: scale(1.1); }
    @media (prefers-reduced-motion: reduce) {
      .rc-bubble { transition: none; }
      .rc-bubble:hover { transform: none; }
    }
  `
}
```

### `public/test-widget.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RubyCrawl Widget Test</title>
  <style>
    body { font-family: sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { margin-bottom: 20px; }
    /* Aggressive CSS to test isolation */
    * { color: green !important; }
    p { font-size: 10px !important; }
  </style>
</head>
<body>
  <h1>Widget Test Page</h1>
  <p>This page has aggressive CSS (green text, 10px font). The widget should be unaffected.</p>
  <p>Look for the chat bubble in the bottom-right corner.</p>

  <!-- RubyCrawl Widget -->
  <script
    src="/rubycrawl-loader.js"
    data-site-key="REPLACE_WITH_YOUR_SITE_KEY"
    data-api-base="http://localhost:3000"
    async
  ></script>
</body>
</html>
```

### Wire into main build

Update root `package.json` scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "cd widget && pnpm install && pnpm build && cp dist/* ../public/ && cd .. && next build",
    "build:widget": "cd widget && pnpm install && pnpm build && cp dist/* ../public/",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit"
  }
}
```

### Validation Assertions

- **VAL-WIDGET-001**: Script loads async, doesn't block page
- **VAL-WIDGET-002**: Shadow DOM container with mode 'open'
- **VAL-WIDGET-003**: Bubble visible bottom-right when site ready
- **VAL-WIDGET-012**: Network error shows friendly message

---

## Feature 2: Widget Chat Panel

### `widget/src/widget.tsx`

```tsx
import { h, render } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'

interface WidgetConfig {
  siteKey: string
  apiBase: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

function ChatPanel({ config, onClose }: { config: WidgetConfig; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! How can I help you today?' }
  ])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [showEmailCapture, setShowEmailCapture] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messageCount = useRef(0)

  // Get or create visitor ID
  const visitorId = useRef(getVisitorId())

  useEffect(() => {
    dialogRef.current?.showModal()
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return

    const userMessage = input.trim()
    setInput('')
    messageCount.current++

    const updatedMessages: Message[] = [...messages, { role: 'user', content: userMessage }]
    setMessages(updatedMessages)
    setIsStreaming(true)

    try {
      // Step 1: POST session
      const sessionRes = await fetch(`${config.apiBase}/api/chat/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: updatedMessages.slice(0, -1).filter(m => m.content !== 'Hi! How can I help you today?'),
          site_key: config.siteKey,
        }),
      })

      if (!sessionRes.ok) {
        throw new Error(`Session failed: ${sessionRes.status}`)
      }

      const { sessionId } = await sessionRes.json()

      // Step 2: GET stream
      const streamRes = await fetch(`${config.apiBase}/api/chat/stream?sid=${sessionId}`)

      if (!streamRes.ok || !streamRes.body) {
        throw new Error(`Stream failed: ${streamRes.status}`)
      }

      const reader = streamRes.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      // Add empty assistant message
      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: fullText }
          return updated
        })
      }

      // Show email capture after 3 messages
      if (messageCount.current >= 3 && !emailSent) {
        setShowEmailCapture(true)
      }
    } catch (err) {
      console.error('[RubyCrawl] Chat error:', err)
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }
      ])
    } finally {
      setIsStreaming(false)
    }
  }

  const handleEmailSubmit = async (email: string, name: string) => {
    try {
      await fetch(`${config.apiBase}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_key: config.siteKey,
          email,
          name,
          message: messages[messages.length - 1]?.content || '',
          source_page: window.location.href,
        }),
      })
      setEmailSent(true)
      setShowEmailCapture(false)
      setMessages(prev => [...prev, { role: 'assistant', content: `Thanks ${name || ''}! We'll be in touch at ${email}.` }])
    } catch {
      // Silent fail — don't disrupt chat
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      class="rc-panel"
      onKeyDown={handleKeyDown}
      aria-label="Chat with us"
    >
      <div class="rc-header">
        <span>Chat with us</span>
        <button class="rc-close" onClick={onClose} aria-label="Close chat">&times;</button>
      </div>
      <div class="rc-messages" role="log" aria-live="polite">
        {messages.map((msg, i) => (
          <div key={i} class={`rc-msg rc-msg-${msg.role}`}>
            {msg.content || (isStreaming && i === messages.length - 1 ? '...' : '')}
          </div>
        ))}
        {showEmailCapture && !emailSent && (
          <EmailCapture onSubmit={handleEmailSubmit} />
        )}
        <div ref={messagesEndRef} />
      </div>
      <form class="rc-input-area" onSubmit={(e) => { e.preventDefault(); sendMessage() }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          placeholder="Ask a question..."
          disabled={isStreaming}
          maxLength={500}
        />
        <button type="submit" disabled={isStreaming || !input.trim()} aria-label="Send message">
          ↑
        </button>
      </form>
      <div class="rc-footer">
        <a href="https://rubycrawl.com" target="_blank" rel="noopener noreferrer">
          Powered by RubyCrawl
        </a>
      </div>
    </dialog>
  )
}

function EmailCapture({ onSubmit }: { onSubmit: (email: string, name: string) => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')

  return (
    <div class="rc-email-capture">
      <p>Want us to follow up? Leave your email:</p>
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
      />
      <input
        type="email"
        placeholder="your@email.com"
        value={email}
        onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        required
      />
      {/* Honeypot field — hidden from real users */}
      <input type="text" name="website" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
      <button onClick={() => email && onSubmit(email, name)}>Send</button>
    </div>
  )
}

function getVisitorId(): string {
  try {
    let id = localStorage.getItem('rc_visitor_id')
    if (!id) {
      id = 'v_' + Math.random().toString(36).substring(2) + Date.now().toString(36)
      localStorage.setItem('rc_visitor_id', id)
    }
    return id
  } catch {
    return 'v_' + Math.random().toString(36).substring(2) + Date.now().toString(36)
  }
}

function getStyles(): string {
  return `
    .rc-panel {
      position: fixed; bottom: 90px; right: 20px;
      width: 380px; height: 520px; border-radius: 12px;
      background: white; color: #1f2937;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12); z-index: 999998;
      overflow: hidden; display: flex; flex-direction: column;
      border: 1px solid #e5e7eb; padding: 0; margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px; line-height: 1.5;
    }
    .rc-panel::backdrop { background: transparent; }
    .rc-header {
      padding: 16px; font-weight: 600; border-bottom: 1px solid #e5e7eb;
      display: flex; justify-content: space-between; align-items: center;
    }
    .rc-close {
      background: none; border: none; font-size: 20px; cursor: pointer;
      color: #6b7280; padding: 4px 8px; border-radius: 4px;
    }
    .rc-close:hover { background: #f3f4f6; }
    .rc-messages { flex: 1; overflow-y: auto; padding: 16px; }
    .rc-msg { margin-bottom: 12px; padding: 10px 14px; border-radius: 12px; max-width: 85%; word-wrap: break-word; }
    .rc-msg-user { background: #6366f1; color: white; margin-left: auto; border-bottom-right-radius: 4px; }
    .rc-msg-assistant { background: #f3f4f6; color: #1f2937; border-bottom-left-radius: 4px; }
    .rc-input-area { display: flex; padding: 12px; border-top: 1px solid #e5e7eb; gap: 8px; }
    .rc-input-area input {
      flex: 1; padding: 10px 14px; border: 1px solid #d1d5db; border-radius: 8px;
      font-size: 14px; outline: none; font-family: inherit;
    }
    .rc-input-area input:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.1); }
    .rc-input-area button {
      padding: 10px 14px; background: #6366f1; color: white; border: none;
      border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: 600;
    }
    .rc-input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
    .rc-footer { padding: 8px; text-align: center; border-top: 1px solid #f3f4f6; }
    .rc-footer a { color: #9ca3af; font-size: 11px; text-decoration: none; }
    .rc-footer a:hover { text-decoration: underline; }
    .rc-email-capture { background: #f9fafb; padding: 12px; border-radius: 8px; margin-bottom: 12px; }
    .rc-email-capture p { font-size: 13px; margin-bottom: 8px; color: #4b5563; }
    .rc-email-capture input { width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; margin-bottom: 6px; font-size: 13px; }
    .rc-email-capture button { width: 100%; padding: 8px; background: #6366f1; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
    @media (max-width: 480px) {
      .rc-panel { bottom: 0; right: 0; left: 0; top: 0; width: 100%; height: 100%; border-radius: 0;
        padding-bottom: env(safe-area-inset-bottom); }
    }
    @media (prefers-reduced-motion: reduce) {
      .rc-panel, .rc-bubble { transition: none !important; animation: none !important; }
    }
  `
}

function mount(container: HTMLElement, config: WidgetConfig, shadow: ShadowRoot) {
  let visible = true
  const onClose = () => {
    visible = false
    const panel = shadow.querySelector('.rc-panel') as HTMLElement
    if (panel) panel.style.display = 'none'
  }
  render(<ChatPanel config={config} onClose={onClose} />, container)
}

;(window as any).RubyCrawlWidget = { mount, getStyles }
```

### Validation Assertions

- **VAL-WIDGET-004**: Click bubble loads widget-full.js lazily, opens panel
- **VAL-WIDGET-005**: Conversation persists across close/reopen
- **VAL-WIDGET-006**: User message renders immediately, input clears
- **VAL-WIDGET-007**: Streaming response renders progressively
- **VAL-WIDGET-008**: Email capture prompt appears after 3 messages
- **VAL-WIDGET-009**: Shadow DOM prevents host CSS leaking into widget
- **VAL-WIDGET-010**: Mobile full-screen at <=480px
- **VAL-WIDGET-011**: Site not ready = bubble hidden

---

## Feature 3: Lead Capture API

### `src/app/api/leads/route.ts`

```typescript
import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkRateLimit } from '@/lib/chat/rate-limit'
import { corsHeaders, handleCorsPreFlight } from '@/lib/chat/cors'

export async function OPTIONS() {
  return handleCorsPreFlight()
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders })
    }

    const { site_key, email, name, message, source_page, conversation_id, website } = body as {
      site_key?: string; email?: string; name?: string; message?: string
      source_page?: string; conversation_id?: string; website?: string
    }

    // Honeypot check — if filled, silently accept but don't store
    if (website && typeof website === 'string' && website.trim().length > 0) {
      return Response.json({ success: true }, { headers: corsHeaders })
    }

    // Validate site_key
    if (!site_key || typeof site_key !== 'string') {
      return Response.json({ error: 'site_key is required' }, { status: 400, headers: corsHeaders })
    }

    // Validate email
    if (!email || typeof email !== 'string') {
      return Response.json({ error: 'email is required' }, { status: 400, headers: corsHeaders })
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return Response.json({ error: 'Invalid email format' }, { status: 400, headers: corsHeaders })
    }

    // Rate limit
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const rateCheck = checkRateLimit(`lead:${ip}`)
    if (!rateCheck.allowed) {
      return Response.json({ error: 'Too many requests' }, { status: 429, headers: corsHeaders })
    }

    // Look up site
    const supabase = createServiceClient()
    const { data: site } = await supabase
      .from('sites')
      .select('id')
      .eq('site_key', site_key)
      .maybeSingle()

    if (!site) {
      return Response.json({ error: 'Invalid site key' }, { status: 404, headers: corsHeaders })
    }

    // Upsert lead (deduplicate by site_id + email)
    const { error: upsertError } = await supabase
      .from('leads')
      .upsert(
        {
          site_id: site.id,
          email: email.trim().toLowerCase(),
          name: name?.trim() || null,
          message: message?.trim() || null,
          source_page: source_page || null,
          conversation_id: conversation_id || null,
        },
        { onConflict: 'site_id,email' }
      )

    if (upsertError) {
      console.error('Lead upsert error:', upsertError)
      return Response.json({ error: 'Failed to save lead' }, { status: 500, headers: corsHeaders })
    }

    return Response.json({ success: true }, { status: 201, headers: corsHeaders })
  } catch (err) {
    console.error('Lead capture error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders })
  }
}
```

### `src/app/api/leads/export/route.ts`

```typescript
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Get user's site
  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!site) {
    return new Response('No site found', { status: 404 })
  }

  // Get leads
  const { data: leads } = await supabase
    .from('leads')
    .select('name, email, message, source_page, created_at')
    .eq('site_id', site.id)
    .order('created_at', { ascending: false })

  // Build CSV
  const headers = ['Name', 'Email', 'Message', 'Source Page', 'Date']
  const rows = (leads || []).map(l => [
    escapeCSV(l.name || ''),
    escapeCSV(l.email),
    escapeCSV(l.message || ''),
    escapeCSV(l.source_page || ''),
    escapeCSV(l.created_at ? new Date(l.created_at).toLocaleDateString() : ''),
  ].join(','))

  const csv = [headers.join(','), ...rows].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="leads.csv"',
    },
  })
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
```

### Validation Assertions

- **VAL-LEAD-001**: Valid lead with all fields returns 201
- **VAL-LEAD-002**: Minimal fields (email + site_key) accepted
- **VAL-LEAD-003**: Invalid email returns 400
- **VAL-LEAD-004**: Missing site_key returns 400
- **VAL-LEAD-005**: Public endpoint (no auth cookies needed)
- **VAL-LEAD-006**: Duplicate email upserts gracefully
- **VAL-LEAD-007**: Honeypot filled = 200 but no row
- **VAL-LEAD-008**: Rate limiting on rapid submissions

---

## Verification

```bash
# Install widget deps
cd widget && pnpm install && pnpm build && cd ..

# Check sizes
ls -la widget/dist/
gzip -c widget/dist/rubycrawl-loader.js | wc -c  # should be < 5120
gzip -c widget/dist/rubycrawl-widget.js | wc -c  # should be < 30720

# Copy to public
cp widget/dist/* public/

# Run tests
pnpm vitest run
pnpm run typecheck
pnpm run lint

# Test leads API
curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  -d '{"site_key":"YOUR_KEY","email":"test@example.com","name":"Test"}'
# Expected: 201

curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  -d '{"site_key":"YOUR_KEY","email":"notanemail"}'
# Expected: 400

# Open test-widget.html in browser and verify bubble + chat
```

---

## Final Checklist

- [ ] widget/ directory with separate package.json
- [ ] Loader < 5KB gzipped, widget < 30KB gzipped
- [ ] Shadow DOM isolates styles
- [ ] Chat bubble appears when site ready, hidden when not
- [ ] Panel opens on click with dialog element
- [ ] Messages stream progressively
- [ ] Conversation preserved across close/reopen
- [ ] Email capture after 3 messages
- [ ] Lead capture API with honeypot + rate limiting + upsert
- [ ] CSV export works
- [ ] Mobile full-screen at 480px
- [ ] All tests pass, typecheck clean, lint clean
- [ ] Commit all changes
