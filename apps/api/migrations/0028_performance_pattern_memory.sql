begin;
alter table brand_learnings add column if not exists patterns jsonb not null default '[]'::jsonb;
alter table brand_learnings drop constraint if exists brand_learnings_patterns_array;
alter table brand_learnings add constraint brand_learnings_patterns_array check(jsonb_typeof(patterns)='array');
commit;
