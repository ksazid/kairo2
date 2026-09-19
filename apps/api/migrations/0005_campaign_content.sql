begin;

create table campaigns (
  id text primary key, workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade, idea_id text not null references ideas(id),
  research_id text not null references research_dossiers(id), angle_id text not null references angles(id),
  name text not null check(length(trim(name))>0), objective text not null check(length(trim(objective))>0),
  supporting_claim_ids jsonb not null check(jsonb_typeof(supporting_claim_ids)='array'),
  status text not null check(status='draft'), created_at timestamptz not null,
  unique(workspace_id,brand_id,id)
);
create index ix_campaigns_scope on campaigns(workspace_id,brand_id,created_at desc,id);

create table content_assets (
  id text primary key, workspace_id text not null, brand_id text not null, campaign_id text not null,
  channel text not null check(channel in ('linkedin','instagram','manual')), format text not null,
  audience text not null, topic text not null, hook_type text not null, cta text not null,
  supporting_claim_ids jsonb not null check(jsonb_typeof(supporting_claim_ids)='array'),
  current_version integer not null default 0 check(current_version>=0), status text not null check(status='draft'), created_at timestamptz not null,
  foreign key(workspace_id,brand_id,campaign_id) references campaigns(workspace_id,brand_id,id) on delete cascade,
  unique(campaign_id,id)
);

create table content_versions (
  id text primary key, workspace_id text not null, brand_id text not null, campaign_id text not null,
  asset_id text not null, version integer not null check(version>0), parent_version_id text null references content_versions(id),
  content text not null check(length(trim(content))>0), supporting_claim_ids jsonb not null check(jsonb_typeof(supporting_claim_ids)='array'),
  actor text not null check(actor in ('user','ai')),
  action text not null check(action in ('initial-draft','alternative','simplify','expand','adjust-depth','strengthen-opening','regenerate-section','manual-edit')),
  provenance jsonb null check(provenance is null or jsonb_typeof(provenance)='object'), created_at timestamptz not null,
  foreign key(campaign_id,asset_id) references content_assets(campaign_id,id) on delete cascade,
  unique(asset_id,version)
);
create index ix_content_versions_history on content_versions(asset_id,version);

commit;
