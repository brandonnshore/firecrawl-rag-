import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { deleteUserAccount } from '@/lib/account/delete'
import { stripeClient } from '@/lib/stripe/client'

/**
 * DELETE /api/account — GDPR right-to-be-forgotten endpoint.
 * Requires the caller to retype their email in the body as a soft-confirm.
 * Success wipes auth.users, cancels Stripe, clears Storage, and signs the
 * session out.
 */
export async function DELETE(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { email?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  const typed =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const userEmail = (user.email ?? '').trim().toLowerCase()
  if (!typed || typed !== userEmail) {
    return Response.json({ error: 'email_mismatch' }, { status: 400 })
  }

  const admin = createServiceClient()
  const log = await deleteUserAccount({
    admin,
    userId: user.id,
    cancelStripeSubscription: async (subId: string) => {
      await stripeClient().subscriptions.cancel(subId)
    },
  })

  if (log.authUser !== 'deleted') {
    return Response.json(
      { error: 'delete_failed', log },
      { status: 500 }
    )
  }

  // Clear session cookies. signOut best-effort; if the auth user is
  // already gone, the session token is invalid anyway.
  try {
    await supabase.auth.signOut()
  } catch {
    /* session already invalid — that's the goal */
  }

  return Response.json({ ok: true, log })
}
