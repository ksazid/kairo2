begin;

create table if not exists public_signals (
  id text primary key,
  title text not null check (length(trim(title)) > 0),
  summary text null,
  source_url text not null,
  duplicate_key text not null,
  platform text not null,
  publisher text null,
  author text null,
  published_at timestamptz null,
  retrieved_at timestamptz not null,
  provider text not null,
  provider_version text null,
  content_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_public_signals_duplicate_key unique (duplicate_key),
  constraint ck_public_signals_content_hash check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists uq_public_signals_content_hash
  on public_signals (content_hash) where content_hash is not null;

create index if not exists ix_public_signals_retrieved
  on public_signals (retrieved_at desc, id);

create table if not exists brand_opportunities (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  rationale text not null check (length(trim(rationale)) > 0),
  why_now text not null check (length(trim(why_now)) > 0),
  development_direction text not null check (length(trim(development_direction)) > 0),
  status text not null default 'new' check (status in ('new','saved','ignored','developing')),
  relevance double precision not null check (relevance between 0 and 1),
  evidence double precision not null check (evidence between 0 and 1),
  novelty double precision not null check (novelty between 0 and 1),
  timeliness double precision not null check (timeliness between 0 and 1),
  brand_authority double precision not null check (brand_authority between 0 and 1),
  audience_fit double precision not null check (audience_fit between 0 and 1),
  overall double precision not null check (overall between 0 and 1),
  scoring_version text not null,
  brand_context_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_brand_opportunities_scope_rank
  on brand_opportunities (workspace_id, brand_id, status, overall desc, created_at desc, id);

create table if not exists brand_opportunity_signals (
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  opportunity_id text not null references brand_opportunities(id) on delete cascade,
  signal_id text not null references public_signals(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, brand_id, opportunity_id, signal_id)
);

create index if not exists ix_brand_opportunity_signals_signal
  on brand_opportunity_signals (signal_id, workspace_id, brand_id);

commit;
