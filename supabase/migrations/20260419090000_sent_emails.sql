-- M8F4 transactional-email
-- Idempotency ledger for one-shot transactional emails. A (user_id,
-- template, period) tuple is unique so duplicate triggers (cron reruns,
-- webhook retries, UI refreshes) don't re-send.

create table sent_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  template text not null,
  period text not null,
  sent_at timestamptz not null default now(),
  unique (user_id, template, period)
);

create index sent_emails_user_idx on sent_emails (user_id);

-- RLS: service-role-only writes. Owners may read their own log for
-- transparency (e.g. "last billing email sent").
alter table sent_emails enable row level security;

create policy "Users read own sent emails"
  on sent_emails for select
  using (user_id = auth.uid());
