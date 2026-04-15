import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export async function rewriteQuery(
  currentMessage: string,
  history: Message[]
): Promise<string> {
  if (!history || history.length === 0) {
    return currentMessage
  }

  const recentHistory = history.slice(-6)

  const historyText = recentHistory
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')

  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    temperature: 0,
    maxOutputTokens: 150,
    prompt: `Given this conversation history:\n${historyText}\n\nThe user's latest message is: "${currentMessage}"\n\nRewrite this message as a standalone search query that captures the full context. If the message is already standalone, return it as-is. Return ONLY the rewritten query, nothing else.`,
  })

  return text.trim() || currentMessage
}
