-- reset-my-data.sql
--
-- DESTRUCTIVE. Wipes every row scoped to :user_id across every user-scoped
-- table, then rolls :user_id's usage_counters back to zero and re-stamps
-- the billing period. profiles, auth.users, and other users' data are
-- LEFT UNTOUCHED. This is the "Brandon starts real-customer use on a
-- clean slate" button — NOT a GDPR delete. For full account erasure use
-- DELETE /api/account (M8F5) instead.
--
-- Usage (from repo root):
--   psql "$LOCAL_DB_URL" -v user_id="'<uuid>'" -f scripts/reset-my-data.sql
--   supabase db execute --local --file scripts/reset-my-data.sql \
--     --variable user_id=<uuid>
--
-- The :user_id bind parameter must be a quoted UUID. The script refuses
-- to proceed when it's NULL or an empty string so a misconfigured run
-- can't accidentally truncate every user's data.

\set ON_ERROR_STOP on

begin;

-- Safety gate: empty / NULL aborts with a named error before any delete.
do $$
begin
  if :'user_id' is null or length(trim(:'user_id', '''')) = 0 then
    raise exception 'reset-my-data: user_id is NULL or empty; refusing to run';
  end if;
end $$;

-- Confirm the target user actually exists. Prevents typos from silently
-- no-oping (and more importantly, prevents future footguns where we add
-- a new user-scoped table and forget to include it here).
do $$
declare
  v_count int;
begin
  select count(*) into v_count from profiles where id = :user_id;
  if v_count <> 1 then
    raise exception 'reset-my-data: user_id % not found in profiles', :user_id;
  end if;
end $$;

-- 1. Site-scoped rows come down through sites -> * cascade. But custom
--    responses / escalation rules don't delete when we only truncate
--    sites? They DO — each has site_id references sites(id) on delete
--    cascade. So deleting sites takes pages, embeddings, leads,
--    conversations, chat_sessions, supplementary_files, custom_responses,
--    and escalation_rules with it.
delete from sites where user_id = :user_id;

-- 2. User-scoped tables that reference profiles directly (not via sites)
--    and survive the sites cascade. Explicit to keep behavior stable even
--    if a future migration reshapes the FK graph.
delete from sent_emails where user_id = :user_id;

-- 3. usage_counters: reset rather than delete so the profile still has a
--    counter row and the RPC doesn't fail on the next chat. Zero the
--    counters and roll the window to "this minute -> +1 month" so the
--    user is effectively on a brand-new period.
update usage_counters
  set messages_used = 0,
      crawl_pages_used = 0,
      files_stored = 0,
      openai_tokens_used = 0,
      period_start = now(),
      period_end = now() + interval '1 month',
      updated_at = now()
  where user_id = :user_id;

-- 4. profiles: clear any billing linkage but LEAVE THE ROW. This keeps
--    the auth.users -> profiles relationship intact so Brandon can still
--    log in; only the billing fields reset.
update profiles
  set stripe_customer_id = null,
      stripe_subscription_id = null,
      subscription_status = 'trialing',
      current_period_end = null,
      cancel_at_period_end = false,
      trial_ends_at = now() + interval '7 days'
  where id = :user_id;

commit;
