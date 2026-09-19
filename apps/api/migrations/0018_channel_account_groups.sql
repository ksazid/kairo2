create table if not exists channel_account_groups (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  name text not null,
  member_account_ids jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint channel_account_groups_name_nonempty check (length(btrim(name)) between 1 and 120),
  constraint channel_account_groups_members_array check (jsonb_typeof(member_account_ids) = 'array'),
  constraint channel_account_groups_scope_unique unique (brand_id, id)
);

create index if not exists channel_account_groups_scope_name_idx
  on channel_account_groups(workspace_id, brand_id, lower(name));
