alter table channel_accounts
  add column if not exists provider_page_ref text,
  add column if not exists username text,
  add column if not exists granted_scopes jsonb not null default '[]'::jsonb,
  add column if not exists insights_credential_ref text,
  add column if not exists last_verified_at timestamptz,
  add column if not exists token_expires_at timestamptz;

create table channel_credentials (
  credential_ref text primary key,
  workspace_id text not null,
  brand_id text not null,
  provider text not null check (provider in ('meta-instagram')),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (workspace_id,brand_id) references brands(workspace_id,id),
  unique (workspace_id,brand_id,credential_ref),
  check (length(ciphertext) > 0 and length(iv) > 0 and length(auth_tag) > 0)
);
create index channel_credentials_brand_active on channel_credentials(brand_id,provider) where revoked_at is null;

alter table channel_accounts
  add constraint channel_accounts_insights_credential_fk
  foreign key (workspace_id,brand_id,insights_credential_ref)
  references channel_credentials(workspace_id,brand_id,credential_ref);

create table channel_oauth_intents (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  account_id text not null references accounts(id),
  provider text not null check (provider in ('meta-instagram')),
  state_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null,
  foreign key (workspace_id,brand_id) references brands(workspace_id,id),
  unique (provider,state_hash),
  check (length(state_hash) = 64),
  check (expires_at > created_at)
);
create index channel_oauth_intents_account_brand on channel_oauth_intents(account_id,brand_id,created_at desc);

create table channel_oauth_candidates (
  id text primary key,
  intent_id text not null references channel_oauth_intents(id) on delete cascade,
  workspace_id text not null,
  brand_id text not null,
  account_id text not null references accounts(id),
  page_ref text not null,
  page_name text not null,
  account_ref text not null,
  display_name text not null,
  username text,
  credential_ref text not null,
  insights_credential_ref text not null,
  token_expires_at timestamptz not null,
  granted_scopes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  selected_at timestamptz,
  foreign key (workspace_id,brand_id) references brands(workspace_id,id),
  foreign key (workspace_id,brand_id,credential_ref) references channel_credentials(workspace_id,brand_id,credential_ref),
  foreign key (workspace_id,brand_id,insights_credential_ref) references channel_credentials(workspace_id,brand_id,credential_ref),
  unique (intent_id,account_ref),
  check (token_expires_at > created_at)
);
create index channel_oauth_candidates_scope on channel_oauth_candidates(account_id,brand_id,intent_id);
create unique index channel_oauth_candidates_one_selected on channel_oauth_candidates(intent_id) where selected_at is not null;

create table metric_collection_jobs (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  published_post_id text not null references published_posts(id),
  provider text not null check (provider in ('instagram','linkedin')),
  account_ref text not null,
  external_post_id text not null,
  credential_ref text not null,
  scheduled_for timestamptz not null,
  status text not null check (status in ('queued','running','complete','failed','unavailable')),
  attempt integer not null default 0 check (attempt between 0 and 3),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  failure_code text,
  unavailable_reason text,
  created_at timestamptz not null,
  completed_at timestamptz,
  foreign key (workspace_id,brand_id) references brands(workspace_id,id),
  unique (published_post_id,provider,scheduled_for)
);
create index metric_collection_jobs_due on metric_collection_jobs(status,coalesce(next_attempt_at,scheduled_for)) where status='queued';
