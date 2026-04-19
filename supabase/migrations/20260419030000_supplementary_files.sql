-- M5F1 supplementary-files-schema-storage
-- Table + cascades + RLS for knowledge uploads, plus Storage bucket
-- with per-user-folder object policies.

-- ============================================
-- TABLE
-- ============================================
create table supplementary_files (
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

create index supplementary_files_site_id_idx on supplementary_files (site_id);
create index supplementary_files_status_idx on supplementary_files (status);

-- ============================================
-- RLS — owner read/delete via site ownership
-- ============================================
alter table supplementary_files enable row level security;

-- Owner can SELECT own-site files.
create policy "Users read own site files"
  on supplementary_files for select
  using (
    exists (
      select 1 from sites
      where sites.id = supplementary_files.site_id
        and sites.user_id = auth.uid()
    )
  );

-- Owner can DELETE own-site files (used by /api/files/{id} in M5F4 when
-- the caller's session is the authenticated user, not the service role).
create policy "Users delete own site files"
  on supplementary_files for delete
  using (
    exists (
      select 1 from sites
      where sites.id = supplementary_files.site_id
        and sites.user_id = auth.uid()
    )
  );

-- INSERT + UPDATE remain service-role-only: the upload API uses the
-- service-role client to write rows and transition status. Users can't
-- directly write rows via PostgREST.

-- ============================================
-- EMBEDDINGS: source metadata (extend for M5F3)
-- ============================================
-- Add source_type + file_id so file-sourced chunks can be filtered
-- independently and cascade-deleted with their file. NULL source_type
-- is treated as 'crawl' by the retrieval side.
alter table embeddings
  add column source_type text
    check (source_type in ('crawl', 'file')) default 'crawl',
  add column file_id uuid references supplementary_files(id) on delete cascade;

create index embeddings_file_id_idx on embeddings (file_id) where file_id is not null;

-- ============================================
-- STORAGE BUCKET + POLICIES
-- ============================================
insert into storage.buckets (id, name, public)
values ('knowledge-files', 'knowledge-files', false)
on conflict (id) do nothing;

-- Per-user-folder RLS: the object path is '{user_id}/{file_id}.{ext}',
-- so the first path segment must match auth.uid().
create policy "Users manage own knowledge-files folder (select)"
  on storage.objects for select
  using (
    bucket_id = 'knowledge-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users manage own knowledge-files folder (insert)"
  on storage.objects for insert
  with check (
    bucket_id = 'knowledge-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users manage own knowledge-files folder (delete)"
  on storage.objects for delete
  using (
    bucket_id = 'knowledge-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
