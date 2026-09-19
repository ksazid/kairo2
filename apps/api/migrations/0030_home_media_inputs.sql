begin;

alter table simple_creation_requests
  drop constraint simple_creation_preference,
  add column media_asset_ids jsonb not null default '[]'::jsonb,
  add column asset_id text references content_assets(id) on delete set null,
  add constraint simple_creation_preference check (content_preference in ('auto','carousel','reel','image','video','campaign')),
  add constraint simple_creation_media_asset_ids_array check (jsonb_typeof(media_asset_ids) = 'array'),
  add constraint simple_creation_media_asset_ids_bounded check (jsonb_array_length(media_asset_ids) <= 12);

create table media_assets (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  source text not null default 'uploaded' check (source in ('uploaded','generated','brand-asset')),
  object_key text not null unique,
  thumbnail_object_key text,
  poster_object_key text,
  original_filename text not null,
  kind text not null check (kind in ('image','video')),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  checksum text,
  status text not null check (status in ('uploading','processing','ready','failed')),
  upload_expires_at timestamptz,
  failure_reason text,
  library_asset_id text references content_library_assets(id) on delete set null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  ready_at timestamptz
);

create index media_assets_brand_ready_idx
  on media_assets(workspace_id, brand_id, status, created_at desc);

create index media_assets_account_brand_idx
  on media_assets(account_id, brand_id, status);

commit;
