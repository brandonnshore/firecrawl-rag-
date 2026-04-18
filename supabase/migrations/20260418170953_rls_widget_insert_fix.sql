-- M1F2 fix: the original widget insert policies on leads / conversations use
-- `exists (select 1 from sites ...)` which can't see sites under the `anon`
-- role because sites RLS filters by `user_id = auth.uid()`. The API route
-- always uses service-role, but VAL-RLS-010 asserts defense-in-depth at the
-- RLS layer. Swap the exists() check for a security-definer helper that
-- bypasses sites RLS just for the existence probe.

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
