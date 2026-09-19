create table metric_snapshots (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  published_post_id text not null references published_posts(id),
  campaign_id text not null,
  asset_id text not null,
  version_id text not null,
  channel text not null,
  account_ref text not null,
  external_post_id text not null,
  provider text not null check(provider in ('linkedin','instagram')),
  captured_at timestamptz not null,
  raw jsonb not null,
  provider_request_id text,
  foreign key(workspace_id,brand_id) references brands(workspace_id,id),
  unique(published_post_id,provider,captured_at)
);
create index metric_snapshots_brand_time on metric_snapshots(brand_id,captured_at desc);

create table normalized_metrics (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  published_post_id text not null references published_posts(id),
  name text not null,
  captured_at timestamptz not null,
  status text not null check(status in ('available','unavailable')),
  value double precision,
  unavailable_reason text,
  source_snapshot_id text not null references metric_snapshots(id),
  source_field text not null,
  transformation_version text not null,
  check((status='available' and value is not null and value>=0 and unavailable_reason is null) or (status='unavailable' and value is null and unavailable_reason is not null)),
  foreign key(workspace_id,brand_id) references brands(workspace_id,id),
  unique(source_snapshot_id,name,transformation_version)
);
create index normalized_metrics_brand_name_time on normalized_metrics(brand_id,name,captured_at desc);
