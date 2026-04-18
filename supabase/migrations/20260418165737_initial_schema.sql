-- Enable pgvector
create extension if not exists vector with schema extensions;

-- ============================================
-- PROFILES (extends Supabase auth.users)
-- ============================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status text default 'trialing'
    check (subscription_status in ('trialing', 'active', 'cancelled', 'past_due')),
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  trial_ends_at timestamptz default (now() + interval '7 days'),
  created_at timestamptz default now()
);

create index profiles_stripe_customer_id_idx on profiles (stripe_customer_id);

-- ============================================
-- SITES
-- ============================================
create table sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  url text not null,
  name text,
  site_key text unique default encode(gen_random_bytes(16), 'hex'),
  crawl_status text default 'pending'
    check (crawl_status in ('pending', 'crawling', 'indexing', 'ready', 'failed')),
  crawl_job_id text,
  crawl_page_count int default 0 check (crawl_page_count >= 0),
  active_crawl_batch int not null default 0,
  last_crawled_at timestamptz,
  crawl_error_message text,
  calendly_url text,
  google_maps_url text,
  greeting_message text default 'Hi! How can I help you today?',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint sites_user_id_unique unique (user_id)
);

create index sites_user_id_idx on sites (user_id);

-- ============================================
-- PAGES (raw crawled content)
-- ============================================
create table pages (
  id bigint primary key generated always as identity,
  site_id uuid not null references sites(id) on delete cascade,
  url text not null,
  title text,
  content text not null,
  content_hash text,
  crawl_batch int not null default 1 check (crawl_batch >= 1),
  created_at timestamptz default now(),
  constraint pages_site_url_batch_unique unique (site_id, url, crawl_batch)
);

create index pages_site_id_idx on pages (site_id);

-- ============================================
-- EMBEDDINGS (vector chunks)
-- ============================================
create table embeddings (
  id bigint primary key generated always as identity,
  site_id uuid not null references sites(id) on delete cascade,
  page_id bigint not null references pages(id) on delete cascade,
  chunk_text text not null,
  source_url text not null,
  embedding extensions.vector(1536),
  text_search tsvector generated always as (to_tsvector('english', chunk_text)) stored,
  crawl_batch int not null default 1 check (crawl_batch >= 1),
  created_at timestamptz default now()
);

-- HNSW index for fast similarity search
create index embeddings_vector_idx on embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Composite index for site + batch filtering
create index embeddings_site_batch_idx on embeddings (site_id, crawl_batch);

-- GIN index for full-text keyword search (hybrid search)
create index embeddings_text_search_idx on embeddings using gin (text_search);

-- ============================================
-- LEADS
-- ============================================
create table leads (
  id bigint primary key generated always as identity,
  site_id uuid not null references sites(id) on delete cascade,
  conversation_id uuid,
  name text,
  email text not null,
  message text,
  source_page text,
  created_at timestamptz default now(),
  constraint leads_site_email_unique unique (site_id, email)
);

create index leads_site_id_idx on leads (site_id);

-- ============================================
-- CONVERSATIONS
-- ============================================
create table conversations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  visitor_id text not null,
  messages jsonb default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array'),
  message_count int default 0,
  last_message_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index conversations_site_id_idx on conversations (site_id);
create index conversations_visitor_id_idx on conversations (visitor_id);

-- Add FK from leads to conversations
alter table leads
  add constraint leads_conversation_id_fk
  foreign key (conversation_id) references conversations(id) on delete set null;

-- ============================================
-- STRIPE WEBHOOK IDEMPOTENCY
-- ============================================
create table processed_stripe_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz default now()
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table profiles enable row level security;
alter table sites enable row level security;
alter table pages enable row level security;
alter table embeddings enable row level security;
alter table leads enable row level security;
alter table conversations enable row level security;

-- Profiles: users can only read/update their own
create policy "Users own their profile"
  on profiles for all using (id = auth.uid());

-- Sites: users can only access their own sites
create policy "Users own their sites"
  on sites for all using (user_id = auth.uid());

-- Pages: users can access pages for their sites
create policy "Users access own site pages"
  on pages for select using (
    exists (select 1 from sites where sites.id = pages.site_id and sites.user_id = auth.uid())
  );

create policy "Users insert own site pages"
  on pages for insert with check (
    exists (select 1 from sites where sites.id = pages.site_id and sites.user_id = auth.uid())
  );

-- Embeddings: users can access embeddings for their sites
create policy "Users access own site embeddings"
  on embeddings for select using (
    exists (select 1 from sites where sites.id = embeddings.site_id and sites.user_id = auth.uid())
  );

-- Leads: authenticated users access their own; anonymous widget can insert
create policy "Users access own site leads"
  on leads for select using (
    exists (select 1 from sites where sites.id = leads.site_id and sites.user_id = auth.uid())
  );

create policy "Widget can insert leads"
  on leads for insert with check (
    exists (select 1 from sites where sites.id = leads.site_id and sites.site_key is not null)
  );

-- Conversations: authenticated users access their own; anonymous widget can insert/update
create policy "Users access own site conversations"
  on conversations for select using (
    exists (select 1 from sites where sites.id = conversations.site_id and sites.user_id = auth.uid())
  );

create policy "Widget can insert conversations"
  on conversations for insert with check (
    exists (select 1 from sites where sites.id = conversations.site_id and sites.site_key is not null)
  );

-- ============================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================
-- VECTOR SIMILARITY SEARCH FUNCTION (Hybrid)
-- ============================================
create or replace function match_chunks(
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
  similarity float
)
language sql stable
set search_path = public, extensions
as $$
  select
    e.id,
    e.chunk_text,
    e.source_url,
    (0.7 * (1 - (e.embedding <=> query_embedding))) +
    (0.3 * coalesce(ts_rank(e.text_search, websearch_to_tsquery('english', query_text)), 0))
      as similarity
  from embeddings e
  join sites s on s.id = e.site_id
  where e.site_id = p_site_id
    and s.crawl_status = 'ready'
    and e.crawl_batch = s.active_crawl_batch
    and (1 - (e.embedding <=> query_embedding)) > match_threshold
  order by similarity desc
  limit least(match_count, 20);
$$;

-- Enable Realtime for sites table (required for live crawl status updates on setup page)
alter publication supabase_realtime add table sites;

-- ============================================
-- CHAT SESSIONS (for streaming handoff)
-- ============================================
-- The chat widget does POST /api/chat/session → GET /api/chat/stream
-- On serverless runtimes each request can hit a different instance,
-- so the session must live in a shared store (not in-memory).
-- 60-second TTL — sessions are consumed immediately by the stream.

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null,
  expires_at timestamptz not null default (now() + interval '60 seconds'),
  created_at timestamptz default now()
);

create index chat_sessions_expires_at_idx on chat_sessions (expires_at);

-- Row-level security: sessions are only touched by service-role code,
-- never directly from the client, so we just lock it down entirely.
alter table chat_sessions enable row level security;
