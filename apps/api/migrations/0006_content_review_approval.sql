begin;
create unique index uq_content_versions_review_scope on content_versions(workspace_id,brand_id,asset_id,version,id);
create table content_reviews (
 id text primary key, workspace_id text not null, brand_id text not null, campaign_id text not null, asset_id text not null, version_id text not null,
 version integer not null check(version>0), status text not null check(status in ('review','revision-required','passed','archived')),
 truth jsonb not null check(jsonb_typeof(truth)='object'), critic jsonb null check(critic is null or jsonb_typeof(critic)='object'),
 revision_cycle integer not null check(revision_cycle between 0 and 2), requested_at timestamptz not null, completed_at timestamptz null,
 foreign key(workspace_id,brand_id,asset_id,version,version_id) references content_versions(workspace_id,brand_id,asset_id,version,id), unique(asset_id,version),
 unique(workspace_id,brand_id,asset_id,version,id)
);
create index ix_content_reviews_scope on content_reviews(workspace_id,brand_id,asset_id,version desc);
create table content_approvals (
 id text primary key, workspace_id text not null, brand_id text not null, campaign_id text not null, asset_id text not null, version_id text not null,
 version integer not null check(version>0), review_id text not null unique, approver_account_id text not null references accounts(id),
 destination jsonb not null check(jsonb_typeof(destination)='object'), approved_at timestamptz not null,
 foreign key(workspace_id,brand_id,asset_id,version,version_id) references content_versions(workspace_id,brand_id,asset_id,version,id),
 foreign key(workspace_id,brand_id,asset_id,version,review_id) references content_reviews(workspace_id,brand_id,asset_id,version,id), unique(asset_id,version)
);
create index ix_content_approvals_scope on content_approvals(workspace_id,brand_id,asset_id,version desc);
commit;
