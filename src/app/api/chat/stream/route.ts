import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import {
  getSession,
  deleteSession,
  type ChatSession,
} from '@/lib/chat/session-store'
import { createServiceClient } from '@/lib/supabase/service'
import { corsHeaders, handleCorsPreFlight } from '@/lib/chat/cors'
import {
  evaluateEscalation,
  type EscalationMatch,
  type EscalationRule,
} from '@/lib/chat/escalation'

export const maxDuration = 60

/**
 * Trailer sentinel for escalation pending_action metadata. We use the
 * ASCII Record Separator (U+001E) which is (a) legal in a plain text
 * stream, (b) unlikely to appear in natural chat text, and (c) keeps
 * the protocol readable for curl/manual debugging. The widget splits
 * on the last \x1E and parses the trailing JSON.
 */
export const PENDING_ACTION_SENTINEL = '\x1E'

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

  // M6F2: canned custom-response path. Emit canned text + pending_action
  // trailer together; no gpt-4o-mini call.
  if (session.cannedResponse) {
    const text = session.cannedResponse
    const escalation = await resolveEscalation(session)
    await persistConversation(session, text, escalation?.action === 'handoff')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(text))
        if (escalation) {
          controller.enqueue(
            encoder.encode(
              `${PENDING_ACTION_SENTINEL}${JSON.stringify({
                pending_action: escalationPayload(escalation),
              })}`
            )
          )
        }
        controller.close()
      },
    })
    return new Response(stream, {
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  // RAG path: stream LLM text, then append the pending_action trailer
  // once the text is complete. streamText's toTextStreamResponse gives
  // us a ReadableStream<Uint8Array> we can concat onto.
  const aiResult = streamText({
    model: openai('gpt-4o-mini'),
    system: session.systemPrompt,
    messages: session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: 0,
    maxOutputTokens: 1000,
  })

  const upstream = aiResult.toTextStreamResponse()

  let fullText = ''
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  const teeStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const reader = upstream.body!.getReader()
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          fullText += decoder.decode(value, { stream: true })
          controller.enqueue(value)
        }
        // Flush decoder
        fullText += decoder.decode()

        const escalation = await resolveEscalation(session)
        if (escalation) {
          controller.enqueue(
            encoder.encode(
              `${PENDING_ACTION_SENTINEL}${JSON.stringify({
                pending_action: escalationPayload(escalation),
              })}`
            )
          )
        }
        controller.close()

        await persistConversation(
          session,
          fullText,
          escalation?.action === 'handoff'
        )
      } catch (err) {
        console.error('[chat.stream] pipe error', err)
        controller.error(err)
      }
    },
  })

  return new Response(teeStream, {
    headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

async function resolveEscalation(
  session: ChatSession
): Promise<EscalationMatch | null> {
  const rules = session.escalationRules ?? []
  if (rules.length === 0) return null
  const lastUserMessage =
    session.messages[session.messages.length - 1]?.content ?? ''
  return evaluateEscalation({
    message: lastUserMessage,
    userMessageCount: session.userMessageCount ?? 1,
    rules: rules as EscalationRule[],
    preClassifiedIntent: session.preClassifiedIntent,
  })
}

function escalationPayload(match: EscalationMatch) {
  return {
    rule_id: match.rule_id,
    action: match.action,
    action_config: match.action_config,
    via: match.via,
  }
}

async function persistConversation(
  session: ChatSession,
  assistantText: string,
  needsHuman = false
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
      const update: Record<string, unknown> = {
        messages: updatedMessages,
        message_count: updatedMessages.length,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      if (needsHuman) update.needs_human = true
      await supabase.from('conversations').update(update).eq('id', existing.id)
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
        needs_human: needsHuman || undefined,
      })
    }
  } catch (err) {
    console.error('Failed to store conversation:', err)
  }
}
