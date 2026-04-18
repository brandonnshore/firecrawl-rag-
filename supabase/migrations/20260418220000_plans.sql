-- M2F1 plans-schema-migration
-- Introduces the plans catalog, extends profiles for Stripe subscription tracking,
-- and relaxes subscription_status to accept Stripe's canonical lifecycle values
-- (notably 'canceled' single-l, which is what Stripe returns on the wire).

-- ============================================
-- PLANS
-- ============================================
create table plans (
  id text primary key check (id in ('starter', 'pro', 'scale')),
  display_name text not null,
  price_cents int not null check (price_cents > 0),
  stripe_price_id text unique,
  monthly_message_limit int not null check (monthly_message_limit > 0),
  monthly_crawl_page_limit int not null check (monthly_crawl_page_limit > 0),
  supplementary_file_limit int not null check (supplementary_file_limit > 0),
  created_at timestamptz default now()
);

-- Seed rows. Caps sourced from docs/mission/mission.md pricing table.
insert into plans
  (id, display_name, price_cents, monthly_message_limit, monthly_crawl_page_limit, supplementary_file_limit)
values
  ('starter', 'Starter', 2499, 2000, 500, 25),
  ('pro',     'Pro',     4999, 7500, 1500, 100),
  ('scale',   'Scale',   9900, 25000, 5000, 500);

-- Public read, service-role only writes.
alter table plans enable row level security;

create policy "Anyone can read plans"
  on plans for select
  using (true);

-- ============================================
-- PROFILES EXTENSIONS
-- ============================================
alter table profiles
  add column plan_id text references plans(id) on delete set null,
  add column current_period_start timestamptz;

-- Relax subscription_status to Stripe's lifecycle set. Previous constraint
-- allowed ('trialing','active','cancelled','past_due') — the double-l spelling
-- never matches what Stripe webhooks send, so we drop it and broaden the set.
alter table profiles
  drop constraint if exists profiles_subscription_status_check;

-- Migrate any legacy 'cancelled' rows (defensive; seed default is 'trialing').
update profiles
  set subscription_status = 'canceled'
  where subscription_status = 'cancelled';

alter table profiles
  add constraint profiles_subscription_status_check
  check (subscription_status in (
    'trialing',
    'active',
    'past_due',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'unpaid',
    'paused'
  ));
