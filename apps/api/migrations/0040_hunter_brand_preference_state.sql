begin;

create table if not exists brand_preference_states (
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  schema_version text not null default '1',
  snapshot_version text not null,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id,brand_id),
  constraint brand_preference_states_state_object check (jsonb_typeof(state)='object')
);

create index if not exists ix_brand_preference_states_updated
  on brand_preference_states(workspace_id,updated_at desc);

commit;
