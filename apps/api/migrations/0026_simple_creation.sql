create table simple_creation_requests (
  id text primary key,
  account_id text not null references accounts(id),
  workspace_id text not null references workspaces(id),
  brand_id text not null references brands(id),
  goal text not null,
  input_text text,
  source text,
  content_preference text not null,
  status text not null default 'queued',
  idea_id text references ideas(id),
  recommended_angle_id text references angles(id),
  campaign_id text references campaigns(id),
  recommendation jsonb,
  attempt integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint simple_creation_status check (status in ('queued','understanding-goal','researching','choosing-angle','building-campaign','ready','needs-attention')),
  constraint simple_creation_preference check (content_preference in ('auto','carousel','reel','image','campaign')),
  constraint simple_creation_ready check (status <> 'ready' or (idea_id is not null and recommended_angle_id is not null and campaign_id is not null and recommendation is not null)),
  constraint simple_creation_failure check (status <> 'needs-attention' or failure_reason is not null)
);
create index simple_creation_claim_idx on simple_creation_requests(status, lease_expires_at, created_at);
create index simple_creation_brand_idx on simple_creation_requests(workspace_id, brand_id, created_at desc);
