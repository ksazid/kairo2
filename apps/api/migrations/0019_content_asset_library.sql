begin;

create table content_asset_libraries (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  provider text not null check (provider in ('google-drive','manual')),
  status text not null check (status in ('not-connected','connected','needs-attention')),
  external_root_ref text,
  provider_label text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index content_asset_libraries_name_unique on content_asset_libraries(workspace_id, brand_id, lower(name));

create table content_library_assets (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  library_id text not null references content_asset_libraries(id) on delete cascade,
  external_id text not null,
  name text not null,
  kind text not null check (kind in ('image','video','document','other')),
  mime_type text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  modified_at timestamptz,
  provider_ref text,
  preview_ref text,
  indexed_at timestamptz not null,
  unique (library_id, external_id)
);

create index content_library_assets_brand_idx on content_library_assets(workspace_id, brand_id, library_id, kind);
create index content_library_assets_name_idx on content_library_assets(workspace_id, brand_id, lower(name));

commit;
