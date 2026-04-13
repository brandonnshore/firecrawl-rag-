# Vercel AI SDK for Streaming

> **Package:** `ai` (v6.x, AI SDK 6) + `@ai-sdk/openai`
> **Docs:** https://ai-sdk.dev/docs/ai-sdk-core/generating-text | https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
> **Last verified:** 2026-04-13

## Install

```bash
npm install ai @ai-sdk/openai @ai-sdk/react zod
```

## Environment Variables

```env
# .env.local
OPENAI_API_KEY=sk-...
```

> The `@ai-sdk/openai` provider uses the `OPENAI_API_KEY` env var by default.

---

## Core Concepts

The AI SDK has three layers:
1. **AI SDK Core** (`ai` package) — Server-side: `generateText`, `streamText`, `generateObject`
2. **AI SDK UI** (`@ai-sdk/react`) — Client-side hooks: `useChat`, `useCompletion`
3. **AI SDK RSC** — React Server Components integration (not needed for widget streaming)

---

## Server-Side: `streamText` in Route Handlers

### Basic Streaming Route Handler (`app/api/chat/route.ts`)

```typescript
import { streamText, UIMessage, convertToModelMessages } from 'ai'
import { openai } from '@ai-sdk/openai'

// Allow streaming responses up to 60 seconds
export const maxDuration = 60

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: openai('gpt-4o-mini'),
    messages: await convertToModelMessages(messages),
    system: 'You are a helpful assistant for a small business website.',
  })

  // Returns SSE stream using the UI Message Stream protocol
  return result.toUIMessageStreamResponse()
}
```

### Text-Only Streaming (Simpler, for Widget Use)

```typescript
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'

export async function POST(req: Request) {
  const { prompt } = await req.json()

  const result = streamText({
    model: openai('gpt-4o-mini'),
    prompt,
  })

  // Returns plain text stream (no structured protocol)
  return result.toTextStreamResponse()
}
```

---

## Client-Side: `useChat` Hook

### Dashboard Chat (UI Message Stream Protocol — default)

```tsx
'use client'

import { useChat } from '@ai-sdk/react'
import { useState } from 'react'

export default function ChatPreview() {
  const [input, setInput] = useState('')
  const { messages, sendMessage, isLoading } = useChat({
    api: '/api/chat', // default
  })

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          <strong>{msg.role}:</strong>
          {msg.parts.map((part, i) => {
            if (part.type === 'text') {
              return <span key={i}>{part.text}</span>
            }
            return null
          })}
        </div>
      ))}
      <form onSubmit={(e) => {
        e.preventDefault()
        sendMessage({ text: input })
        setInput('')
      }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" disabled={isLoading}>Send</button>
      </form>
    </div>
  )
}
```

### Text Stream Protocol (for simpler streaming)

```tsx
import { useChat } from '@ai-sdk/react'
import { TextStreamChatTransport } from 'ai'

const { messages, sendMessage } = useChat({
  transport: new TextStreamChatTransport({ api: '/api/chat' }),
})
```

---

## Two-Step Streaming Pattern (POST Session → GET SSE)

For the **embeddable widget** which makes cross-origin requests, a two-step pattern provides better compatibility:

### Step 1: POST to Create a Chat Session

```typescript
// POST /api/public/chat — creates session, returns session ID
import { createServiceClient } from '@/lib/supabase/service'
import { nanoid } from 'nanoid'

export async function POST(req: Request) {
  const { siteKey, message, sessionId: existingSessionId } = await req.json()

  // Validate site key
  const supabase = createServiceClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, user_id')
    .eq('site_key', siteKey)
    .single()

  if (!site) return new Response('Invalid site key', { status: 404 })

  const sessionId = existingSessionId || nanoid()

  // Store message in DB
  await supabase.from('chat_messages').insert({
    session_id: sessionId,
    site_id: site.id,
    role: 'user',
    content: message,
  })

  return Response.json({ sessionId })
}
```

### Step 2: GET SSE Stream

```typescript
// GET /api/public/chat/[sessionId]/stream — returns SSE stream
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'edge' // Deploy to Edge Runtime for 0ms cold start
export const maxDuration = 60

export async function GET(
  req: Request,
  { params }: { params: { sessionId: string } }
) {
  const supabase = createServiceClient()

  // Load conversation history
  const { data: messages } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', params.sessionId)
    .order('created_at', { ascending: true })

  // Load site context (RAG results)
  const lastMessage = messages?.[messages.length - 1]
  const context = await getRelevantContext(lastMessage?.content || '')

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: buildSystemPrompt(context),
    messages: messages?.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })) || [],
    temperature: 0,
    onFinish: async ({ text }) => {
      // Save assistant response
      await supabase.from('chat_messages').insert({
        session_id: params.sessionId,
        role: 'assistant',
        content: text,
      })
    },
  })

  return result.toTextStreamResponse()
}
```

### Widget-Side Consumption (Preact)

```typescript
// In the widget — consuming the two-step pattern
async function sendMessage(siteKey: string, message: string, sessionId?: string) {
  // Step 1: POST to create/extend session
  const res = await fetch('https://app.rubycrawl.com/api/public/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteKey, message, sessionId }),
  })
  const { sessionId: sid } = await res.json()

  // Step 2: GET the SSE stream
  const streamRes = await fetch(
    `https://app.rubycrawl.com/api/public/chat/${sid}/stream`
  )

  const reader = streamRes.body!.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    fullText += decoder.decode(value, { stream: true })
    // Update UI with fullText
  }

  return { sessionId: sid, response: fullText }
}
```

---

## Edge Runtime Configuration

For chat routes that need minimal latency:

```typescript
// At the top of route.ts
export const runtime = 'edge'   // 0ms cold start
export const maxDuration = 60   // seconds (Vercel Pro: up to 300s)
```

> **Note:** Edge Runtime has limitations: no Node.js APIs (fs, child_process), limited npm package support. The AI SDK and Supabase client work fine on Edge.

---

## `streamText` Options Reference

```typescript
const result = streamText({
  model: openai('gpt-4o-mini'),
  messages: [...],
  system: 'System prompt here',
  temperature: 0,           // 0 = deterministic (good for RAG)
  maxTokens: 1000,          // Max response tokens

  // Callbacks
  onChunk({ chunk }) {
    // Called for each stream chunk
  },
  onFinish({ text, finishReason, usage, response }) {
    // Called when stream completes
    // Perfect for saving to DB, analytics
  },
  onError({ error }) {
    // Called on stream errors
    console.error(error)
  },
})
```

### Result Object Methods

| Method | Returns | Use Case |
|--------|---------|----------|
| `result.toUIMessageStreamResponse()` | SSE Response | Default for `useChat` |
| `result.toTextStreamResponse()` | Plain text Response | Simple streaming, widget |
| `result.textStream` | AsyncIterable | Server-side processing |
| `result.text` | Promise<string> | Wait for full response |

---

## OpenAI Provider Configuration

```typescript
import { openai } from '@ai-sdk/openai'

// Simple — uses OPENAI_API_KEY env var
const model = openai('gpt-4o-mini')

// Custom configuration
import { createOpenAI } from '@ai-sdk/openai'

const customOpenAI = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // baseURL: 'https://custom-endpoint.com/v1', // for proxies
})
const model = customOpenAI('gpt-4o-mini')
```

---

## Key Gotchas

1. **AI SDK v6 is current** (April 2026). v5 had different APIs. The `useChat` hook now uses `sendMessage()` not `handleSubmit()`, and messages have `parts` array instead of `content` string.
2. **`convertToModelMessages()`** is required to convert `UIMessage[]` to `ModelMessage[]` format that the model expects.
3. **`streamText` starts immediately** and suppresses errors to prevent server crashes. Always use `onError` callback.
4. **`maxDuration` is critical on Vercel**: Without it, streaming will be cut off at the default function timeout (10s on Hobby, 60s on Pro).
5. **CORS for widget**: The public chat API needs proper CORS headers since the widget runs on customer domains. Use `Access-Control-Allow-Origin: *` with site_key validation.
6. **Edge Runtime**: Chat routes should use `export const runtime = 'edge'` for 0ms cold starts and ~350-600ms to first token.
7. **`toTextStreamResponse()` vs `toUIMessageStreamResponse()`**: For the widget, use `toTextStreamResponse()` for simplicity. For the dashboard preview, use `toUIMessageStreamResponse()` with `useChat`.
