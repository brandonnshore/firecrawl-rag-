-- Add sites to supabase_realtime so the /dashboard/setup page's
-- postgres_changes channel receives live UPDATEs as crawl_page_count
-- increments on each Firecrawl `page` webhook event. Without this,
-- the page falls back to 3s polling (still works, just chunkier).
--
-- Guarded with pg_publication_tables check so the migration is
-- idempotent (safe to re-run, safe on fresh databases where the
-- publication already carries sites, etc.).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sites'
  ) then
    alter publication supabase_realtime add table sites;
  end if;
end $$;
