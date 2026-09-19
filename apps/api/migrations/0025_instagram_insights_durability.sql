begin;
alter table metric_collection_jobs add column if not exists collection_window text;
update metric_collection_jobs set collection_window=case
  when scheduled_for<=created_at+interval '2 hours' then '1h'
  when scheduled_for<=created_at+interval '2 days' then '24h'
  else '7d' end where provider='instagram' and collection_window is null;
alter table metric_collection_jobs add constraint metric_collection_jobs_instagram_window_check
  check(provider<>'instagram' or collection_window in('1h','24h','7d'));
create index metric_collection_jobs_brand_status on metric_collection_jobs(workspace_id,brand_id,provider,status,scheduled_for desc);
commit;
