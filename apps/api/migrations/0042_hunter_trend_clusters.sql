begin;

create table if not exists hunter_trend_clusters (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  topic text not null,
  stage text not null check (stage in ('emerging','rising','accelerating','mature','saturated','declining','evergreen')),
  feature_version text not null,
  features jsonb not null,
  evidence_confidence double precision not null check (evidence_confidence between 0 and 1),
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hunter_trend_clusters_time_order check (first_observed_at <= last_observed_at),
  constraint hunter_trend_clusters_features_object check (jsonb_typeof(features)='object')
);

create table if not exists hunter_trend_cluster_signals (
  workspace_id text not null,
  brand_id text not null,
  trend_id text not null references hunter_trend_clusters(id) on delete cascade,
  signal_id text not null references public_signals(id) on delete cascade,
  primary key (workspace_id,brand_id,trend_id,signal_id)
);

create index if not exists ix_hunter_trend_clusters_brand_recent
  on hunter_trend_clusters(workspace_id,brand_id,last_observed_at desc);

commit;
