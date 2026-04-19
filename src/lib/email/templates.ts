export interface EmailTemplate {
  subject: string
  html: string
  text: string
}

export interface WelcomeProps {
  email: string
}

export interface TrialEndingProps {
  email: string
  trialEndsAt: Date | string
}

export interface QuotaWarningProps {
  email: string
  used: number
  limit: number
}

export interface PaymentFailedProps {
  email: string
  amountCents?: number
  currency?: string
}

const BRAND = 'RubyCrawl'
const BILLING_URL = 'https://rubycrawl.app/dashboard/billing'

function wrap(body: string): string {
  return `<!doctype html><html><body style="font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;margin:0;padding:24px;">${body}<p style="margin-top:32px;color:#888;font-size:12px">— The ${BRAND} team</p></body></html>`
}

export function renderWelcome({ email }: WelcomeProps): EmailTemplate {
  const subject = `Welcome to ${BRAND}`
  const html = wrap(
    `<h1 style="margin:0 0 16px">Welcome to ${BRAND}</h1>` +
      `<p>Thanks for signing up with <strong>${email}</strong>.</p>` +
      `<p>Paste your site URL in the dashboard and we'll build your AI assistant.</p>` +
      `<p><a href="https://rubycrawl.app/dashboard">Open your dashboard</a></p>`
  )
  const text =
    `Welcome to ${BRAND}!\n\n` +
    `Thanks for signing up with ${email}.\n` +
    `Paste your site URL in the dashboard to get started:\n` +
    `https://rubycrawl.app/dashboard`
  return { subject, html, text }
}

export function renderTrialEnding({
  email,
  trialEndsAt,
}: TrialEndingProps): EmailTemplate {
  const endsAtIso =
    typeof trialEndsAt === 'string' ? trialEndsAt : trialEndsAt.toISOString()
  const subject = `Your ${BRAND} trial ends in 3 days`
  const html = wrap(
    `<h1 style="margin:0 0 16px">Your trial ends soon</h1>` +
      `<p>Hi ${email}, your ${BRAND} trial ends on ${endsAtIso}.</p>` +
      `<p>Pick a plan to keep your chatbot online.</p>` +
      `<p><a href="${BILLING_URL}">Choose a plan</a></p>`
  )
  const text =
    `Your ${BRAND} trial ends on ${endsAtIso}.\n` +
    `Pick a plan to keep your chatbot online: ${BILLING_URL}`
  return { subject, html, text }
}

export function renderQuotaWarning({
  email,
  used,
  limit,
}: QuotaWarningProps): EmailTemplate {
  const subject = `You're at 80% of this month's chat quota`
  const pct = Math.round((used / Math.max(1, limit)) * 100)
  const html = wrap(
    `<h1 style="margin:0 0 16px">You're at ${pct}% of your monthly chat limit</h1>` +
      `<p>Hi ${email}, you've used ${used.toLocaleString()} of ${limit.toLocaleString()} chats this month.</p>` +
      `<p>Upgrade if you'd like to raise the cap.</p>` +
      `<p><a href="${BILLING_URL}">View billing</a></p>`
  )
  const text =
    `You've used ${used} of ${limit} chat messages this month (${pct}%).\n` +
    `Upgrade: ${BILLING_URL}`
  return { subject, html, text }
}

export function renderPaymentFailed({
  email,
  amountCents,
  currency,
}: PaymentFailedProps): EmailTemplate {
  const amount =
    amountCents && currency
      ? `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`
      : 'your latest invoice'
  const subject = `We couldn't process your ${BRAND} payment`
  const html = wrap(
    `<h1 style="margin:0 0 16px">Payment failed</h1>` +
      `<p>Hi ${email}, we couldn't charge ${amount}.</p>` +
      `<p>Your chatbot is temporarily paused. Update your card to resume service.</p>` +
      `<p><a href="${BILLING_URL}">Update payment method</a></p>`
  )
  const text =
    `${BRAND} couldn't charge ${amount}. ` +
    `Your chatbot is paused until the payment is updated: ${BILLING_URL}`
  return { subject, html, text }
}
