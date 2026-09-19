begin;

create table if not exists brand_intelligence_graph_versions (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  version integer not null check (version >= 1),
  schema_version integer not null default 2 check (schema_version >= 2),
  sector_pack text not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  graph jsonb not null,
  created_at timestamptz not null default now(),
  constraint uq_brand_intelligence_graph_version unique (workspace_id, brand_id, version),
  constraint uq_brand_intelligence_graph_fingerprint unique (workspace_id, brand_id, fingerprint)
);

create index if not exists ix_brand_intelligence_graph_latest
  on brand_intelligence_graph_versions (workspace_id, brand_id, version desc, created_at desc);

alter table brand_opportunities
  add column if not exists brand_intelligence_graph_version integer null;

create index if not exists ix_brand_opportunities_graph_version
  on brand_opportunities (workspace_id, brand_id, brand_intelligence_graph_version)
  where brand_intelligence_graph_version is not null;

commit;
