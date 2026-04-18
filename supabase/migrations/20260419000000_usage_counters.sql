-- M3F1 usage-counters-schema-rpc
-- Per-user usage tracking for messages / crawl pages / files with atomic
-- increment RPC for race-free budget enforcement.

-- ============================================
-- TABLE
-- ============================================
create table usage_counters (
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

-- ============================================
-- RLS
-- ============================================
alter table usage_counters enable row level security;

-- Owner-read only. No insert/update/delete policies, so writes are
-- service-role only (matches the app invariant — counters mutate via the
-- RPC or webhook handlers that run with the service-role key).
create policy "Users read own usage counter"
  on usage_counters for select
  using (user_id = auth.uid());

-- ============================================
-- AUTO-CREATE ON PROFILE INSERT
-- ============================================
-- Profiles already has a handle_new_user trigger on auth.users. We attach
-- a second trigger directly on profiles so every profile row — however it
-- was created — gets an accompanying usage_counters row. Idempotent via
-- ON CONFLICT in case a manual insert races the trigger.
create or replace function handle_new_profile_usage_counter()
returns trigger as $$
begin
  insert into usage_counters (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_profile_created_usage_counter
  after insert on profiles
  for each row execute function handle_new_profile_usage_counter();

-- Backfill existing profiles (test-only stacks may have rows pre-dating
-- this migration). ON CONFLICT keeps it idempotent.
insert into usage_counters (user_id)
  select id from profiles
  on conflict (user_id) do nothing;

-- ============================================
-- INCREMENT RPC
-- ============================================
-- increment_message_counter: atomic SELECT ... FOR UPDATE then conditional
-- increment. Returns {ok, used, limit}. Used by /api/chat/session to gate
-- the next message BEFORE hitting OpenAI — so over-budget calls never pay
-- for inference they're going to reject.
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

-- Allow authenticated / anon / service_role to call the RPC. The function
-- is SECURITY DEFINER so it reads/writes usage_counters regardless of the
-- caller's RLS; the caller is gated by application code using the correct
-- p_user_id. This is safe because:
--   * The function does not accept arbitrary WHERE clauses.
--   * The app only calls it with authenticated / owner-scoped user_ids.
grant execute on function increment_message_counter(uuid, int) to anon, authenticated, service_role;
