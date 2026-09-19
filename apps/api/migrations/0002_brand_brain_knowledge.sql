begin;

create table if not exists knowledge_sources (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  source_type text not null check (source_type in ('url','website','document','note','pasted','research','product')),
  status text not null check (status in ('active','disabled','replaced','removed','quarantined','failed')),
  title text null,
  source_url text null,
  raw_content text null,
  content_type text null,
  size_bytes bigint null check (size_bytes is null or size_bytes > 0),
  content_hash text null,
  object_key text null,
  created_by_account_id text null references accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz null,
  constraint ck_removed_source_is_content_free check (
    status <> 'removed' or (
      title is null and source_url is null and raw_content is null and content_type is null and
      size_bytes is null and content_hash is null and object_key is null and removed_at is not null
    )
  )
);

create index if not exists ix_knowledge_sources_brand
  on knowledge_sources (workspace_id, brand_id, created_at, id);
create index if not exists ix_knowledge_sources_active
  on knowledge_sources (workspace_id, brand_id, status) where status <> 'removed';

create table if not exists brand_brain_fields (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  section text not null check (section in ('identity','positioning','audience','voice','content-strategy','goals','boundaries')),
  field_key text not null,
  value text not null,
  state text not null check (state in ('inferred','confirmed','stale')),
  version integer not null default 1 check (version > 0),
  confirmed_by_account_id text null references accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_brand_brain_field unique (brand_id, field_key)
);

create index if not exists ix_brand_brain_fields_brand
  on brand_brain_fields (workspace_id, brand_id, section, field_key);

create table if not exists brand_brain_field_sources (
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  field_id text not null references brand_brain_fields(id) on delete cascade,
  source_id text not null references knowledge_sources(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (field_id, source_id)
);

create index if not exists ix_brand_brain_field_sources_source
  on brand_brain_field_sources (workspace_id, brand_id, source_id, field_id);

create table if not exists knowledge_source_derivations (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  source_id text not null references knowledge_sources(id) on delete cascade,
  derivation_type text not null,
  locator text null,
  created_at timestamptz not null default now()
);

create index if not exists ix_knowledge_source_derivations_source
  on knowledge_source_derivations (workspace_id, brand_id, source_id, id);

commit;
