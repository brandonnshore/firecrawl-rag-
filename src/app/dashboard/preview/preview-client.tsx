'use client'

import { useState, useRef, useEffect } from 'react'

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
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="mb-2 text-2xl font-bold">Preview your chatbot</h1>
      <p className="mb-6 text-zinc-500">
        Test your chatbot before adding it to your website.
      </p>

      {messages.length <= 1 && suggestedQuestions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {suggestedQuestions.map((q, i) => (
            <button
              key={i}
              onClick={() => sendMessage(q)}
              className="rounded-full border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
        <div className="h-96 space-y-3 overflow-y-auto bg-white p-4 dark:bg-zinc-900">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-indigo-500 text-white'
                    : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
                }`}
              >
                {msg.content || '...'}
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
          className="flex border-t border-zinc-200 dark:border-zinc-700"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            disabled={isStreaming}
            className="flex-1 bg-transparent px-4 py-3 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="px-4 text-sm font-medium text-indigo-500 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>

      <div className="mt-6 text-center">
        <a
          href="/dashboard/embed"
          className="inline-block rounded-lg bg-indigo-500 px-6 py-3 font-medium text-white hover:bg-indigo-600"
        >
          Love it? Add it to your website →
        </a>
      </div>
    </div>
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

  if (suggestions.length === 0) {
    suggestions.push('Tell me about your business')
  }

  return suggestions.slice(0, 3)
}
