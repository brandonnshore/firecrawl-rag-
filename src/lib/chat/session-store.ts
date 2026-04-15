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

const sessions = new Map<string, ChatSession>()
const SESSION_TTL_MS = 60_000

export function storeSession(id: string, session: ChatSession): void {
  sessions.set(id, session)
  setTimeout(() => sessions.delete(id), SESSION_TTL_MS)
}

export function getSession(id: string): ChatSession | null {
  return sessions.get(id) ?? null
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id)
}
