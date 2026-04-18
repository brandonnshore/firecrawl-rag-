import { createClient } from '@/lib/supabase/server'
import { stripeClient } from '@/lib/stripe/client'

/**
 * POST /api/stripe/change-plan — mid-cycle upgrade or downgrade of the
 * caller's subscription. Stripe prorates automatically via
 * proration_behavior='create_prorations' — upgrades create a proration
 * invoice, downgrades create a credit.
 *
 * Body: { plan_id: 'starter' | 'pro' | 'scale' }
 *
 * Requires: auth + existing stripe_subscription_id on the profile.
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

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

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile) {
    return Response.json({ error: 'Profile not found' }, { status: 500 })
  }

  if (!profile.stripe_subscription_id) {
    return Response.json(
      { error: 'No active subscription to change. Use /api/stripe/checkout.' },
      { status: 400 }
    )
  }

  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('id, stripe_price_id')
    .eq('id', planId)
    .single()

  if (planErr || !plan || !plan.stripe_price_id) {
    return Response.json({ error: 'Unknown or unconfigured plan' }, { status: 400 })
  }

  const stripe = stripeClient()
  const current = await stripe.subscriptions.retrieve(
    profile.stripe_subscription_id
  )

  const existingItem = current.items?.data?.[0]
  if (!existingItem) {
    return Response.json(
      { error: 'Subscription has no line items — cannot change plan.' },
      { status: 400 }
    )
  }

  const updated = await stripe.subscriptions.update(
    profile.stripe_subscription_id,
    {
      items: [{ id: existingItem.id, price: plan.stripe_price_id }],
      proration_behavior: 'create_prorations',
    }
  )

  return Response.json({ subscription_id: updated.id, status: updated.status })
}
