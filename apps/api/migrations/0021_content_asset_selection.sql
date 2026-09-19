begin;

alter table content_versions
  add column library_asset_refs jsonb not null default '[]'::jsonb
  check (jsonb_typeof(library_asset_refs) = 'array' and jsonb_array_length(library_asset_refs) <= 12);

alter table content_versions drop constraint content_versions_action_check;
alter table content_versions
  add constraint content_versions_action_check
  check(action in ('initial-draft','alternative','simplify','expand','adjust-depth','strengthen-opening','regenerate-section','manual-edit','asset-selection'));

commit;
