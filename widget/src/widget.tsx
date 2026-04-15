import { render } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'

interface WidgetConfig {
  siteKey: string
  apiBase: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
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
  const [showEmailCapture, setShowEmailCapture] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messageCount = useRef(0)

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

    const updatedMessages: Message[] = [
      ...messages,
      { role: 'user', content: userMessage },
    ]
    setMessages(updatedMessages)
    setIsStreaming(true)

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
      let fullText = ''

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant',
            content: fullText,
          }
          return updated
        })
      }

      if (messageCount.current >= 3 && !emailSent) {
        setShowEmailCapture(true)
      }
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
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Thanks ${name || ''}! We'll be in touch at ${email}.`,
        },
      ])
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
        <button class="rc-close" onClick={onClose} aria-label="Close chat">
          &times;
        </button>
      </div>
      <div class="rc-messages" role="log" aria-live="polite">
        {messages.map((msg, i) => (
          <div key={i} class={`rc-msg rc-msg-${msg.role}`}>
            {msg.content ||
              (isStreaming && i === messages.length - 1 ? '...' : '')}
          </div>
        ))}
        {showEmailCapture && !emailSent && (
          <EmailCapture onSubmit={handleEmailSubmit} />
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
    </dialog>
  )
}

function EmailCapture({
  onSubmit,
}: {
  onSubmit: (email: string, name: string) => void
}) {
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
      <input
        type="text"
        name="website"
        style={{ display: 'none' }}
        tabIndex={-1}
        autoComplete="off"
      />
      <button onClick={() => email && onSubmit(email, name)}>Send</button>
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

function mount(
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

window.RubyCrawlWidget = { mount, getStyles }
