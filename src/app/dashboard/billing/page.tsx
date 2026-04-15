export default function BillingPage() {
  return (
    <div className="mx-auto max-w-xl py-8">
      <h1 className="mb-6 text-2xl font-bold">Billing</h1>
      <div className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-700">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-medium">Current plan</p>
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            Active
          </span>
        </div>
        <p className="text-3xl font-bold">
          $24.99
          <span className="text-sm font-normal text-zinc-500">/month</span>
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          Your subscription is active. Stripe integration coming soon.
        </p>
      </div>
    </div>
  )
}
