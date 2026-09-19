alter table publish_commands
  add column if not exists media_items jsonb not null default '[]'::jsonb,
  add column if not exists publish_options jsonb not null default '{}'::jsonb;

alter table publish_commands
  drop constraint if exists publish_commands_content_type_check;

alter table publish_commands
  add constraint publish_commands_content_type_check
    check (content_type in ('text','image','video','carousel','reel'));

alter table publish_commands
  drop constraint if exists publish_commands_media_items_array_check,
  drop constraint if exists publish_commands_publish_options_object_check;

alter table publish_commands
  add constraint publish_commands_media_items_array_check
    check (jsonb_typeof(media_items) = 'array'),
  add constraint publish_commands_publish_options_object_check
    check (jsonb_typeof(publish_options) = 'object');
