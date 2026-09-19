begin;

create table if not exists opportunity_feedback_events (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  opportunity_id text not null references brand_opportunities(id) on delete cascade,
  account_id text not null references accounts(id) on delete cascade,
  action text not null check (action in ('seen','dismissed')),
  created_at timestamptz not null default now(),
  constraint uq_opportunity_feedback_once unique (workspace_id, brand_id, opportunity_id, account_id, action)
);

create index if not exists ix_opportunity_feedback_brand_recent
  on opportunity_feedback_events (workspace_id, brand_id, created_at desc, id);

commit;
