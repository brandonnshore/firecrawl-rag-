#!/usr/bin/env node
/**
 * One-shot: create 3 Stripe products + monthly prices for the Starter / Pro /
 * Scale plans, then UPSERT the stripe_price_id back onto each row in the
 * plans table via the Supabase service-role client.
 *
 * Run against Stripe TEST MODE only. Live-mode keys live only in Vercel.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_...  \
 *   SUPABASE_URL=http://127.0.0.1:54321  \
 *   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...  \
 *   node scripts/create-stripe-prices.mjs
 *
 * Idempotent: if a plan already has a stripe_price_id populated, the script
 * skips it. To rotate prices, NULL out stripe_price_id first.
 */

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

function requireEnv(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return v
}

const STRIPE_SECRET_KEY = requireEnv('STRIPE_SECRET_KEY')
const SUPABASE_URL = requireEnv('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

if (STRIPE_SECRET_KEY.startsWith('sk_live_')) {
  console.error('Refusing to run against a live Stripe key. Use a sk_test_ key.')
  process.exit(1)
}

const stripe = new Stripe(STRIPE_SECRET_KEY)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const { data: plans, error } = await supabase
    .from('plans')
    .select('id, display_name, price_cents, stripe_price_id')
    .order('price_cents', { ascending: true })

  if (error) throw error
  if (!plans?.length) throw new Error('No plans rows found — run the migration first.')

  for (const plan of plans) {
    if (plan.stripe_price_id) {
      console.log(`  ${plan.id}: already has ${plan.stripe_price_id}, skipping`)
      continue
    }

    console.log(`  ${plan.id}: creating Stripe product + price…`)

    const product = await stripe.products.create({
      name: `RubyCrawl ${plan.display_name}`,
      metadata: { plan_id: plan.id },
    })

    const price = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: plan.price_cents,
      recurring: { interval: 'month' },
      metadata: { plan_id: plan.id },
    })

    const { error: upErr } = await supabase
      .from('plans')
      .update({ stripe_price_id: price.id })
      .eq('id', plan.id)

    if (upErr) throw upErr

    console.log(`    -> product=${product.id} price=${price.id}`)
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
