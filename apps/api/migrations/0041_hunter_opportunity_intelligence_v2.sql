begin;

create table if not exists opportunity_intelligence_v2 (
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  opportunity_id text not null references brand_opportunities(id) on delete cascade,
  schema_version text not null default '2',
  ranking_version text not null,
  eei_version text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id,brand_id,opportunity_id),
  constraint opportunity_intelligence_v2_payload_object check (jsonb_typeof(payload)='object')
);

create index if not exists ix_opportunity_intelligence_v2_versions
  on opportunity_intelligence_v2(workspace_id,brand_id,ranking_version,eei_version);

commit;
