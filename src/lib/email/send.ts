import { Resend } from 'resend'
import type { EmailTemplate } from './templates'

const FROM_DEFAULT = 'RubyCrawl <noreply@rubycrawl.app>'

interface SendInput extends EmailTemplate {
  to: string
  from?: string
}

interface SendResult {
  ok: boolean
  id?: string
  skipped?: 'no_key' | 'no_recipient'
  error?: string
}

/**
 * Low-level Resend send. No-op when RESEND_API_KEY is missing (dev + CI)
 * so tests don't need to mock the Resend SDK. Test-mode recipients are
 * handled by Resend itself when configured in the Resend dashboard.
 *
 * Also exposes a List-Unsubscribe header so transactional mail doesn't
 * get hard-blocked by strict clients (Apple Mail, Hey).
 */
export async function sendEmail(input: SendInput): Promise<SendResult> {
  if (!input.to) return { ok: false, skipped: 'no_recipient' }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ok: true, skipped: 'no_key' }

  try {
    const resend = new Resend(apiKey)
    const res = await resend.emails.send({
      from: input.from || process.env.RESEND_FROM || FROM_DEFAULT,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: {
        'List-Unsubscribe': '<mailto:unsubscribe@rubycrawl.app>',
      },
    })
    if (res.error) {
      return { ok: false, error: res.error.message }
    }
    return { ok: true, id: res.data?.id }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
