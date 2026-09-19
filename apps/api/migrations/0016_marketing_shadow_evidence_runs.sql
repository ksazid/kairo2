create table marketing_shadow_evidence_runs (
  run_id text primary key,
  release_sha text not null,
  status text not null check (status in ('started','completed','failed')),
  evidence jsonb,
  failure_kind text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check (run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  check (release_sha ~ '^[0-9a-f]{40}$'),
  check (failure_kind is null or failure_kind ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,63}$'),
  check (
    (status='started' and evidence is null and failure_kind is null and finished_at is null)
    or
    (status='completed' and evidence is not null and failure_kind is null and finished_at is not null)
    or
    (status='failed' and evidence is null and failure_kind is not null and finished_at is not null)
  )
);

create index marketing_shadow_evidence_runs_status_started
  on marketing_shadow_evidence_runs(status,started_at desc);
