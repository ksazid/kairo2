create unique index channel_accounts_external_link_scope on channel_accounts(workspace_id,brand_id,id);

create table external_instagram_post_links (
  asset_id text primary key,
  workspace_id text not null,
  brand_id text not null,
  campaign_id text not null,
  version_id text not null,
  channel_account_id text not null,
  shortcode text not null,
  published_url text not null,
  linked_by_account_id text not null,
  linked_at timestamptz not null default now(),
  foreign key (campaign_id,asset_id) references content_assets(campaign_id,id),
  foreign key (workspace_id,brand_id,channel_account_id) references channel_accounts(workspace_id,brand_id,id),
  unique (channel_account_id,shortcode)
);

create function prevent_linked_reel_publish() returns trigger language plpgsql as $$
begin
  if new.status in ('scheduled','dispatching') and exists (
    select 1 from external_instagram_post_links where asset_id=new.asset_id
  ) then
    raise exception 'This Reel is already linked to a live Instagram post';
  end if;
  return new;
end;
$$;
create trigger trg_prevent_linked_reel_publish
before insert or update of status on publish_commands
for each row execute function prevent_linked_reel_publish();
