import { createClient } from '@/lib/supabase/server'
import { stripeClient } from '@/lib/stripe/client'

/**
 * POST /api/stripe/portal — returns a Stripe Customer Portal session URL
 * for the authenticated caller. Requires profiles.stripe_customer_id (set
 * by the first successful checkout); callers without one get a 400.
 */
export async function POST(): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    return Response.json({ error: 'Profile not found' }, { status: 500 })
  }

  if (!profile.stripe_customer_id) {
    return Response.json(
      { error: 'No billing account yet. Start a subscription first.' },
      { status: 400 }
    )
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ||
    'http://localhost:3000'

  const session = await stripeClient().billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${appUrl}/dashboard/billing`,
  })

  return Response.json({ url: session.url })
}
