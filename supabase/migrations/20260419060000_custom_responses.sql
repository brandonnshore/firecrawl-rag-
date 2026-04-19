-- M6F1 custom-responses-schema
-- Table for site-owner-defined canned responses. Two rule types:
--   'keyword' — server-side matcher runs BEFORE any LLM call
--   'intent'  — runs only if keyword pass missed; gated by gpt-4o-mini classifier
-- The widget never reads this table directly. Matching happens inside
-- /api/chat/session with the service-role client; owners CRUD via the
-- dashboard (RLS gates by sites.user_id).

create table custom_responses (
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

-- Hot path: /api/chat/session pulls active rules for a site ordered by
-- priority DESC, created_at ASC. Index supports the filter + ordering.
create index custom_responses_site_active_priority_idx
  on custom_responses (site_id, is_active, priority desc, created_at asc);

-- ============================================
-- RLS — owner CRUD via sites.user_id
-- ============================================
alter table custom_responses enable row level security;

create policy "Users read own site responses"
  on custom_responses for select
  using (
    exists (
      select 1 from sites
      where sites.id = custom_responses.site_id
        and sites.user_id = auth.uid()
    )
  );

create policy "Users insert own site responses"
  on custom_responses for insert
  with check (
    exists (
      select 1 from sites
      where sites.id = custom_responses.site_id
        and sites.user_id = auth.uid()
    )
  );

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

create policy "Users delete own site responses"
  on custom_responses for delete
  using (
    exists (
      select 1 from sites
      where sites.id = custom_responses.site_id
        and sites.user_id = auth.uid()
    )
  );
