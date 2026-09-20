begin;

create extension if not exists vector;

create table if not exists hunter_semantic_embeddings (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'public-signal','brand-topic','opportunity','accepted-learning','published-mechanism'
  )),
  entity_id text not null,
  chunk_key text not null default 'document',
  schema_version text not null default '1',
  provider text not null,
  model text not null,
  dimensions integer not null check (dimensions between 1 and 8192),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  embedding vector not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,brand_id,entity_type,entity_id,chunk_key,provider,model)
);

create index if not exists ix_hunter_semantic_embeddings_lookup
  on hunter_semantic_embeddings(workspace_id,brand_id,entity_type,provider,model,dimensions);

create index if not exists ix_hunter_semantic_embeddings_entity
  on hunter_semantic_embeddings(workspace_id,brand_id,entity_type,entity_id);

comment on table hunter_semantic_embeddings is
  'Shadow-only semantic embedding storage for Hunter. No ANN index or production ranking authority is introduced by migration 0044.';

comment on column hunter_semantic_embeddings.embedding is
  'Provider-neutral pgvector value. Provider/model/dimensions are stored explicitly; ANN indexing is deferred until one representation is validated.';

commit;
