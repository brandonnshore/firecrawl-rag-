import { render } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'
import {
  parseStream,
  buildShowFormPayload,
  PENDING_ACTION_SENTINEL,
  type PendingAction,
} from './escalation-protocol'

interface WidgetConfig {
  siteKey: string
  apiBase: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// Match http(s) URLs in assistant messages so the LLM's Calendly / Google
// Maps / plain link text renders as a real clickable anchor in the chat
// bubble. Stops at whitespace and common HTML delimiters.
const URL_REGEX = /(https?:\/\/[^\s<>"')]+)/g

function renderWithLinks(text: string) {
  const parts = text.split(URL_REGEX)
  return parts.map((part, i) =>
    // split() with a capturing group alternates: even indices = text,
    // odd indices = captured URL.
    i % 2 === 1 ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        class="rc-msg-link"
      >
        {part}
      </a>
    ) : (
      part
    )
  )
}

declare global {
  interface Window {
    RubyCrawlWidget?: {
      mount: (
        container: HTMLElement,
        config: WidgetConfig,
        shadow: ShadowRoot
      ) => void
      getStyles: () => string
    }
  }
}

const GREETING = 'Hi! How can I help you today?'

function ChatPanel({
  config,
  onClose,
}: {
  config: WidgetConfig
  onClose: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: GREETING },
  ])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [actionComplete, setActionComplete] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Plain div + CSS positioning. We used to render a <dialog> and
    // call showModal(), but dialog + shadow DOM is fragile (top-layer
    // semantics inside a shadow root are inconsistent across browsers)
    // and showModal gives us a full-viewport modal backdrop we don't
    // want for a corner chat bubble. The .rc-panel CSS already pins
    // bottom-right; just focus the input.
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingAction])

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return

    const userMessage = input.trim()
    setInput('')

    const updatedMessages: Message[] = [
      ...messages,
      { role: 'user', content: userMessage },
    ]
    setMessages(updatedMessages)
    setIsStreaming(true)
    // Dismiss any lingering action when the user keeps typing — a fresh
    // escalation comes with the next server response.
    setPendingAction(null)
    setActionComplete(false)

    try {
      const sessionRes = await fetch(`${config.apiBase}/api/chat/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: updatedMessages
            .slice(0, -1)
            .filter((m) => m.content !== GREETING),
          site_key: config.siteKey,
        }),
      })

      if (!sessionRes.ok) {
        throw new Error(`Session failed: ${sessionRes.status}`)
      }

      const { sessionId } = (await sessionRes.json()) as { sessionId: string }

      const streamRes = await fetch(
        `${config.apiBase}/api/chat/stream?sid=${sessionId}`
      )

      if (!streamRes.ok || !streamRes.body) {
        throw new Error(`Stream failed: ${streamRes.status}`)
      }

      const reader = streamRes.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // As long as no sentinel has arrived, everything so far is
        // chat text. Once the sentinel appears, split and stop updating
        // the visible text (the trailer is invisible metadata).
        const sentinelIdx = buffer.indexOf(PENDING_ACTION_SENTINEL)
        const visible =
          sentinelIdx >= 0 ? buffer.slice(0, sentinelIdx) : buffer
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant',
            content: visible,
          }
          return updated
        })
      }
      buffer += decoder.decode()

      const { pendingAction: parsed } = parseStream(buffer)
      if (parsed) setPendingAction(parsed)
    } catch (err) {
      console.error('[RubyCrawl] Chat error:', err)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
        },
      ])
    } finally {
      setIsStreaming(false)
    }
  }

  const postLead = async (payload: Record<string, unknown>) => {
    try {
      const res = await fetch(`${config.apiBase}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_key: config.siteKey,
          source: 'escalation',
          source_page: window.location.href,
          ...payload,
        }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  const handleActionSubmit = async (
    confirmation: string,
    payload: Record<string, unknown>
  ) => {
    const ok = await postLead(payload)
    setActionComplete(true)
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: ok
          ? confirmation
          : 'Thanks — we caught that.',
      },
    ])
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div
      ref={panelRef}
      class="rc-panel"
      role="dialog"
      aria-label="Chat with us"
      aria-modal="false"
      onKeyDown={handleKeyDown}
    >
      <div class="rc-header">
        <span>Chat with us</span>
        <button class="rc-close" onClick={onClose} aria-label="Close chat">
          &times;
        </button>
      </div>
      <div class="rc-messages" role="log" aria-live="polite">
        {messages.map((msg, i) => (
          <div key={i} class={`rc-msg rc-msg-${msg.role}`}>
            {msg.content
              ? renderWithLinks(msg.content)
              : isStreaming && i === messages.length - 1
                ? '...'
                : ''}
          </div>
        ))}
        {pendingAction && !actionComplete && (
          <EscalationView
            action={pendingAction}
            onSubmit={handleActionSubmit}
          />
        )}
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
          ref={inputRef}
          type="text"
          value={input}
          onInput={(e) => setInput((e.target as HTMLInputElement).value)}
          placeholder="Ask a question..."
          disabled={isStreaming}
          maxLength={500}
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          aria-label="Send message"
        >
          ↑
        </button>
      </form>
      <div class="rc-footer">
        <a href="https://rubycrawl.com" target="_blank" rel="noopener noreferrer">
          Powered by RubyCrawl
        </a>
      </div>
    </div>
  )
}

export function EscalationView({
  action,
  onSubmit,
}: {
  action: PendingAction
  onSubmit: (
    confirmation: string,
    payload: Record<string, unknown>
  ) => void | Promise<void>
}) {
  if (action.action === 'ask_email') {
    return <AskEmailForm onSubmit={onSubmit} />
  }
  if (action.action === 'ask_phone') {
    return <AskPhoneForm onSubmit={onSubmit} />
  }
  if (action.action === 'show_form') {
    const fields = Array.isArray(action.action_config.fields)
      ? (action.action_config.fields as string[])
      : []
    return <ShowForm fields={fields} onSubmit={onSubmit} />
  }
  if (action.action === 'calendly_link') {
    const url = String(action.action_config.url ?? '')
    return <CalendlyEmbed url={url} />
  }
  if (action.action === 'handoff') {
    return <HandoffIndicator />
  }
  return null
}

function AskEmailForm({
  onSubmit,
}: {
  onSubmit: (
    confirmation: string,
    payload: Record<string, unknown>
  ) => void | Promise<void>
}) {
  const [email, setEmail] = useState('')
  return (
    <div class="rc-escalation rc-escalation-email" data-testid="rc-ask-email">
      <p>Want us to follow up? Leave your email:</p>
      <input
        type="email"
        placeholder="your@email.com"
        value={email}
        onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
        required
      />
      <button
        type="button"
        onClick={() =>
          email && onSubmit(`Thanks! We'll be in touch at ${email}.`, { email })
        }
      >
        Send
      </button>
    </div>
  )
}

function AskPhoneForm({
  onSubmit,
}: {
  onSubmit: (
    confirmation: string,
    payload: Record<string, unknown>
  ) => void | Promise<void>
}) {
  const [phone, setPhone] = useState('')
  return (
    <div class="rc-escalation rc-escalation-phone" data-testid="rc-ask-phone">
      <p>Prefer a call? Leave your number:</p>
      <input
        type="tel"
        placeholder="+1 (555) 012-3456"
        value={phone}
        onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
      />
      <button
        type="button"
        onClick={() =>
          phone &&
          onSubmit(`Got it — we'll call you at ${phone}.`, { phone })
        }
      >
        Request Call
      </button>
    </div>
  )
}

function ShowForm({
  fields,
  onSubmit,
}: {
  fields: string[]
  onSubmit: (
    confirmation: string,
    payload: Record<string, unknown>
  ) => void | Promise<void>
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  if (fields.length === 0) return null
  return (
    <div class="rc-escalation rc-escalation-form" data-testid="rc-show-form">
      <p>A few quick questions:</p>
      {fields.map((f) => (
        <input
          key={f}
          type={f.toLowerCase() === 'email' ? 'email' : 'text'}
          placeholder={f}
          value={values[f] ?? ''}
          onInput={(e) =>
            setValues((prev) => ({
              ...prev,
              [f]: (e.target as HTMLInputElement).value,
            }))
          }
        />
      ))}
      <button
        type="button"
        onClick={() =>
          onSubmit('Thanks — we have your info.', buildShowFormPayload(values))
        }
      >
        Submit
      </button>
    </div>
  )
}

function CalendlyEmbed({ url }: { url: string }) {
  if (!url || !/^https?:\/\//.test(url)) return null
  return (
    <div
      class="rc-escalation rc-escalation-calendly"
      data-testid="rc-calendly"
    >
      <iframe
        src={url}
        title="Book a time"
        style={{ width: '100%', height: '600px', border: 0 }}
      />
    </div>
  )
}

function HandoffIndicator() {
  return (
    <div
      class="rc-escalation rc-escalation-handoff"
      role="status"
      data-testid="rc-handoff"
    >
      <span class="rc-handoff-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>A team member will be with you shortly.</span>
    </div>
  )
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
    .rc-msg-link { color: inherit; text-decoration: underline; text-underline-offset: 2px; word-break: break-all; }
    .rc-msg-user .rc-msg-link { color: #ffffff; }
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
    .rc-escalation {
      background: #f9fafb; padding: 12px; border-radius: 8px;
      margin-bottom: 12px; border: 1px solid #e5e7eb;
    }
    .rc-escalation p { font-size: 13px; margin: 0 0 8px; color: #4b5563; }
    .rc-escalation input {
      width: 100%; padding: 8px 10px; border: 1px solid #d1d5db;
      border-radius: 6px; margin-bottom: 6px; font-size: 13px;
      font-family: inherit; box-sizing: border-box;
    }
    .rc-escalation button {
      width: 100%; padding: 8px; background: #6366f1; color: white;
      border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
      font-weight: 500;
    }
    .rc-escalation button:disabled { opacity: 0.5; cursor: not-allowed; }
    .rc-escalation-calendly { padding: 0; overflow: hidden; }
    .rc-escalation-handoff {
      display: flex; align-items: center; gap: 10px;
      background: #eef2ff; border-color: #c7d2fe; color: #4338ca;
    }
    .rc-handoff-dots { display: inline-flex; gap: 4px; }
    .rc-handoff-dots span {
      width: 6px; height: 6px; border-radius: 50%; background: #6366f1;
      animation: rc-handoff-pulse 1.2s infinite ease-in-out;
    }
    .rc-handoff-dots span:nth-child(2) { animation-delay: 0.2s; }
    .rc-handoff-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes rc-handoff-pulse {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }
    @media (max-width: 480px) {
      .rc-panel { bottom: 0; right: 0; left: 0; top: 0; width: 100%; height: 100%; border-radius: 0;
        padding-bottom: env(safe-area-inset-bottom); }
    }
    @media (prefers-reduced-motion: reduce) {
      .rc-panel, .rc-bubble, .rc-handoff-dots span { transition: none !important; animation: none !important; }
    }
  `
}

export function mount(
  container: HTMLElement,
  config: WidgetConfig,
  shadow: ShadowRoot
) {
  const onClose = () => {
    const panel = shadow.querySelector('.rc-panel') as HTMLElement | null
    if (panel) panel.style.display = 'none'
  }
  render(<ChatPanel config={config} onClose={onClose} />, container)
}

// Keep getStyles as a named export so Vite's IIFE lib build attaches
// it to window.RubyCrawlWidget alongside mount. The old approach of
// assigning `window.RubyCrawlWidget = { mount, getStyles }` after the
// IIFE set up exports got clobbered: Vite's lib IIFE returns a module
// object containing only named exports, and that return value is what
// the `name` config assigns to window — overwriting our manual set
// with `{ EscalationView }` only, causing `getStyles is not a function`.
export { getStyles }
