begin;

alter table carousel_rendered_asset_versions
  add column if not exists thumbnail_object_key text,
  add column if not exists thumbnail_sha256 text,
  add column if not exists thumbnail_mime_type text,
  add column if not exists thumbnail_width integer,
  add column if not exists thumbnail_height integer,
  add column if not exists thumbnail_size_bytes bigint;

alter table carousel_rendered_asset_versions
  drop constraint if exists carousel_thumbnail_complete_check;

alter table carousel_rendered_asset_versions
  add constraint carousel_thumbnail_complete_check check (
    (thumbnail_object_key is null and thumbnail_sha256 is null and thumbnail_mime_type is null and thumbnail_width is null and thumbnail_height is null and thumbnail_size_bytes is null)
    or
    (thumbnail_object_key is not null and thumbnail_sha256 ~ '^[a-f0-9]{64}$' and thumbnail_mime_type='image/png' and thumbnail_width>0 and thumbnail_height>0 and thumbnail_size_bytes>0)
  );

create unique index carousel_rendered_thumbnail_object
  on carousel_rendered_asset_versions(storage_provider,thumbnail_object_key)
  where thumbnail_object_key is not null;

commit;
