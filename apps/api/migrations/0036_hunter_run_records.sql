begin;

create table if not exists hunter_run_records (
  run_id text primary key,
  schema_version text not null,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  snapshot_version text not null,
  plan_version text not null,
  trigger text not null check (trigger in ('manual','scheduled')),
  status text not null check (status in ('running','succeeded','failed')),
  started_at timestamptz not null,
  completed_at timestamptz null,
  duration_ms integer null check (duration_ms is null or duration_ms >= 0),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  opportunity_count integer not null default 0 check (opportunity_count >= 0),
  sources_scanned jsonb not null default '[]'::jsonb,
  degraded_sources jsonb not null default '[]'::jsonb,
  failure_code text null,
  failure_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_hunter_run_terminal_shape check (
    (status = 'running' and completed_at is null and duration_ms is null and failure_code is null and failure_message is null)
    or
    (status = 'succeeded' and completed_at is not null and duration_ms is not null and failure_code is null and failure_message is null)
    or
    (status = 'failed' and completed_at is not null and duration_ms is not null and failure_code is not null and failure_message is not null)
  )
);

create index if not exists ix_hunter_run_records_brand_recent
  on hunter_run_records (workspace_id, brand_id, started_at desc, run_id);

create index if not exists ix_hunter_run_records_lineage
  on hunter_run_records (brand_id, snapshot_version, plan_version, started_at desc);

commit;
