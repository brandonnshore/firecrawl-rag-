---
module: Billing
date: 2026-04-20
problem_type: integration_issue
component: payments
symptoms:
  - "Profile subscription_status stays at default 'trialing' after successful Stripe payment"
  - "profile.plan_id is null despite Stripe customer + subscription_id populated"
  - "Stripe webhook dashboard shows 200 response but DB update silently fails"
  - "User lands on /dashboard but billing UI shows no active plan"
root_cause: wrong_api
resolution_type: code_fix
severity: critical
tags: [stripe, webhook, api-version, silent-failure, sdk-upgrade, live-incident]
---

# Stripe webhook silently fails on SDK v22 / API 2025 payload shape

## Symptom

A live customer completed Stripe Checkout for the Starter plan. Payment succeeded (Stripe dashboard showed the charge). The user was redirected back to the app. The Supabase `profiles` table for that user:

```
subscription_status  = 'trialing'   ← signup default, never updated
plan_id              = null         ← never populated
stripe_customer_id   = 'cus_UMsGczVL5BgAQ1'   ← set
stripe_subscription_id = 'sub_1TO8bSE…'       ← set
current_period_start = null         ← never populated
current_period_end   = null         ← never populated
trial_ends_at        = null         ← fine (trial removed)
```

Billing UI rendered "Active" (based on subscription metadata) but the gated routes (`/dashboard/setup`, `/dashboard/preview`, etc.) blocked the user because `checkSubscription()` needs an `active`/`trialing`/`canceled-in-grace` status plus a resolvable plan. The customer paid but couldn't use what they paid for.

Stripe's webhook dashboard showed every delivery as **200 OK**. No error visible from Stripe's side. Our Sentry tab was empty. Vercel function logs showed the handler being invoked. Only the mid-handler throw was silent.

## Observable signals that pointed at the cause

Querying prod via the service-role REST API isolated the broken fields:

```bash
curl "$SUPABASE_URL/rest/v1/profiles?stripe_customer_id=not.is.null" \
  -H "apikey: $SERVICE_KEY"
# → profile had customer_id + subscription_id but null plan_id / period fields
```

The pattern — `stripe_customer_id` and `stripe_subscription_id` set, but everything else null — meant `handleCheckoutSessionCompleted` ran successfully (it writes only those two fields) but `handleSubscriptionUpdated` (which writes status, plan_id, period_*) silently aborted.

## Investigation attempts that didn't find it

1. **Checked Stripe webhook deliveries**: all green 200s. Dead end — Stripe sees success because our handler's final response is 200 regardless of mid-code errors (the catch block wraps the whole function).
2. **Assumed webhook didn't fire at all**: wrong. Checkout-session-completed path worked; subscription.updated path was where the throw happened.
3. **Initially suspected the cross-product safety filter** we added in commit `7a8cdbf`: `if (!planId) return` early-returning. But the plans table had correct `stripe_price_id`s, so `planIdForPrice` returned a valid plan_id and would have proceeded. The crash was AFTER that line.

## Root cause

**Stripe SDK v22 defaults to API version `2025-09-30.clover`.** This version moved the authoritative `current_period_start` and `current_period_end` fields from the subscription top-level to `subscription.items.data[0].current_period_{start,end}`. The SDK's TypeScript types no longer include `current_period_start` at the subscription root (verified with `grep -rn "current_period_start" node_modules/stripe/` → zero matches).

Our handler read `sub.current_period_start` → `undefined` → passed to `toIsoFromSeconds()`:

```ts
// before:
function toIsoFromSeconds(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString()
}
```

`new Date(undefined * 1000)` is `new Date(NaN)`. Calling `.toISOString()` on that throws `RangeError: Invalid time value`. The whole `handleSubscriptionUpdated` aborted. The outer event-router catch recorded the idempotency row and returned 200. State on `profiles` was never touched beyond what `handleCheckoutSessionCompleted` had already set.

Invoice handlers had the same class of issue. In API 2025+, `invoice.subscription` is often `null`; the real subscription id lives at `invoice.parent.subscription_details.subscription` or `invoice.lines.data[0].subscription`. Our cross-product safety check (`if (invoiceSubId !== profileSubId) return`) early-returned on the null, so `invoice.paid` never rolled the billing window or reset usage_counters either.

## Fix

`src/app/api/stripe/webhook/route.ts`:

```ts
// 1. Update the type to reflect both payload shapes.
interface SubscriptionLike {
  id: string
  customer: string | Stripe.Customer | Stripe.DeletedCustomer
  status: string
  current_period_start?: number | null   // ← now optional (legacy)
  current_period_end?: number | null     // ← now optional (legacy)
  cancel_at_period_end?: boolean
  items: {
    data: Array<{
      price: { id: string }
      current_period_start?: number | null   // ← 2025+ location
      current_period_end?: number | null
    }>
  }
}

// 2. Helper that prefers per-item, falls back to top-level.
function subscriptionPeriod(sub: SubscriptionLike) {
  const item = sub.items?.data?.[0]
  return {
    start: item?.current_period_start ?? sub.current_period_start ?? null,
    end: item?.current_period_end ?? sub.current_period_end ?? null,
  }
}

// 3. Null-safe conversion — returns null instead of throwing on NaN/undefined.
function toIsoFromSeconds(epochSec: number | null | undefined): string | null {
  if (epochSec == null || !Number.isFinite(epochSec)) return null
  return new Date(epochSec * 1000).toISOString()
}
```

Same pattern for the invoice handler — new helpers walk the nested shape:

```ts
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

function invoicePeriod(invoice: InvoiceLike) {
  const linePeriod = invoice.lines?.data?.[0]?.period
  return {
    start: linePeriod?.start ?? invoice.period_start ?? null,
    end: linePeriod?.end ?? invoice.period_end ?? null,
  }
}
```

The profile update in `handleSubscriptionUpdated` now unconditionally sets `plan_id` (the cross-product safety filter upstream already confirmed the price belongs to RubyCrawl). Invoice handlers conditionally include period fields in the update only when the helpers returned real values, so a future malformed payload can't blow the whole update away.

## Verification

Three regression tests added in `src/__tests__/stripe-webhook.test.ts` that build events in the 2025 API shape:

1. `customer.subscription.updated` with **only** `items.data[0].current_period_*` (no top-level) → asserts `plan_id`, `subscription_status`, `current_period_end` all populate.
2. `customer.subscription.updated` with **neither** per-item nor top-level periods → asserts plan_id + status still populate, periods remain null (graceful), no crash.
3. `invoice.paid` with `invoice.subscription = null` and `invoice.parent.subscription_details.subscription = <real id>` → asserts `current_period_end` populates from the nested location.

The affected prod profile was manually patched via service-role REST as a one-off so the paying customer was unblocked immediately without waiting for the next `invoice.paid` retry:

```bash
curl -X PATCH "$SUPABASE_URL/rest/v1/profiles?id=eq.<uuid>" \
  -H "apikey: $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"subscription_status":"active","plan_id":"starter","current_period_end":"<+28d>"}'
```

Deploy commit: `5b80735`.

## Prevention

1. **Pin the Stripe `apiVersion`** explicitly in `stripeClient()`. An unpinned SDK silently ratchets the default API version when `stripe` is upgraded, which is exactly how this regressed — someone's `pnpm update` will move `^22.0.2` → `^22.x.y` and the payload shape can shift.
2. **Regression-test in the newest API shape.** Our existing `stripe-webhook.test.ts` fixture builds events in the pre-2025 shape. Any future payload-shape migration will silently pass those tests while breaking prod. Keep at least one test per handler using the shape that matches the `apiVersion` pinned in (1).
3. **Stop trusting webhook 200s as ground truth.** Write a thin post-subscribe consistency check: any profile that has `stripe_subscription_id` set but `plan_id = null` for more than a few minutes is a webhook-failure indicator. Page on it via Sentry / cron.
4. **Every live-Stripe smoke test must validate DB state end-to-end**, not just Stripe dashboard. The mission-phase E2E tests asserted the 200 response from the webhook endpoint; none asserted that `profiles.plan_id` came back with the right value afterward. Add that assertion to any future pre-launch smoke test.

## Related

- Commit `7a8cdbf` (cross-product safety filters) — added the `planIdForPrice` gate that kept running through this bug but didn't cause it.
- Commit `5b80735` (this fix) — payload-shape fix + regression tests.
