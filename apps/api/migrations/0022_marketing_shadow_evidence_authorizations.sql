create table marketing_shadow_evidence_authorizations (
  run_id text primary key,
  release_sha text not null,
  authorized_at timestamptz not null default now(),
  check (run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  check (release_sha ~ '^[0-9a-f]{40}$')
);

create unique index marketing_shadow_evidence_one_authorization
  on marketing_shadow_evidence_authorizations ((1));
