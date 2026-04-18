import { redirect } from 'next/navigation'

/**
 * Backward-compatibility shim: the billing page moved under the settings
 * sub-nav (M4 settings-sidebar). Stripe's saved Checkout / Portal return
 * URLs still point here, so we permanently redirect.
 */
export default function LegacyBillingRedirect() {
  redirect('/dashboard/settings/billing')
}
