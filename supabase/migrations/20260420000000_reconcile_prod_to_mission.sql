-- 20260420000000_reconcile_prod_to_mission
--
-- One-off reconciliation migration bringing production's April-13
-- prototype schema forward to the full M1–M9 mission state.
--
-- Production (project luznxhpadjblwnkfzjhn) was bootstrapped directly
-- in Supabase Studio before the mission started — 8 base tables, no
-- migration history. The mission built 13 migrations against the local
-- Docker stack but they never ran against prod. This migration applies
-- ONLY the deltas that production is missing: no recreations of tables
-- that already exist, no DROPs of live data, no destructive changes
-- beyond narrow column/constraint edits (leads.email becomes nullable,
-- the strict leads unique constraint becomes a partial index, the old
-- 4-value subscription_status CHECK is replaced with the 8-value
-- Stripe set).
--
-- After this runs + `supabase migration repair --status applied` marks
-- the 13 earlier mission migrations as applied, prod matches the
-- mission's tested state exactly.
--
-- Section ordering mirrors the original mission migration order so any
-- reader can cross-reference each block back to its source migration.
-- Every DDL that could conflict on re-run uses IF NOT EXISTS / IF
-- EXISTS guards, so this file is also safe against a fully-migrated
-- database (fresh install that ran migrations 1–13 in full).

-- ============================================================
-- M1F2 — rls_widget_insert_fix
-- Replace anonymous-visible EXISTS() widget insert policies with a
-- SECURITY DEFINER site_has_key helper. Prod still has the original
-- EXISTS() versions from its initial prototype schema.
-- ============================================================

create or replace function public.site_has_key(p_site_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from sites
    where id = p_site_id
      and site_key is not null
  );
$$;

grant execute on function public.site_has_key(uuid) to anon, authenticated, service_role;

drop policy if exists "Widget can insert leads" on leads;
create policy "Widget can insert leads"
  on leads for insert
  with check (site_has_key(site_id));

drop policy if exists "Widget can insert conversations" on conversations;
create policy "Widget can insert conversations"
  on conversations for insert
  with check (site_has_key(site_id));

-- ============================================================
-- M2F1 — plans table + Stripe-aligned profile extensions
-- ============================================================

create table if not exists plans (
  id text primary key check (id in ('starter', 'pro', 'scale')),
  display_name text not null,
  price_cents int not null check (price_cents > 0),
  stripe_price_id text unique,
  monthly_message_limit int not null check (monthly_message_limit > 0),
  monthly_crawl_page_limit int not null check (monthly_crawl_page_limit > 0),
  supplementary_file_limit int not null check (supplementary_file_limit > 0),
  created_at timestamptz default now()
);

insert into plans
  (id, display_name, price_cents, monthly_message_limit, monthly_crawl_page_limit, supplementary_file_limit)
values
  ('starter', 'Starter', 2499, 2000, 500, 25),
  ('pro',     'Pro',     4999, 7500, 1500, 100),
  ('scale',   'Scale',   9900, 25000, 5000, 500)
on conflict (id) do nothing;

alter table plans enable row level security;

drop policy if exists "Anyone can read plans" on plans;
create policy "Anyone can read plans"
  on plans for select
  using (true);

alter table profiles
  add column if not exists plan_id text references plans(id) on delete set null,
  add column if not exists current_period_start timestamptz;

-- Replace the legacy 4-value subscription_status CHECK with the full
-- Stripe lifecycle set. The old check rejects 'canceled' (single-l)
-- which is what Stripe actually sends on the wire.
alter table profiles
  drop constraint if exists profiles_subscription_status_check;

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

-- ============================================================
-- M3F1 — usage_counters + increment_message_counter RPC
-- ============================================================

create table if not exists usage_counters (
  user_id uuid primary key references profiles(id) on delete cascade,
  period_start timestamptz not null default now(),
  period_end timestamptz not null default (now() + interval '1 month'),
  messages_used int not null default 0 check (messages_used >= 0),
  crawl_pages_used int not null default 0 check (crawl_pages_used >= 0),
  files_stored int not null default 0 check (files_stored >= 0),
  openai_tokens_used bigint not null default 0 check (openai_tokens_used >= 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table usage_counters enable row level security;

drop policy if exists "Users read own usage counter" on usage_counters;
create policy "Users read own usage counter"
  on usage_counters for select
  using (user_id = auth.uid());

create or replace function handle_new_profile_usage_counter()
returns trigger as $$
begin
  insert into usage_counters (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_profile_created_usage_counter on profiles;
create trigger on_profile_created_usage_counter
  after insert on profiles
  for each row execute function handle_new_profile_usage_counter();

-- Backfill existing profiles (the 11 prod test rows) so every profile
-- has a counter row. Idempotent via on conflict.
insert into usage_counters (user_id)
  select id from profiles
  on conflict (user_id) do nothing;

create or replace function increment_message_counter(
  p_user_id uuid,
  p_limit int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
begin
  select messages_used into v_used
    from usage_counters
    where user_id = p_user_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'used', 0, 'limit', p_limit, 'reason', 'no_counter');
  end if;

  if v_used >= p_limit then
    return jsonb_build_object('ok', false, 'used', v_used, 'limit', p_limit);
  end if;

  update usage_counters
    set messages_used = messages_used + 1,
        updated_at = now()
    where user_id = p_user_id
    returning messages_used into v_used;

  return jsonb_build_object('ok', true, 'used', v_used, 'limit', p_limit);
end;
$$;

grant execute on function increment_message_counter(uuid, int) to anon, authenticated, service_role;

-- ============================================================
-- M3F5 — realtime publication on usage_counters
-- `alter publication ... add table` errors if the table is already
-- in the publication, so we guard with pg_publication_tables.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'usage_counters'
  ) then
    alter publication supabase_realtime add table usage_counters;
  end if;
end $$;

-- ============================================================
-- M4F5 — tos_acceptance on profiles + handle_new_user upgrade
-- ============================================================

alter table profiles
  add column if not exists tos_accepted_at timestamptz;

create or replace function handle_new_user()
returns trigger as $$
declare
  v_tos_accepted_at timestamptz;
begin
  begin
    v_tos_accepted_at := (new.raw_user_meta_data ->> 'tos_accepted_at')::timestamptz;
  exception when others then
    v_tos_accepted_at := null;
  end;

  insert into profiles (id, email, tos_accepted_at)
  values (new.id, new.email, v_tos_accepted_at);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- ============================================================
-- M5F1 — supplementary_files + embeddings file-source columns + Storage bucket
-- ============================================================

create table if not exists supplementary_files (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  bytes int not null check (bytes > 0),
  content_hash text not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'ready', 'failed')),
  error_message text,
  chunks_count int not null default 0 check (chunks_count >= 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint supplementary_files_site_hash_unique unique (site_id, content_hash)
);

create index if not exists supplementary_files_site_id_idx on supplementary_files (site_id);
create index if not exists supplementary_files_status_idx on supplementary_files (status);

alter table supplementary_files enable row level security;

drop policy if exists "Users read own site files" on supplementary_files;
create policy "Users read own site files"
  on supplementary_files for select
  using (
    exists (
      select 1 from sites
      where sites.id = supplementary_files.site_id
        and sites.user_id = auth.uid()
    )
  );

drop policy if exists "Users delete own site files" on supplementary_files;
create policy "Users delete own site files"
  on supplementary_files for delete
  using (
    exists (
      select 1 from sites
      where sites.id = supplementary_files.site_id
        and sites.user_id = auth.uid()
    )
  );

-- Embeddings get source_type + file_id so file-sourced chunks can be
-- filtered independently and cascade-deleted with their parent file.
-- Existing crawl rows retain NULL source_type; the retrieval function
-- coalesces that to 'crawl'.
alter table embeddings
  add column if not exists source_type text
    check (source_type in ('crawl', 'file')) default 'crawl';

alter table embeddings
  add column if not exists file_id uuid references supplementary_files(id) on delete cascade;

create index if not exists embeddings_file_id_idx on embeddings (file_id) where file_id is not null;

-- Storage bucket + per-user-folder RLS policies. The object path is
-- '{user_id}/{file_id}.{ext}', so the first path segment must match
-- auth.uid() to operate on the object.
insert into storage.buckets (id, name, public)
values ('knowledge-files', 'knowledge-files', false)
on conflict (id) do nothing;

drop policy if exists "Users manage own knowledge-files folder (select)" on storage.objects;
create policy "Users manage own knowledge-files folder (select)"
  on storage.objects for select
  using (
    bucket_id = 'knowledge-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users manage own knowledge-files folder (insert)" on storage.objects;
create policy "Users manage own knowledge-files folder (insert)"
  on storage.objects for insert
  with check (
    bucket_id = 'knowledge-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users manage own knowledge-files folder (delete)" on storage.objects;
create policy "Users manage own knowledge-files folder (delete)"
  on storage.objects for delete
  using (
    bucket_id = 'knowledge-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- M5F5 — match_chunks upgrade with source_type + file handling
-- Drop the old signature (no source_type column) so CREATE can add a
-- new return shape. Postgres refuses CREATE OR REPLACE when return
-- columns change.
-- ============================================================

drop function if exists match_chunks(vector, text, uuid, double precision, integer);

create function match_chunks(
  query_embedding extensions.vector(1536),
  query_text text,
  p_site_id uuid,
  match_threshold float default 0.5,
  match_count int default 5
)
returns table (
  id bigint,
  chunk_text text,
  source_url text,
  source_type text,
  similarity float
)
language sql stable
set search_path = public, extensions
as $$
  select
    e.id,
    e.chunk_text,
    e.source_url,
    coalesce(e.source_type, 'crawl') as source_type,
    (0.7 * (1 - (e.embedding <=> query_embedding))) +
    (0.3 * coalesce(ts_rank(e.text_search, websearch_to_tsquery('english', query_text)), 0))
      as similarity
  from embeddings e
  join sites s on s.id = e.site_id
  where e.site_id = p_site_id
    and s.crawl_status = 'ready'
    and (1 - (e.embedding <=> query_embedding)) > match_threshold
    and (
      e.source_type = 'file'
      or
      (coalesce(e.source_type, 'crawl') = 'crawl'
        and e.crawl_batch = s.active_crawl_batch)
    )
  order by similarity desc
  limit least(match_count, 20);
$$;

-- ============================================================
-- M5F6 — realtime on supplementary_files
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'supplementary_files'
  ) then
    alter publication supabase_realtime add table supplementary_files;
  end if;
end $$;

-- ============================================================
-- M6F1 — custom_responses table + RLS
-- ============================================================

create table if not exists custom_responses (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  trigger_type text not null
    check (trigger_type in ('keyword', 'intent')),
  triggers text[] not null check (cardinality(triggers) > 0),
  response text not null check (char_length(response) > 0),
  priority int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists custom_responses_site_active_priority_idx
  on custom_responses (site_id, is_active, priority desc, created_at asc);

alter table custom_responses enable row level security;

drop policy if exists "Users read own site responses" on custom_responses;
create policy "Users read own site responses"
  on custom_responses for select
  using (
    exists (
      select 1 from sites
      where sites.id = custom_responses.site_id
        and sites.user_id = auth.uid()
    )
  );

drop policy if exists "Users insert own site responses" on custom_responses;
create policy "Users insert own site responses"
  on custom_responses for insert
  with check (
    exists (
      select 1 from sites
      where sites.id = custom_responses.site_id
        and sites.user_id = auth.uid()
    )
  );

drop policy if exists "Users update own site responses" on custom_responses;
create policy "Users update own site responses"
  on custom_responses for update
  using (
    exists (
      select 1 from sites
      where sites.id = custom_responses.site_id
        and sites.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from sites
      where sites.id = custom_responses.site_id
        and sites.user_id = auth.uid()
    )
  );

drop policy if exists "Users delete own site responses" on custom_responses;
create policy "Users delete own site responses"
  on custom_responses for delete
  using (
    exists (
      select 1 from sites
      where sites.id = custom_responses.site_id
        and sites.user_id = auth.uid()
    )
  );

-- ============================================================
-- M7F1 — escalation_rules + conversations.needs_human handoff flag
-- ============================================================

create table if not exists escalation_rules (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  rule_type text not null
    check (rule_type in ('turn_count', 'keyword', 'intent')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  action text not null
    check (action in ('ask_email', 'ask_phone', 'show_form', 'calendly_link', 'handoff')),
  action_config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(action_config) = 'object'),
  priority int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists escalation_rules_site_active_priority_idx
  on escalation_rules (site_id, is_active, priority desc, created_at asc);

alter table escalation_rules enable row level security;

drop policy if exists "Users read own site escalation rules" on escalation_rules;
create policy "Users read own site escalation rules"
  on escalation_rules for select
  using (
    exists (
      select 1 from sites
      where sites.id = escalation_rules.site_id
        and sites.user_id = auth.uid()
    )
  );

drop policy if exists "Users insert own site escalation rules" on escalation_rules;
create policy "Users insert own site escalation rules"
  on escalation_rules for insert
  with check (
    exists (
      select 1 from sites
      where sites.id = escalation_rules.site_id
        and sites.user_id = auth.uid()
    )
  );

drop policy if exists "Users update own site escalation rules" on escalation_rules;
create policy "Users update own site escalation rules"
  on escalation_rules for update
  using (
    exists (
      select 1 from sites
      where sites.id = escalation_rules.site_id
        and sites.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from sites
      where sites.id = escalation_rules.site_id
        and sites.user_id = auth.uid()
    )
  );

drop policy if exists "Users delete own site escalation rules" on escalation_rules;
create policy "Users delete own site escalation rules"
  on escalation_rules for delete
  using (
    exists (
      select 1 from sites
      where sites.id = escalation_rules.site_id
        and sites.user_id = auth.uid()
    )
  );

alter table conversations
  add column if not exists needs_human boolean not null default false;

create index if not exists conversations_needs_human_idx
  on conversations (site_id)
  where needs_human is true;

-- ============================================================
-- M7F4 — leads escalation fields + nullable email + partial unique
-- Production has UNIQUE(site_id, email) with email NOT NULL. Escalation
-- flows produce phone-only leads (email NULL), so we loosen both. The
-- partial unique index preserves dedupe on non-null emails.
-- ============================================================

-- drop not null is idempotent in Postgres — silently no-ops if the
-- column is already nullable (i.e. migration re-run on fresh DB).
alter table leads
  alter column email drop not null;

alter table leads
  add column if not exists phone text;

alter table leads
  add column if not exists extra_fields jsonb not null default '{}'::jsonb;

-- jsonb_typeof check added separately so it's skipped on re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_extra_fields_check'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table leads
      add constraint leads_extra_fields_check
      check (jsonb_typeof(extra_fields) = 'object');
  end if;
end $$;

alter table leads
  add column if not exists source text not null default 'widget';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_source_check'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table leads
      add constraint leads_source_check
      check (source in ('widget', 'escalation'));
  end if;
end $$;

-- Phone-only lead must still carry email OR phone.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_contact_present'
      and conrelid = 'public.leads'::regclass
  ) then
    alter table leads
      add constraint leads_contact_present
      check (
        (email is not null and length(email) > 0)
        or (phone is not null and length(phone) > 0)
      );
  end if;
end $$;

-- Replace strict UNIQUE(site_id, email) with the partial index.
alter table leads
  drop constraint if exists leads_site_email_unique;

create unique index if not exists leads_site_email_unique_partial
  on leads (site_id, email)
  where email is not null;

-- ============================================================
-- M8F4 — sent_emails idempotency ledger
-- ============================================================

create table if not exists sent_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  template text not null,
  period text not null,
  sent_at timestamptz not null default now(),
  unique (user_id, template, period)
);

create index if not exists sent_emails_user_idx on sent_emails (user_id);

alter table sent_emails enable row level security;

drop policy if exists "Users read own sent emails" on sent_emails;
create policy "Users read own sent emails"
  on sent_emails for select
  using (user_id = auth.uid());
