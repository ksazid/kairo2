begin;

create table if not exists opportunity_concept_mockup_assets (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  opportunity_id text not null,
  kind text not null check (kind in ('post','carousel-slide','reel-poster','reel-video')),
  position integer not null check (position >= 0),
  status text not null check (status in ('ready','failed')),
  storage_provider text not null,
  storage_key text not null,
  mime_type text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  prompt_version text not null,
  failure_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, brand_id, opportunity_id, kind, position),
  foreign key (workspace_id, brand_id, opportunity_id)
    references brand_opportunities(workspace_id, brand_id, id) on delete cascade
);

create index if not exists ix_opportunity_concept_mockup_assets_scope
  on opportunity_concept_mockup_assets(workspace_id, brand_id, opportunity_id, position);

commit;
