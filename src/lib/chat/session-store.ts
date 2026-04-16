import { createServiceClient } from '@/lib/supabase/service'
import crypto from 'crypto'

export interface ChatSession {
  siteId: string
  siteName: string
  siteUrl: string
  calendlyUrl: string | null
  googleMapsUrl: string | null
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  visitorIp: string
  createdAt: number
}

/**
 * Session store backed by Supabase `chat_sessions` table.
 *
 * POST /api/chat/session creates the session, GET /api/chat/stream
 * consumes it.  On Vercel's serverless runtime those two requests
 * can hit different instances, so an in-memory Map doesn't work —
 * it must be a shared store.
 *
 * TTL: 60 seconds.  Session is deleted on read (one-time use).
 */
const SESSION_TTL_SECONDS = 60

export function generateSessionId(): string {
  return crypto.randomUUID()
}

export async function storeSession(
  id: string,
  session: ChatSession
): Promise<void> {
  const supabase = createServiceClient()
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)

  const { error } = await supabase.from('chat_sessions').insert({
    id,
    data: session,
    expires_at: expiresAt.toISOString(),
  })

  if (error) {
    throw new Error(`Failed to store chat session: ${error.message}`)
  }
}

export async function getSession(id: string): Promise<ChatSession | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('chat_sessions')
    .select('data, expires_at')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return null
  if (new Date(data.expires_at) < new Date()) return null

  return data.data as ChatSession
}

export async function deleteSession(id: string): Promise<boolean> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('chat_sessions').delete().eq('id', id)
  return !error
}
