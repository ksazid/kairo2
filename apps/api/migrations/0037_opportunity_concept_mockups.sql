begin;

alter table brand_opportunities
  add column if not exists concept_mockup jsonb null,
  add column if not exists concept_mockup_version integer null,
  add column if not exists concept_mockup_generated_at timestamptz null;

do $$ begin
  alter table brand_opportunities add constraint brand_opportunities_concept_mockup_object
    check (concept_mockup is null or jsonb_typeof(concept_mockup) = 'object');
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table brand_opportunities add constraint brand_opportunities_concept_mockup_version
    check (concept_mockup_version is null or concept_mockup_version = 1);
exception when duplicate_object then null;
end $$;

commit;
