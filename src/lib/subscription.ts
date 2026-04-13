interface SubscriptionStatus {
  active: boolean
  status: string
}

export async function checkSubscription(
  userId: string
): Promise<SubscriptionStatus> {
  // Stub: always returns active subscription.
  // Replace with Stripe integration when billing is implemented.
  void userId
  return { active: true, status: 'active' }
}
