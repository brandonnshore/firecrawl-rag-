-- M4F5 tos-acceptance-signup
-- Record when a user accepted Terms of Service. NULL for legacy users;
-- they see an acceptance banner on their next dashboard visit.

alter table profiles
  add column tos_accepted_at timestamptz;

-- Extend the existing auth.users->profiles creation trigger to pick up
-- the acceptance timestamp from raw_user_meta_data if the signup flow
-- set it. The client passes options.data.tos_accepted_at via
-- signInWithOtp so Supabase stores it on the first auth.users row it
-- creates for this email.
create or replace function handle_new_user()
returns trigger as $$
declare
  v_tos_accepted_at timestamptz;
begin
  -- Pull tos_accepted_at from user metadata if set.
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
