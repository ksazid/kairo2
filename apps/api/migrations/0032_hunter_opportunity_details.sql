begin;

alter table brand_opportunities
  add column if not exists opportunity_details jsonb null;

do $$ begin
  alter table brand_opportunities add constraint brand_opportunities_details_object
    check (opportunity_details is null or jsonb_typeof(opportunity_details) = 'object');
exception when duplicate_object then null;
end $$;

commit;
