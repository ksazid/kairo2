begin;

alter table content_approvals
  add column destination_channel text,
  add column destination_account_ref text;

update content_approvals
set destination_channel = destination->>'channel',
    destination_account_ref = destination->>'accountRef';

create function sync_content_approval_destination_columns()
returns trigger
language plpgsql
as $$
begin
  new.destination_channel := new.destination->>'channel';
  new.destination_account_ref := new.destination->>'accountRef';
  return new;
end;
$$;

create trigger trg_content_approval_destination_columns
before insert or update of destination on content_approvals
for each row execute function sync_content_approval_destination_columns();

alter table content_approvals
  alter column destination_channel set not null,
  alter column destination_account_ref set not null;

alter table content_approvals
  drop constraint if exists content_approvals_review_id_key,
  drop constraint if exists content_approvals_asset_id_version_key;

alter table content_approvals
  add constraint content_approvals_destination_channel_check
    check (destination_channel in ('linkedin','instagram','manual')),
  add constraint content_approvals_destination_account_ref_check
    check (length(btrim(destination_account_ref)) > 0),
  add constraint content_approvals_destination_channel_sync_check
    check (destination_channel = destination->>'channel'),
  add constraint content_approvals_destination_account_ref_sync_check
    check (destination_account_ref = destination->>'accountRef'),
  add constraint content_approvals_destination_unique
    unique(workspace_id,brand_id,asset_id,version,destination_channel,destination_account_ref);

create index ix_content_approvals_destination
  on content_approvals(workspace_id,brand_id,asset_id,destination_channel,destination_account_ref,version desc);

commit;
