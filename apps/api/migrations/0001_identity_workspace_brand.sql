begin;

create table if not exists accounts (
  id text primary key,
  email text null,
  display_name text null,
  created_at timestamptz not null default now()
);

create table if not exists external_identities (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  provider text not null,
  subject text not null,
  created_at timestamptz not null default now(),
  constraint uq_external_identity unique (provider, subject)
);

create table if not exists workspaces (
  id text primary key,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists workspace_memberships (
  workspace_id text not null references workspaces(id) on delete cascade,
  account_id text not null references accounts(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (workspace_id, account_id)
);

create index if not exists ix_workspace_memberships_account
  on workspace_memberships (account_id, active, workspace_id);

create table if not exists brands (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  public_source_url text null,
  public_profile_url text null,
  created_at timestamptz not null default now()
);

create index if not exists ix_brands_workspace on brands (workspace_id, created_at, id);

create table if not exists audit_events (
  id text primary key,
  workspace_id text null references workspaces(id) on delete cascade,
  account_id text null references accounts(id) on delete set null,
  event_type text not null,
  subject_id text null,
  created_at timestamptz not null default now()
);

commit;
