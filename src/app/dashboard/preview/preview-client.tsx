'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { IconArrowRight, IconSend, IconSpinner } from '@/components/icons'

interface Site {
  id: string
  site_key: string
  url: string
  name: string | null
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function PreviewClient({
  site,
  sampleChunks,
}: {
  site: Site
  sampleChunks: Array<{ chunk_text: string; source_url: string }>
}) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! How can I help you today?' },
  ])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)

  const suggestedQuestions = generateSuggestions(sampleChunks)

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return
    setInput('')
    const userMsg: Message = { role: 'user', content: text.trim() }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setIsStreaming(true)

    try {
      const sessionRes = await fetch('/api/chat/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          history: updated.slice(1, -1),
          site_key: site.site_key,
        }),
      })
      if (!sessionRes.ok) throw new Error('Session failed')
      const { sessionId } = (await sessionRes.json()) as { sessionId: string }

      const streamRes = await fetch(`/api/chat/stream?sid=${sessionId}`)
      if (!streamRes.ok || !streamRes.body) throw new Error('Stream failed')

      const reader = streamRes.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        fullText += decoder.decode(value, { stream: true })
        setMessages((prev) => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: 'assistant', content: fullText }
          return copy
        })
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Something went wrong. Please try again.',
        },
      ])
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <div className="rc-enter">
      <header className="mb-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Preview
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Test your chatbot.
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[color:var(--ink-secondary)]">
          Talk to it as a visitor would. Uses the same API your widget will.
        </p>
      </header>

      {messages.length <= 1 && suggestedQuestions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {suggestedQuestions.map((q, i) => (
            <button
              key={i}
              onClick={() => sendMessage(q)}
              className="btn-press focus-ring rc-enter rounded-full border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-1.5 text-xs text-[color:var(--ink-secondary)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--ink-primary)]"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="surface-hairline overflow-hidden rounded-xl">
        <div className="flex h-[28rem] flex-col gap-3 overflow-y-auto bg-[color:var(--bg-surface)] p-5">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex rc-enter ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              style={{ animationDelay: `${Math.min(i * 20, 120)}ms` }}
            >
              <div
                className={`max-w-[78%] rounded-xl px-3.5 py-2 text-[14px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[color:var(--ink-primary)] text-[color:var(--bg-surface)]'
                    : 'bg-[color:var(--bg-subtle)] text-[color:var(--ink-primary)]'
                }`}
              >
                {msg.content || (
                  <span className="inline-flex gap-0.5">
                    <Dot />
                    <Dot delay={120} />
                    <Dot delay={240} />
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEnd} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendMessage(input)
          }}
          className="flex items-center gap-2 border-t border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2.5"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question…"
            disabled={isStreaming}
            className="focus-ring flex-1 bg-transparent px-2 py-1.5 text-[14px] text-[color:var(--ink-primary)] placeholder:text-[color:var(--ink-tertiary)] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            aria-label="Send"
            className="btn-press focus-ring flex h-8 w-8 items-center justify-center rounded-md bg-[color:var(--ink-primary)] text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isStreaming ? (
              <IconSpinner width={13} height={13} />
            ) : (
              <IconSend width={13} height={13} />
            )}
          </button>
        </form>
      </div>

      <div className="mt-8 flex items-center justify-between border-t border-[color:var(--border-hairline)] pt-6">
        <p className="text-sm text-[color:var(--ink-secondary)]">
          Happy with it?
        </p>
        <Link
          href="/dashboard/embed"
          className="btn-press focus-ring group inline-flex items-center gap-2 rounded-lg bg-[color:var(--ink-primary)] px-4 py-2 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)]"
        >
          <span>Add it to your website</span>
          <IconArrowRight
            width={14}
            height={14}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </Link>
      </div>
    </div>
  )
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--ink-tertiary)] rc-pulse"
      style={{ animationDelay: `${delay}ms` }}
    />
  )
}

function generateSuggestions(
  chunks: Array<{ chunk_text: string; source_url: string }>
): string[] {
  if (chunks.length === 0) return []
  const suggestions: string[] = []
  const topics = new Set<string>()
  for (const chunk of chunks) {
    const text = chunk.chunk_text.toLowerCase()
    if (
      !topics.has('services') &&
      (text.includes('service') ||
        text.includes('offer') ||
        text.includes('provide'))
    ) {
      suggestions.push('What services do you offer?')
      topics.add('services')
    }
    if (
      !topics.has('hours') &&
      (text.includes('hour') ||
        text.includes('open') ||
        text.includes('schedule'))
    ) {
      suggestions.push('What are your hours?')
      topics.add('hours')
    }
    if (
      !topics.has('contact') &&
      (text.includes('contact') ||
        text.includes('phone') ||
        text.includes('email') ||
        text.includes('address'))
    ) {
      suggestions.push('How can I contact you?')
      topics.add('contact')
    }
    if (
      !topics.has('pricing') &&
      (text.includes('price') ||
        text.includes('cost') ||
        text.includes('rate') ||
        text.includes('fee'))
    ) {
      suggestions.push('What are your prices?')
      topics.add('pricing')
    }
    if (
      !topics.has('area') &&
      (text.includes('area') ||
        text.includes('serve') ||
        text.includes('location') ||
        text.includes('region'))
    ) {
      suggestions.push('What areas do you serve?')
      topics.add('area')
    }
    if (suggestions.length >= 3) break
  }
  if (suggestions.length === 0) suggestions.push('Tell me about your business')
  return suggestions.slice(0, 3)
}
