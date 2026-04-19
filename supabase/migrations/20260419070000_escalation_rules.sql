-- M7F1 escalation-rules-schema
-- escalation_rules: site-owner-defined triggers that fire AFTER the
-- main response completes. Three rule types and five actions.
--
-- rule_type:
--   'turn_count' — fires on the Nth user message. config = {"turns": 3}
--   'keyword'    — fires when the normalized message contains any
--                  keyword. config = {"keywords": ["price"]}
--   'intent'     — fires when the classifier returns an intent in the
--                  list. config = {"intents": ["complaint"]}
--
-- action:
--   'ask_email'     — collect email
--   'ask_phone'     — collect phone
--   'show_form'     — dynamic multi-field form. action_config =
--                     {"fields": ["name","phone","message"]}
--   'calendly_link' — render Calendly iframe. action_config = {"url": "..."}
--   'handoff'       — mark conversation needs_human=true + show message
--
-- The widget never reads this table directly. /api/chat/stream calls
-- the runtime evaluator with the service-role client.

create table escalation_rules (
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

-- Matching hot path: fetch active rules for a site ordered by priority
-- DESC, created_at ASC. Mirrors M6F1's custom_responses index.
create index escalation_rules_site_active_priority_idx
  on escalation_rules (site_id, is_active, priority desc, created_at asc);

-- ============================================
-- RLS — owner CRUD via sites.user_id
-- ============================================
alter table escalation_rules enable row level security;

create policy "Users read own site escalation rules"
  on escalation_rules for select
  using (
    exists (
      select 1 from sites
      where sites.id = escalation_rules.site_id
        and sites.user_id = auth.uid()
    )
  );

create policy "Users insert own site escalation rules"
  on escalation_rules for insert
  with check (
    exists (
      select 1 from sites
      where sites.id = escalation_rules.site_id
        and sites.user_id = auth.uid()
    )
  );

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

create policy "Users delete own site escalation rules"
  on escalation_rules for delete
  using (
    exists (
      select 1 from sites
      where sites.id = escalation_rules.site_id
        and sites.user_id = auth.uid()
    )
  );

-- ============================================
-- conversations.needs_human — handoff flag
-- ============================================
-- Used by the 'handoff' escalation action. Dashboard conversations view
-- surfaces a flag icon; RLS already scopes conversations via sites.
alter table conversations
  add column needs_human boolean not null default false;

create index conversations_needs_human_idx
  on conversations (site_id)
  where needs_human is true;
