-- M7F4 leads table extensions for escalation actions
--
-- ask_phone: phone-only lead (no email) — requires email NULL support
-- show_form: arbitrary extra fields (preserved as jsonb)
-- source: 'widget' (historic post-3-turns flow) vs 'escalation' (rule-fired)
--
-- Preserves historic dedupe semantics by replacing UNIQUE(site_id, email)
-- with a partial unique index that only fires on non-null emails. Two
-- phone-only rows for the same site are allowed because they represent
-- distinct visitors whose emails were never captured.

alter table leads
  alter column email drop not null,
  add column phone text,
  add column extra_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(extra_fields) = 'object'),
  add column source text not null default 'widget'
    check (source in ('widget', 'escalation'));

-- A phone-only lead must still carry some identifying info.
alter table leads
  add constraint leads_contact_present
  check (
    (email is not null and length(email) > 0)
    or (phone is not null and length(phone) > 0)
  );

-- Replace the strict email unique constraint with a partial one so
-- NULL emails (phone-only leads) don't collide.
alter table leads
  drop constraint if exists leads_site_email_unique;

create unique index leads_site_email_unique_partial
  on leads (site_id, email)
  where email is not null;
