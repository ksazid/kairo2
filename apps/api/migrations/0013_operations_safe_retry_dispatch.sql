begin;

create or replace function dispatch_operations_safe_retry()
returns trigger
language plpgsql
as $$
declare
  failure_row operational_failures%rowtype;
  command_id text;
  dispatched_id text;
begin
  select * into failure_row
  from operational_failures
  where id = new.failure_id
    and workspace_id = new.workspace_id
    and brand_id = new.brand_id
  for share;

  if failure_row.id is null then
    raise exception 'Operational failure not found for retry dispatch';
  end if;

  if failure_row.retry_disposition <> 'safe' then
    raise exception 'Operational failure is not safe to retry';
  end if;

  if failure_row.stage <> 'publishing' or failure_row.workflow_id not like 'publishing:%' then
    raise exception 'Safe retry target is not dispatchable by the publishing queue';
  end if;

  command_id := substring(failure_row.workflow_id from length('publishing:') + 1);

  update publish_commands
  set next_attempt_at = now()
  where id = command_id
    and workspace_id = new.workspace_id
    and brand_id = new.brand_id
    and status = 'scheduled'
    and attempt_count = failure_row.attempt
    and attempt_count < failure_row.max_attempts
  returning id into dispatched_id;

  if dispatched_id is null then
    raise exception 'Safe publishing retry target is no longer schedulable';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_operations_safe_retry_dispatch on retry_requests;
create trigger trg_operations_safe_retry_dispatch
after insert on retry_requests
for each row execute function dispatch_operations_safe_retry();

commit;
