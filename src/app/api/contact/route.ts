import { sendEmail } from '@/lib/email/send'
import { checkRateLimit } from '@/lib/chat/rate-limit'

/**
 * Contact form endpoint for the done-for-you onboarding request.
 *
 * Validation:
 *   - name/email/website required, message optional
 *   - honeypot `hp` must be empty (bots tend to fill it)
 *   - 1 req / 3s per IP via shared rate limiter (same throttle the
 *     widget uses; sufficient to dampen scripted spam)
 *
 * Delivery:
 *   - Resend via sendEmail() with `to` = brandon@rubyadvisory.com
 *   - No-op when RESEND_API_KEY is absent so dev environments don't fail
 *     the request flow (sendEmail returns ok: true, skipped: 'no_key')
 */

const CONTACT_TO = 'brandon@rubyadvisory.com'

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(request: Request): Promise<Response> {
  let body: {
    name?: string
    email?: string
    website?: string
    message?: string
    hp?: string
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Honeypot — bots autofill any visible input. Real humans never see
  // this field (it's absolute-positioned off-screen on the form).
  if (body.hp && body.hp.trim().length > 0) {
    // Return 200 so the bot doesn't retry, but don't send anything.
    return Response.json({ success: true })
  }

  const name = (body.name ?? '').trim()
  const email = (body.email ?? '').trim()
  const website = (body.website ?? '').trim()
  const message = (body.message ?? '').trim()

  if (name.length === 0 || name.length > 200) {
    return Response.json({ error: 'Name is required' }, { status: 400 })
  }
  if (!isValidEmail(email)) {
    return Response.json({ error: 'Valid email required' }, { status: 400 })
  }
  if (!isValidUrl(website)) {
    return Response.json(
      { error: 'Valid website URL required (https://…)' },
      { status: 400 }
    )
  }
  if (message.length > 4000) {
    return Response.json(
      { error: 'Message is too long (max 4000 chars)' },
      { status: 400 }
    )
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rate = await checkRateLimit(`contact:${ip}`)
  if (!rate.allowed) {
    return Response.json(
      { error: 'Too many requests — please wait a moment' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rate.retryAfterMs ?? 3000) / 1000)),
        },
      }
    )
  }

  const subject = `[RubyCrawl] Done-for-you setup request from ${name}`
  const plain =
    `New done-for-you setup request.\n\n` +
    `Name:    ${name}\n` +
    `Email:   ${email}\n` +
    `Website: ${website}\n` +
    `Source IP: ${ip}\n\n` +
    `Message:\n${message || '(no message provided)'}\n`

  const html =
    `<p><strong>New done-for-you setup request.</strong></p>` +
    `<p>` +
    `<b>Name:</b> ${escapeHtml(name)}<br>` +
    `<b>Email:</b> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a><br>` +
    `<b>Website:</b> <a href="${escapeHtml(website)}">${escapeHtml(website)}</a><br>` +
    `<b>Source IP:</b> ${escapeHtml(ip)}` +
    `</p>` +
    `<p><b>Message:</b></p>` +
    `<pre style="white-space:pre-wrap;font-family:inherit">${
      escapeHtml(message) || '<em>(no message provided)</em>'
    }</pre>`

  const result = await sendEmail({
    to: CONTACT_TO,
    subject,
    html,
    text: plain,
  })

  if (!result.ok && !result.skipped) {
    console.error('[contact] sendEmail failed:', result.error)
    return Response.json({ error: 'Failed to send' }, { status: 500 })
  }

  return Response.json({ success: true })
}
