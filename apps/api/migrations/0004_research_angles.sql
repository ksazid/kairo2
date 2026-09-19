begin;

create unique index if not exists uq_brand_opportunities_scope_id
  on brand_opportunities (workspace_id, brand_id, id);

create table if not exists ideas (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  premise text not null check (length(trim(premise)) > 0),
  source_type text not null check (source_type in ('opportunity','user')),
  opportunity_id text null,
  status text not null check (status in ('new','researching','research-ready','angles-ready')),
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint ck_ideas_source_lineage check (
    (source_type='opportunity' and opportunity_id is not null) or
    (source_type='user' and opportunity_id is null)
  ),
  constraint fk_ideas_opportunity_scope foreign key (workspace_id,brand_id,opportunity_id)
    references brand_opportunities(workspace_id,brand_id,id)
);

create index if not exists ix_ideas_scope on ideas (workspace_id,brand_id,updated_at desc,id);

create table if not exists research_dossiers (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  idea_id text not null references ideas(id) on delete cascade,
  summary text not null check (length(trim(summary)) > 0),
  unresolved_uncertainties jsonb not null default '[]'::jsonb check (jsonb_typeof(unresolved_uncertainties)='array'),
  runtime_provenance jsonb null check (runtime_provenance is null or jsonb_typeof(runtime_provenance)='object'),
  status text not null check (status in ('ready')),
  created_at timestamptz not null,
  unique (workspace_id,brand_id,idea_id),
  unique (workspace_id,brand_id,id)
);

create table if not exists evidence_references (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  research_id text not null,
  source_url text not null,
  source_title text not null,
  published_at timestamptz null,
  retrieved_at timestamptz not null,
  constraint fk_evidence_research_scope foreign key (workspace_id,brand_id,research_id)
    references research_dossiers(workspace_id,brand_id,id) on delete cascade,
  unique (research_id,id)
);

create table if not exists claims (
  id text primary key,
  workspace_id text not null,
  brand_id text not null,
  research_id text not null,
  text text not null check (length(trim(text)) > 0),
  classification text not null check (classification in ('fact','brand-opinion','uncertain-inference')),
  confidence double precision not null check (confidence between 0 and 1),
  evidence_strength text not null check (evidence_strength in ('weak','moderate','strong')),
  verification_state text not null check (verification_state in ('supported','contradicted','unresolved')),
  freshness text not null check (freshness in ('fresh','aging','stale','unknown')),
  first_person_authorization text not null check (first_person_authorization in ('not-applicable','authorized')),
  constraint fk_claim_research_scope foreign key (workspace_id,brand_id,research_id)
    references research_dossiers(workspace_id,brand_id,id) on delete cascade,
  unique (research_id,id)
);

create table if not exists claim_evidence (
  research_id text not null,
  claim_id text not null,
  evidence_id text not null,
  primary key (research_id,claim_id,evidence_id),
  foreign key (research_id,claim_id) references claims(research_id,id) on delete cascade,
  foreign key (research_id,evidence_id) references evidence_references(research_id,id) on delete cascade
);

create table if not exists angles (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brand_id text not null references brands(id) on delete cascade,
  idea_id text not null references ideas(id) on delete cascade,
  title text not null,
  framing text not null,
  audience text not null,
  objective text not null,
  hook_direction text not null,
  expected_value text not null,
  effort text not null check (effort in ('low','medium','high')),
  recommended_format text not null,
  recommended_channel text not null,
  supporting_claim_ids jsonb not null check (jsonb_typeof(supporting_claim_ids)='array'),
  runtime_provenance jsonb null check (runtime_provenance is null or jsonb_typeof(runtime_provenance)='object'),
  status text not null check (status in ('candidate','selected')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_angles_one_selected
  on angles (workspace_id,brand_id,idea_id) where status='selected';
create index if not exists ix_angles_scope on angles (workspace_id,brand_id,idea_id,status,id);

commit;
