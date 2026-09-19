begin;

create unique index if not exists content_versions_carousel_scope
  on content_versions(workspace_id,brand_id,campaign_id,asset_id,id);

create table carousel_projects (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  campaign_id text not null,
  content_asset_id text not null,
  content_version_id text not null references content_versions(id),
  schema_version integer not null check(schema_version=1),
  structure text not null check(structure in ('aida','pas','listicle','case-study','story','comparison')),
  cover_hook text not null check(length(trim(cover_hook)) between 1 and 300),
  caption text not null check(length(trim(caption)) between 1 and 5000),
  cta text not null check(length(trim(cta)) between 1 and 500),
  supporting_claim_ids jsonb not null check(jsonb_typeof(supporting_claim_ids)='array'),
  template_id text not null,
  style jsonb not null default '{}'::jsonb check(jsonb_typeof(style)='object'),
  revision integer not null default 1 check(revision>0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key(workspace_id,brand_id,campaign_id,content_asset_id,content_version_id)
    references content_versions(workspace_id,brand_id,campaign_id,asset_id,id),
  unique(workspace_id,brand_id,id)
);
create index carousel_projects_asset on carousel_projects(workspace_id,brand_id,content_asset_id,updated_at desc);

create table carousel_project_slides (
  project_id text not null references carousel_projects(id) on delete cascade,
  id text not null,
  position integer not null check(position between 0 and 9),
  role text not null,
  headline text not null check(length(trim(headline)) between 1 and 240),
  body text not null check(length(trim(body)) between 1 and 2000),
  image_asset_id text,
  supporting_claim_ids jsonb not null check(jsonb_typeof(supporting_claim_ids)='array'),
  revision integer not null default 1 check(revision>0),
  updated_at timestamptz not null,
  primary key(project_id,id),
  unique(project_id,position)
);

create table carousel_slide_regeneration_requests (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  project_id text not null,
  slide_id text not null,
  requested_by_account_id text not null references accounts(id),
  instruction text,
  status text not null check(status in ('queued','running','complete','failed')),
  requested_at timestamptz not null,
  completed_at timestamptz,
  foreign key(workspace_id,brand_id,project_id) references carousel_projects(workspace_id,brand_id,id),
  foreign key(project_id,slide_id) references carousel_project_slides(project_id,id)
);
create index carousel_regeneration_queue on carousel_slide_regeneration_requests(status,requested_at,id) where status='queued';

create table carousel_rendered_asset_versions (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  project_id text not null,
  version integer not null check(version>0),
  project_revision integer not null check(project_revision>0),
  storage_provider text not null,
  manifest_object_key text not null,
  manifest_sha256 text not null check(manifest_sha256 ~ '^[a-f0-9]{64}$'),
  media_fingerprint text not null check(media_fingerprint ~ '^[a-f0-9]{64}$'),
  quality_report jsonb not null default '{"findings":[],"blockingErrorCount":0}'::jsonb check(jsonb_typeof(quality_report)='object'),
  status text not null check(status in ('rendering','ready','failed')),
  failure_reason text,
  created_at timestamptz not null,
  ready_at timestamptz,
  foreign key(workspace_id,brand_id,project_id) references carousel_projects(workspace_id,brand_id,id),
  unique(project_id,version),
  unique(storage_provider,manifest_object_key)
);

create table carousel_rendered_slide_assets (
  rendered_version_id text not null references carousel_rendered_asset_versions(id) on delete restrict,
  slide_id text not null,
  position integer not null check(position between 0 and 9),
  object_key text not null,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
  width integer not null check(width>0),
  height integer not null check(height>0),
  size_bytes bigint not null check(size_bytes>0),
  primary key(rendered_version_id,slide_id),
  unique(rendered_version_id,position),
  unique(object_key)
);

create table carousel_rendered_approvals (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  project_id text not null,
  rendered_version_id text not null unique references carousel_rendered_asset_versions(id) on delete restrict,
  content_approval_id text unique references content_approvals(id) on delete restrict,
  approved_by_account_id text not null references accounts(id),
  approved_at timestamptz not null,
  foreign key(workspace_id,brand_id,project_id) references carousel_projects(workspace_id,brand_id,id),
  unique(project_id)
);

create function prevent_approved_carousel_mutation() returns trigger language plpgsql as $$
declare target_project_id text;
begin
  target_project_id:=case when tg_table_name='carousel_projects' then old.id else old.project_id end;
  if exists(select 1 from carousel_rendered_approvals where project_id=target_project_id) then
    raise exception 'Approved Carousel assets are immutable' using errcode='23514';
  end if;
  if tg_op='UPDATE' then return new; end if;
  return old;
end;
$$;
create trigger carousel_projects_approved_immutable before update or delete on carousel_projects for each row execute function prevent_approved_carousel_mutation();
create trigger carousel_slides_approved_immutable before update or delete on carousel_project_slides for each row execute function prevent_approved_carousel_mutation();

alter table publish_commands
  add column if not exists approved_asset_version_id text,
  add column if not exists approved_media_fingerprint text,
  add column if not exists lifecycle_status text,
  add column if not exists meta_container_id text,
  add column if not exists provider_publish_id text,
  add column if not exists failure_reason text,
  add column if not exists published_url text;
update publish_commands set lifecycle_status=case status when 'dispatching' then 'publishing' else 'approved' end where lifecycle_status is null;
alter table publish_commands alter column lifecycle_status set default 'approved',alter column lifecycle_status set not null;
alter table publish_commands
  add constraint publish_commands_asset_fingerprint_check check(approved_media_fingerprint is null or approved_media_fingerprint ~ '^[a-f0-9]{64}$'),
  add constraint publish_commands_lifecycle_status_check check(lifecycle_status in ('approved','publishing','processing','published','failed')),
  add constraint publish_commands_processing_container_check check(lifecycle_status<>'processing' or meta_container_id is not null),
  add constraint publish_commands_published_result_check check(lifecycle_status<>'published' or provider_publish_id is not null),
  add constraint publish_commands_failed_reason_check check(lifecycle_status<>'failed' or failure_reason is not null);

alter table published_posts add column if not exists published_url text;

commit;
