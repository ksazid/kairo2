begin;

create table content_asset_credentials (
  credential_ref text primary key,
  workspace_id text not null references workspaces(id),
  brand_id text not null references brands(id),
  provider text not null check (provider in ('google-drive')),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revoked_at timestamptz,
  unique (workspace_id, brand_id, credential_ref),
  check (length(ciphertext) > 0 and length(iv) > 0 and length(auth_tag) > 0)
);

create index content_asset_credentials_active
  on content_asset_credentials(workspace_id, brand_id, provider)
  where revoked_at is null;

create table content_asset_oauth_intents (
  id text primary key,
  workspace_id text not null references workspaces(id),
  brand_id text not null references brands(id),
  library_id text not null references content_asset_libraries(id) on delete cascade,
  account_id text not null references accounts(id),
  provider text not null check (provider in ('google-drive')),
  state_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null,
  unique (provider, state_hash),
  check (length(state_hash) = 64),
  check (expires_at > created_at)
);

create index content_asset_oauth_intents_scope
  on content_asset_oauth_intents(account_id, brand_id, library_id, created_at desc);

create table content_asset_provider_connections (
  id text primary key,
  workspace_id text not null references workspaces(id),
  brand_id text not null references brands(id),
  library_id text not null references content_asset_libraries(id) on delete cascade,
  provider text not null check (provider in ('google-drive')),
  credential_ref text not null,
  granted_scopes jsonb not null default '[]'::jsonb,
  connected_at timestamptz not null,
  last_verified_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (workspace_id, brand_id, credential_ref)
    references content_asset_credentials(workspace_id, brand_id, credential_ref),
  unique (library_id)
);

create index content_asset_provider_connections_active
  on content_asset_provider_connections(workspace_id, brand_id, provider)
  where revoked_at is null;

commit;
