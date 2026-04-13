# Preact + Vite IIFE Widget Build

> **Packages:** `preact`, `@preactjs/preset-vite`, `vite`
> **Pattern:** Two-file lazy loader + Shadow DOM + IIFE bundle
> **References:** https://preactjs.com | https://vite.dev/config/build-options#build-lib | https://www.viget.com/articles/embedable-web-applications-with-shadow-dom
> **Last verified:** 2026-04-13

## Overview

The RubyCrawl widget uses a two-file architecture:
1. **Loader script** (~1-2KB) — Tiny IIFE that renders the chat bubble and lazy-loads the main widget
2. **Main widget** (~15-30KB) — Full Preact app with chat UI, loaded only when user clicks the bubble

Both files are built as IIFE bundles using Vite's library mode with the Preact preset.

---

## Install

```bash
npm install preact
npm install -D vite @preactjs/preset-vite
```

---

## Vite Config for IIFE Output

### `widget/vite.config.ts` — Loader Script

```typescript
import { defineConfig } from 'vite'
import preact from '@preactjs/preset-vite'

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: 'src/loader.tsx',
      name: 'RubyCrawl',          // Global variable name: window.RubyCrawl
      formats: ['iife'],           // Single IIFE file, no ES modules
      fileName: () => 'rubycrawl-loader.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'terser',              // or 'oxc' in Vite 6+
    rollupOptions: {
      output: {
        // Ensure all CSS is inlined (no separate CSS file)
        assetFileNames: 'rubycrawl-[name].[ext]',
      },
    },
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})
```

### `widget/vite.widget.config.ts` — Main Widget Bundle

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
    emptyOutDir: false,            // Don't delete loader output
    minify: 'terser',
    cssCodeSplit: false,           // Inline all CSS into the JS bundle
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})
```

### Build Scripts (`package.json`)

```json
{
  "scripts": {
    "build:loader": "vite build --config vite.config.ts",
    "build:widget": "vite build --config vite.widget.config.ts",
    "build": "npm run build:loader && npm run build:widget",
    "dev": "vite --config vite.config.ts"
  }
}
```

---

## Shadow DOM Pattern

Shadow DOM provides CSS isolation — the widget's styles won't leak into the host site, and the host's styles won't affect the widget.

### Creating the Shadow Root

```typescript
// src/loader.tsx
import { h, render } from 'preact'

interface RubyCrawlConfig {
  siteKey: string
  position?: 'bottom-right' | 'bottom-left'
  primaryColor?: string
}

function init(config: RubyCrawlConfig) {
  // Create container element
  const container = document.createElement('div')
  container.id = 'rubycrawl-root'
  document.body.appendChild(container)

  // Attach shadow DOM for style isolation
  const shadowRoot = container.attachShadow({ mode: 'open' })

  // Inject base styles into shadow root
  const styleEl = document.createElement('style')
  styleEl.textContent = getBubbleStyles(config)
  shadowRoot.appendChild(styleEl)

  // Create mount point inside shadow root
  const mountPoint = document.createElement('div')
  mountPoint.id = 'rubycrawl-mount'
  shadowRoot.appendChild(mountPoint)

  // Render the bubble (tiny, always visible)
  render(
    <ChatBubble config={config} shadowRoot={shadowRoot} />,
    mountPoint
  )
}

// Expose globally
;(window as any).RubyCrawl = { init }
```

### Injecting Styles into Shadow Root

```typescript
function getBubbleStyles(config: RubyCrawlConfig): string {
  const color = config.primaryColor || '#6366f1'
  const position = config.position || 'bottom-right'
  const positionCSS = position === 'bottom-right'
    ? 'right: 20px;'
    : 'left: 20px;'

  return `
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .rc-bubble {
      position: fixed;
      bottom: 20px;
      ${positionCSS}
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: ${color};
      color: white;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 999999;
      transition: transform 0.2s ease;
    }

    .rc-bubble:hover {
      transform: scale(1.1);
    }

    .rc-panel {
      position: fixed;
      bottom: 90px;
      ${positionCSS}
      width: 380px;
      height: 520px;
      border-radius: 12px;
      background: white;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
      z-index: 999998;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
  `
}
```

---

## Two-File Lazy Loading Architecture

### File 1: Loader (`src/loader.tsx`) — ~1-2KB gzipped

The loader renders only the chat bubble. When clicked, it dynamically imports the full widget.

```typescript
import { h, render, Component } from 'preact'

interface ChatBubbleProps {
  config: RubyCrawlConfig
  shadowRoot: ShadowRoot
}

interface ChatBubbleState {
  isOpen: boolean
  widgetLoaded: boolean
}

class ChatBubble extends Component<ChatBubbleProps, ChatBubbleState> {
  state = { isOpen: false, widgetLoaded: false }

  handleClick = async () => {
    const { isOpen, widgetLoaded } = this.state

    if (!widgetLoaded) {
      // Lazy load the full widget on first click
      await this.loadWidget()
    }

    this.setState({ isOpen: !isOpen })
  }

  loadWidget = async () => {
    try {
      // Dynamically load the widget script
      const widgetUrl = this.getWidgetUrl()
      const script = document.createElement('script')
      script.src = widgetUrl
      script.onload = () => {
        this.setState({ widgetLoaded: true })
        // Mount the widget into the shadow DOM
        const panelEl = document.createElement('div')
        panelEl.id = 'rubycrawl-panel'
        this.props.shadowRoot.appendChild(panelEl)

        // Inject widget styles into same shadow root
        const widgetStyles = (window as any).RubyCrawlWidget?.getStyles?.()
        if (widgetStyles) {
          const style = document.createElement('style')
          style.textContent = widgetStyles
          this.props.shadowRoot.appendChild(style)
        }

        ;(window as any).RubyCrawlWidget?.mount(
          panelEl,
          this.props.config,
          this.props.shadowRoot
        )
      }
      document.head.appendChild(script)
    } catch (err) {
      console.error('[RubyCrawl] Failed to load widget:', err)
    }
  }

  getWidgetUrl(): string {
    // Derive widget URL from the loader script's location
    const scripts = document.querySelectorAll('script[src*="rubycrawl"]')
    const loaderScript = scripts[scripts.length - 1] as HTMLScriptElement
    const baseUrl = loaderScript?.src?.replace(/\/[^/]*$/, '') || ''
    return `${baseUrl}/rubycrawl-widget.js`
  }

  render() {
    const { isOpen } = this.state

    return (
      <div>
        <button
          class="rc-bubble"
          onClick={this.handleClick}
          aria-label={isOpen ? 'Close chat' : 'Open chat'}
          aria-expanded={isOpen}
        >
          {isOpen ? '✕' : '💬'}
        </button>
      </div>
    )
  }
}
```

### File 2: Widget (`src/widget.tsx`) — ~15-30KB gzipped

The full chat panel with message list, input, streaming, etc.

```typescript
import { h, render, Component } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'

interface WidgetConfig {
  siteKey: string
  primaryColor?: string
}

function ChatPanel({ config, shadowRoot }: { config: WidgetConfig; shadowRoot: ShadowRoot }) {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsStreaming(true)

    try {
      // Step 1: POST to create/extend session
      const res = await fetch('https://app.rubycrawl.com/api/public/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteKey: config.siteKey,
          message: userMessage,
          sessionId,
        }),
      })
      const { sessionId: sid } = await res.json()
      setSessionId(sid)

      // Step 2: GET the SSE stream
      const streamRes = await fetch(
        `https://app.rubycrawl.com/api/public/chat/${sid}/stream`
      )

      const reader = streamRes.body!.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      // Add empty assistant message for streaming
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: fullText }
          return updated
        })
      }
    } catch (err) {
      console.error('[RubyCrawl] Chat error:', err)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ])
    } finally {
      setIsStreaming(false)
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div class="rc-panel">
      <div class="rc-header">
        <span>Chat with us</span>
      </div>
      <div class="rc-messages">
        {messages.map((msg, i) => (
          <div key={i} class={`rc-msg rc-msg-${msg.role}`}>
            {msg.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form
        class="rc-input-area"
        onSubmit={(e) => {
          e.preventDefault()
          sendMessage()
        }}
      >
        <input
          type="text"
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          placeholder="Ask a question..."
          disabled={isStreaming}
        />
        <button type="submit" disabled={isStreaming || !input.trim()}>
          Send
        </button>
      </form>
      <div class="rc-footer">
        <small>By chatting, you agree to our privacy policy</small>
      </div>
    </div>
  )
}

// Export mount function for the loader to call
function mount(container: HTMLElement, config: WidgetConfig, shadowRoot: ShadowRoot) {
  render(<ChatPanel config={config} shadowRoot={shadowRoot} />, container)
}

function getStyles(): string {
  return `
    .rc-header {
      padding: 16px;
      font-weight: 600;
      border-bottom: 1px solid #e5e7eb;
    }
    .rc-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    .rc-msg {
      margin-bottom: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 85%;
      line-height: 1.5;
      font-size: 14px;
    }
    .rc-msg-user {
      background: #6366f1;
      color: white;
      margin-left: auto;
    }
    .rc-msg-assistant {
      background: #f3f4f6;
      color: #1f2937;
    }
    .rc-input-area {
      display: flex;
      padding: 12px;
      border-top: 1px solid #e5e7eb;
      gap: 8px;
    }
    .rc-input-area input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
    }
    .rc-input-area input:focus {
      border-color: #6366f1;
    }
    .rc-input-area button {
      padding: 8px 16px;
      background: #6366f1;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    }
    .rc-input-area button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .rc-footer {
      padding: 8px;
      text-align: center;
      color: #9ca3af;
      font-size: 11px;
    }
  `
}

// Expose to window for loader to call
;(window as any).RubyCrawlWidget = { mount, getStyles }
```

---

## Customer Embed Code

What customers paste into their website:

```html
<!-- RubyCrawl Chat Widget -->
<script
  src="https://cdn.rubycrawl.com/widget/rubycrawl-loader.js"
  defer
></script>
<script>
  document.addEventListener('DOMContentLoaded', function() {
    RubyCrawl.init({
      siteKey: 'YOUR_SITE_KEY_HERE',
      position: 'bottom-right',
      primaryColor: '#6366f1',
    });
  });
</script>
```

---

## Alternative: `adoptedStyleSheets` for Modern Browsers

Instead of injecting `<style>` tags, use `adoptedStyleSheets` for better performance:

```typescript
const sheet = new CSSStyleSheet()
sheet.replaceSync(cssText)
shadowRoot.adoptedStyleSheets = [sheet]
```

> **Browser support:** Chrome 73+, Firefox 101+, Safari 16.4+. Good enough for modern browsers, but no IE11 support (not needed for RubyCrawl target audience).

---

## Key Gotchas

1. **Preact size advantage**: Preact is ~3KB gzipped vs React's ~45KB. Critical for an embeddable widget.
2. **`@preactjs/preset-vite`** handles all the React → Preact aliasing (`react` → `preact/compat`, JSX pragma, etc.).
3. **Shadow DOM fonts**: Fonts defined in the host page are NOT inherited into shadow DOM. Either use system fonts or inject a `@font-face` declaration into the shadow root.
4. **Shadow DOM events**: Events from inside shadow DOM are retargeted. The `event.target` changes when crossing the shadow boundary.
5. **No `document.querySelector` inside shadow**: Use `shadowRoot.querySelector` instead.
6. **IIFE format limitations**: No tree-shaking. The entire bundle is included. Keep the widget lean.
7. **z-index**: Use very high z-index (999999) for the widget to ensure it appears above the host page's content.
8. **CSS reset in shadow root**: Always include a CSS reset inside the shadow root since the host page's reset styles don't apply.
9. **Vite `cssCodeSplit: false`**: Essential for IIFE — ensures CSS is inlined into the JS bundle rather than output as a separate file.
10. **`emptyOutDir: false`** on the second build config: Prevents deleting the loader output when building the widget.
