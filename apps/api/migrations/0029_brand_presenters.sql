create unique index if not exists brands_workspace_id_id_uq on brands(workspace_id, id);

create table brand_presenters (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null,
  display_name text not null,
  status text not null default 'draft',
  mode text not null,
  visual_style text,
  voice_style text,
  locale text,
  accent text,
  pace text,
  framing text,
  background text,
  intro_style text,
  outro_style text,
  caption_preference text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_presenters_status check (status in ('draft','ready','disabled')),
  constraint brand_presenters_mode check (mode in ('basic','talking-avatar','hybrid-explainer')),
  constraint brand_presenters_version check (version > 0),
  constraint brand_presenters_brand_scope_fk foreign key (workspace_id, brand_id)
    references brands(workspace_id, id) on delete cascade,
  constraint brand_presenters_brand_unique unique (workspace_id, brand_id),
  constraint brand_presenters_scoped_id_unique unique (workspace_id, brand_id, id)
);

alter table simple_creation_requests add column presenter_id text;
alter table simple_creation_requests
  add constraint simple_creation_presenter_scope_fk
  foreign key (workspace_id, brand_id, presenter_id)
  references brand_presenters(workspace_id, brand_id, id);

create index brand_presenters_brand_idx on brand_presenters(workspace_id, brand_id);
create index simple_creation_presenter_idx on simple_creation_requests(workspace_id, brand_id, presenter_id) where presenter_id is not null;
