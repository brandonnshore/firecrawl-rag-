-- Fix: file-sourced embeddings have no page_id, but the embeddings table
-- still enforces NOT NULL on page_id from the initial schema. M5F1 added
-- file_id + source_type but never relaxed the page_id constraint, so every
-- knowledge-file upload fails at insert time with:
--   null value in column "page_id" of relation "embeddings"
--   violates not-null constraint
--
-- Make page_id nullable and add a CHECK that enforces exactly one of
-- (page_id for crawl rows) / (file_id for file rows).

alter table embeddings alter column page_id drop not null;

alter table embeddings
  add constraint embeddings_source_consistency
  check (
    (coalesce(source_type, 'crawl') = 'crawl'
       and page_id is not null
       and file_id is null)
    or
    (source_type = 'file'
       and file_id is not null
       and page_id is null)
  );
