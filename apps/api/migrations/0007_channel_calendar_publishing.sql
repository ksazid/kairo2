create unique index uq_brands_workspace_scope on brands(workspace_id,id);

create table channel_accounts (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  channel text not null check (channel in ('linkedin','instagram','manual')),
  account_ref text not null,
  display_name text not null,
  credential_ref text not null,
  capabilities jsonb not null default '[]'::jsonb,
  status text not null check (status in ('connected','reconnect-required','disabled')),
  connected_at timestamptz not null,
  foreign key (workspace_id,brand_id) references brands(workspace_id,id),
  unique (workspace_id,brand_id,id,channel,account_ref),
  unique (brand_id,channel,account_ref)
);

create unique index content_approvals_publish_scope
  on content_approvals(workspace_id,brand_id,campaign_id,asset_id,version_id,version,id);

create table publish_commands (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  campaign_id text not null,
  asset_id text not null,
  version_id text not null,
  version integer not null check (version > 0),
  approval_id text not null unique,
  channel_account_id text not null,
  channel text not null check (channel in ('linkedin','instagram','manual')),
  account_ref text not null,
  content_type text not null check (content_type in ('text','image','video','carousel')),
  scheduled_for timestamptz not null,
  status text not null check (status in ('scheduled','dispatching','published','failed','unknown','manual-required','cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  created_at timestamptz not null,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  foreign key (workspace_id,brand_id,campaign_id,asset_id,version_id,version,approval_id)
    references content_approvals(workspace_id,brand_id,campaign_id,asset_id,version_id,version,id),
  foreign key (workspace_id,brand_id,channel_account_id,channel,account_ref)
    references channel_accounts(workspace_id,brand_id,id,channel,account_ref)
);
create index publish_commands_calendar on publish_commands(brand_id,scheduled_for,id);
create index publish_commands_due on publish_commands(status,coalesce(next_attempt_at,scheduled_for)) where status='scheduled';

create table publish_attempts (
  id text primary key,
  command_id text not null references publish_commands(id),
  version_id text not null,
  idempotency_key text not null,
  attempt_number integer not null check (attempt_number between 1 and 3),
  status text not null check (status in ('dispatching','published','failed','unknown')),
  started_at timestamptz not null,
  completed_at timestamptz,
  external_post_id text,
  provider_correlation_id text,
  failure_code text,
  unique(command_id,attempt_number),
  unique(idempotency_key,attempt_number),
  check (status <> 'published' or (external_post_id is not null and completed_at is not null))
);

create table published_posts (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  campaign_id text not null,
  asset_id text not null,
  version_id text not null,
  publish_command_id text not null unique references publish_commands(id),
  channel text not null,
  account_ref text not null,
  external_post_id text not null,
  published_at timestamptz not null,
  unique(channel,account_ref,external_post_id)
);
