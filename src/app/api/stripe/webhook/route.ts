import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripeClient } from '@/lib/stripe/client'
import { createServiceClient } from '@/lib/supabase/service'
import { sendPaymentFailedEmail } from '@/lib/email/transactional'

/**
 * POST /api/stripe/webhook — verifies, idempotency-gates, and dispatches
 * Stripe events. Returns 400 on invalid signature or expired timestamp
 * (> 5 min), 200 on successful processing or idempotency replay.
 *
 * Raw body is required for signature verification — we read request.text()
 * ourselves and never call request.json().
 */

const WEBHOOK_TOLERANCE_SEC = 5 * 60 // Stripe default, explicit for clarity

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return Response.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    )
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured')
    return Response.json(
      { error: 'Webhook not configured' },
      { status: 500 }
    )
  }

  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripeClient().webhooks.constructEvent(
      rawBody,
      signature,
      secret,
      WEBHOOK_TOLERANCE_SEC
    )
  } catch (err) {
    // Stripe's constructEvent raises SignatureVerificationError for both
    // bad signature AND expired timestamp. Both deserve 400.
    console.warn('Webhook signature verification failed:', (err as Error).message)
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const admin = createServiceClient()

  // Idempotency gate: processed_stripe_events.stripe_event_id is PK.
  // Duplicate delivery yields 23505 and we skip reprocessing.
  const { error: insertErr } = await admin
    .from('processed_stripe_events')
    .insert({ stripe_event_id: event.id, event_type: event.type })

  if (insertErr) {
    if (insertErr.code === '23505') {
      return Response.json({ received: true, duplicate: true })
    }
    console.error('Failed to record processed event', insertErr)
    return Response.json(
      { error: 'Idempotency store unavailable' },
      { status: 500 }
    )
  }

  try {
    await dispatch(admin, event)
  } catch (err) {
    console.error(`[stripe-webhook] handler ${event.type} failed:`, err)
    // Handler threw but event is already in processed_stripe_events. Return
    // 500 so Stripe retries — the duplicate-insert guard prevents a second
    // handler invocation, so this effectively tells Stripe "we got it, give
    // up retrying" once it hits the retry cap. Acceptable for M2; M8 can
    // layer a proper dead-letter.
    return Response.json({ error: 'Handler error' }, { status: 500 })
  }

  return Response.json({ received: true })
}

async function dispatch(
  admin: SupabaseClient,
  event: Stripe.Event
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(admin, event)
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(admin, event)
      break
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(admin, event)
      break
    case 'invoice.paid':
      await handleInvoicePaid(admin, event)
      break
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(admin, event)
      break
    default:
      // Known event, no-op for now. Stripe docs: unhandled events should
      // still return 200 so Stripe stops retrying.
      break
  }
}

interface SubscriptionLike {
  id: string
  customer: string | Stripe.Customer | Stripe.DeletedCustomer
  status: string
  // Stripe API versions <=2024 exposed these at the subscription top level.
  // In SDK v22 / API >=2025 Stripe moved the authoritative period window to
  // subscription.items.data[0].current_period_{start,end}. Read both and
  // prefer the item-level value — falls through cleanly for older payloads.
  current_period_start?: number | null
  current_period_end?: number | null
  cancel_at_period_end?: boolean
  items: {
    data: Array<{
      price: { id: string }
      current_period_start?: number | null
      current_period_end?: number | null
    }>
  }
}

function customerIdOf(raw: SubscriptionLike['customer']): string | null {
  if (!raw) return null
  if (typeof raw === 'string') return raw
  return raw.id ?? null
}

/**
 * Read the subscription's current billing window, preferring the
 * per-item fields from API 2025+ and falling back to the top-level
 * fields from older API versions. Returns null if Stripe sent
 * neither (shouldn't happen for a normal subscription, but we stay
 * defensive so the handler never crashes).
 */
function subscriptionPeriod(sub: SubscriptionLike): {
  start: number | null
  end: number | null
} {
  const item = sub.items?.data?.[0]
  const start = item?.current_period_start ?? sub.current_period_start ?? null
  const end = item?.current_period_end ?? sub.current_period_end ?? null
  return { start, end }
}

function toIsoFromSeconds(epochSec: number | null | undefined): string | null {
  if (epochSec == null || !Number.isFinite(epochSec)) return null
  return new Date(epochSec * 1000).toISOString()
}

async function findProfileIdByCustomer(
  admin: SupabaseClient,
  customerId: string | null
): Promise<string | null> {
  if (!customerId) return null
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle<{ id: string }>()
  return data?.id ?? null
}

/**
 * Returns the profile's stripe_subscription_id if any. Used by invoice
 * handlers to confirm an inbound invoice belongs to THIS user's
 * RubyCrawl subscription — not a different product's subscription on a
 * shared Stripe account.
 */
async function findProfileSubscriptionId(
  admin: SupabaseClient,
  profileId: string
): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('stripe_subscription_id')
    .eq('id', profileId)
    .maybeSingle<{ stripe_subscription_id: string | null }>()
  return data?.stripe_subscription_id ?? null
}

async function planIdForPrice(
  admin: SupabaseClient,
  priceId: string | null | undefined
): Promise<string | null> {
  if (!priceId) return null
  const { data } = await admin
    .from('plans')
    .select('id')
    .eq('stripe_price_id', priceId)
    .maybeSingle<{ id: string }>()
  return data?.id ?? null
}

async function handleSubscriptionUpdated(
  admin: SupabaseClient,
  event: Stripe.Event
): Promise<void> {
  const sub = event.data.object as unknown as SubscriptionLike
  const customerId = customerIdOf(sub.customer)
  const userId = await findProfileIdByCustomer(admin, customerId)
  if (!userId) return

  // Cross-product safety: the shared Stripe account may host other
  // products' subscriptions. If the price isn't one of RubyCrawl's 3
  // plans, ignore the event — overwriting subscription_status with an
  // unrelated product's state would corrupt this user's RubyCrawl
  // profile.
  const priceId = sub.items?.data?.[0]?.price?.id ?? null
  const planId = await planIdForPrice(admin, priceId)
  if (!planId) return

  const period = subscriptionPeriod(sub)

  const update: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    current_period_start: toIsoFromSeconds(period.start),
    current_period_end: toIsoFromSeconds(period.end),
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    plan_id: planId,
  }

  await admin.from('profiles').update(update).eq('id', userId)
}

async function handleSubscriptionDeleted(
  admin: SupabaseClient,
  event: Stripe.Event
): Promise<void> {
  const sub = event.data.object as unknown as SubscriptionLike
  const customerId = customerIdOf(sub.customer)
  const userId = await findProfileIdByCustomer(admin, customerId)
  if (!userId) return

  // Same cross-product safety as handleSubscriptionUpdated: only act on
  // our own price IDs so another product on the shared account can't
  // flip this user's subscription_status to canceled.
  const priceId = sub.items?.data?.[0]?.price?.id ?? null
  const planId = await planIdForPrice(admin, priceId)
  if (!planId) return

  await admin
    .from('profiles')
    .update({
      subscription_status: 'canceled',
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
    })
    .eq('id', userId)
}

async function handleCheckoutSessionCompleted(
  admin: SupabaseClient,
  event: Stripe.Event
): Promise<void> {
  const session = event.data.object as unknown as Stripe.Checkout.Session
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id ?? null
  const userId =
    session.client_reference_id ||
    (await findProfileIdByCustomer(admin, customerId))
  if (!userId) return

  const update: Record<string, unknown> = {}
  if (session.subscription) {
    update.stripe_subscription_id =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription.id
  }
  if (customerId) update.stripe_customer_id = customerId
  if (Object.keys(update).length > 0) {
    await admin.from('profiles').update(update).eq('id', userId)
  }
  // The authoritative sync happens via customer.subscription.updated; we
  // avoid a live API call here to keep the handler fast and stripe-mock
  // friendly.
}

interface InvoiceLike {
  id: string
  customer: string | Stripe.Customer | Stripe.DeletedCustomer
  // Older APIs exposed subscription at the top level. Newer APIs
  // (2025+) sometimes put it under parent.subscription_details or
  // lines.data[0].subscription. Handled in invoiceSubscriptionId().
  subscription?: string | Stripe.Subscription | null
  parent?: {
    subscription_details?: { subscription?: string | null } | null
    type?: string
  } | null
  lines?: {
    data?: Array<{
      subscription?: string | null
      period?: { start?: number | null; end?: number | null } | null
    }> | null
  } | null
  period_start?: number | null
  period_end?: number | null
  amount_due?: number
  currency?: string
  customer_email?: string | null
}

function invoiceSubscriptionId(invoice: InvoiceLike): string | null {
  const topLevel = invoice.subscription
  if (typeof topLevel === 'string') return topLevel
  if (topLevel && typeof topLevel === 'object') return topLevel.id ?? null
  const parentSub = invoice.parent?.subscription_details?.subscription
  if (parentSub) return parentSub
  const lineSub = invoice.lines?.data?.[0]?.subscription
  if (lineSub) return lineSub
  return null
}

function invoicePeriod(invoice: InvoiceLike): {
  start: number | null
  end: number | null
} {
  // Prefer per-line period when available (most accurate in 2025 API),
  // otherwise use the top-level invoice period.
  const linePeriod = invoice.lines?.data?.[0]?.period
  const start = linePeriod?.start ?? invoice.period_start ?? null
  const end = linePeriod?.end ?? invoice.period_end ?? null
  return { start, end }
}

async function handleInvoicePaid(
  admin: SupabaseClient,
  event: Stripe.Event
): Promise<void> {
  const invoice = event.data.object as unknown as InvoiceLike
  const customerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id ?? null
  const userId = await findProfileIdByCustomer(admin, customerId)
  if (!userId) return

  // Cross-product safety: an invoice may belong to a DIFFERENT
  // subscription this customer has on our shared Stripe account.
  // Only process if the invoice's subscription_id matches the
  // stripe_subscription_id we have on file for this profile.
  const invoiceSubId = invoiceSubscriptionId(invoice)
  const profileSubId = await findProfileSubscriptionId(admin, userId)
  if (!invoiceSubId || invoiceSubId !== profileSubId) return

  const period = invoicePeriod(invoice)
  const periodStartIso = toIsoFromSeconds(period.start)
  const periodEndIso = toIsoFromSeconds(period.end)

  const profileUpdate: Record<string, unknown> = {}
  if (periodStartIso) profileUpdate.current_period_start = periodStartIso
  if (periodEndIso) profileUpdate.current_period_end = periodEndIso
  if (Object.keys(profileUpdate).length > 0) {
    await admin.from('profiles').update(profileUpdate).eq('id', userId)
  }

  // Reset usage counters for the new billing window. files_stored is NOT
  // reset — storage persists across billing periods. openai_tokens_used
  // is also preserved for long-term attribution / cost audits.
  const counterUpdate: Record<string, unknown> = {
    messages_used: 0,
    crawl_pages_used: 0,
    updated_at: new Date().toISOString(),
  }
  if (periodStartIso) counterUpdate.period_start = periodStartIso
  if (periodEndIso) counterUpdate.period_end = periodEndIso
  await admin
    .from('usage_counters')
    .update(counterUpdate)
    .eq('user_id', userId)
}

async function handleInvoicePaymentFailed(
  admin: SupabaseClient,
  event: Stripe.Event
): Promise<void> {
  const invoice = event.data.object as unknown as InvoiceLike
  const customerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id ?? null
  const userId = await findProfileIdByCustomer(admin, customerId)
  if (!userId) return

  // Cross-product safety — same check as handleInvoicePaid. Prevents
  // setting past_due on a RubyCrawl profile because a DIFFERENT
  // product's invoice failed to charge.
  const invoiceSubId = invoiceSubscriptionId(invoice)
  const profileSubId = await findProfileSubscriptionId(admin, userId)
  if (!invoiceSubId || invoiceSubId !== profileSubId) return

  await admin
    .from('profiles')
    .update({ subscription_status: 'past_due' })
    .eq('id', userId)

  // Payment-failed email (M8F4). Idempotent on invoice.id so a retried
  // webhook delivery never re-sends. Best-effort — transport errors are
  // swallowed so the webhook always returns 200.
  try {
    const email =
      invoice.customer_email ??
      (await resolveProfileEmail(admin, userId))
    if (email) {
      await sendPaymentFailedEmail(admin, userId, invoice.id, {
        email,
        amountCents: invoice.amount_due,
        currency: invoice.currency,
      })
    }
  } catch (err) {
    console.error('[stripe-webhook] payment-failed email skipped:', err)
  }
}

async function resolveProfileEmail(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle<{ email: string | null }>()
  return data?.email ?? null
}
