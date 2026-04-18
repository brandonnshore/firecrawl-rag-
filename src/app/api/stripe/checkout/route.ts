import { createClient } from '@/lib/supabase/server'
import { stripeClient } from '@/lib/stripe/client'

/**
 * POST /api/stripe/checkout — creates a Stripe Checkout Session for the
 * authenticated caller to subscribe to the requested plan.
 *
 * Body: { plan_id: 'starter' | 'pro' | 'scale' }
 *
 * Returns: { url: string }  — the hosted Checkout URL the client redirects to.
 *
 * Side effect: lazy-creates a Stripe customer on first checkout and stores
 * the id on profiles.stripe_customer_id so subsequent checkouts reuse it.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { plan_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const planId = body.plan_id
  if (typeof planId !== 'string' || planId.length === 0) {
    return Response.json({ error: 'plan_id is required' }, { status: 400 })
  }

  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('id, stripe_price_id')
    .eq('id', planId)
    .single()

  if (planErr || !plan) {
    return Response.json({ error: 'Unknown plan_id' }, { status: 400 })
  }

  if (!plan.stripe_price_id) {
    return Response.json(
      { error: 'Plan is not yet configured for checkout' },
      { status: 400 }
    )
  }

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('stripe_customer_id, email, tos_accepted_at')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile) {
    return Response.json({ error: 'Profile not found' }, { status: 500 })
  }

  // Block paid-plan activation until Terms of Service accepted (VAL-TOS-004).
  if (!profile.tos_accepted_at) {
    return Response.json(
      { error: 'tos_required', accept_url: '/dashboard?tos=1' },
      { status: 403 }
    )
  }

  const stripe = stripeClient()

  let customerId = profile.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile.email,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id)

    if (updateErr) {
      return Response.json(
        { error: 'Failed to persist customer id' },
        { status: 500 }
      )
    }
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ||
    'http://localhost:3000'

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: `${appUrl}/dashboard/billing?checkout=success`,
    cancel_url: `${appUrl}/dashboard/billing?checkout=canceled`,
  })

  return Response.json({ url: session.url })
}
