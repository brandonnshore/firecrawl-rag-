-- M5F5 file-rag-integration
-- Extend match_chunks so file-sourced embeddings (source_type='file') are
-- returned alongside crawl-sourced embeddings, and expose source_type so
-- the system-prompt layer can cite them distinctly.
--
-- File embeddings are NOT subject to the crawl batch swap (they live
-- across billing periods), so we only gate them on site_id + crawl_status.
--
-- Drop the old function first — Postgres refuses CREATE OR REPLACE when
-- the return-type columns change (we're adding source_type).

drop function if exists match_chunks(vector, text, uuid, double precision, integer);

create function match_chunks(
  query_embedding extensions.vector(1536),
  query_text text,
  p_site_id uuid,
  match_threshold float default 0.5,
  match_count int default 5
)
returns table (
  id bigint,
  chunk_text text,
  source_url text,
  source_type text,
  similarity float
)
language sql stable
set search_path = public, extensions
as $$
  select
    e.id,
    e.chunk_text,
    e.source_url,
    coalesce(e.source_type, 'crawl') as source_type,
    (0.7 * (1 - (e.embedding <=> query_embedding))) +
    (0.3 * coalesce(ts_rank(e.text_search, websearch_to_tsquery('english', query_text)), 0))
      as similarity
  from embeddings e
  join sites s on s.id = e.site_id
  where e.site_id = p_site_id
    and s.crawl_status = 'ready'
    and (1 - (e.embedding <=> query_embedding)) > match_threshold
    and (
      -- file-sourced chunks: no batch gate (they persist across crawls)
      e.source_type = 'file'
      or
      -- crawl-sourced chunks (or legacy NULL): must match active batch
      (coalesce(e.source_type, 'crawl') = 'crawl'
        and e.crawl_batch = s.active_crawl_batch)
    )
  order by similarity desc
  limit least(match_count, 20);
$$;
