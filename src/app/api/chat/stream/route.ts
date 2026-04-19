import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import {
  getSession,
  deleteSession,
  type ChatSession,
} from '@/lib/chat/session-store'
import { createServiceClient } from '@/lib/supabase/service'
import { corsHeaders, handleCorsPreFlight } from '@/lib/chat/cors'

export const maxDuration = 60

export async function OPTIONS() {
  return handleCorsPreFlight()
}

export async function GET(request: Request) {
  const sid = new URL(request.url).searchParams.get('sid')

  if (!sid) {
    return Response.json(
      { error: 'Missing session ID' },
      { status: 400, headers: corsHeaders }
    )
  }

  const session = await getSession(sid)
  if (!session) {
    return Response.json(
      { error: 'Session not found or expired' },
      { status: 404, headers: corsHeaders }
    )
  }
  await deleteSession(sid)

  // M6F2: canned custom-response path. /api/chat/session stored the
  // matched rule's text verbatim; we emit it as a plain text stream
  // and save the conversation without any gpt-4o-mini call.
  if (session.cannedResponse) {
    const text = session.cannedResponse
    await persistConversation(session, text)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      },
    })
    return new Response(stream, {
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: session.systemPrompt,
    messages: session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: 0,
    maxOutputTokens: 1000,
    onFinish: async ({ text }) => {
      await persistConversation(session, text)
    },
  })

  return result.toTextStreamResponse({
    headers: corsHeaders,
  })
}

async function persistConversation(
  session: ChatSession,
  assistantText: string
): Promise<void> {
  try {
    const supabase = createServiceClient()
    const visitorId = `visitor_${session.visitorIp.replace(/[^a-zA-Z0-9]/g, '_')}`

    const { data: existing } = await supabase
      .from('conversations')
      .select('id, messages')
      .eq('site_id', session.siteId)
      .eq('visitor_id', visitorId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const lastUserMessage =
      session.messages[session.messages.length - 1]?.content ?? ''

    if (existing) {
      const existingMessages =
        (existing.messages as Array<{ role: string; content: string }>) ?? []
      const updatedMessages = [
        ...existingMessages,
        { role: 'user', content: lastUserMessage },
        { role: 'assistant', content: assistantText },
      ]
      await supabase
        .from('conversations')
        .update({
          messages: updatedMessages,
          message_count: updatedMessages.length,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
    } else {
      const allMessages = [
        ...session.messages,
        { role: 'assistant', content: assistantText },
      ]
      await supabase.from('conversations').insert({
        site_id: session.siteId,
        visitor_id: visitorId,
        messages: allMessages,
        message_count: allMessages.length,
        last_message_at: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.error('Failed to store conversation:', err)
  }
}
