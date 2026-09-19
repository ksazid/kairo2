begin;

create or replace function project_publish_outcome_to_operations()
returns trigger
language plpgsql
as $$
declare
  attempt_row publish_attempts%rowtype;
  disposition text;
  code text;
  message text;
begin
  if old.status <> 'dispatching' or new.status not in ('scheduled','failed','unknown','manual-required') then
    return new;
  end if;

  select * into attempt_row
  from publish_attempts
  where command_id = new.id and attempt_number = new.attempt_count
  order by attempt_number desc
  limit 1;

  if attempt_row.id is null then
    return new;
  end if;

  if new.status = 'scheduled' then
    disposition := 'safe';
    code := 'publishing-retryable-failure';
    message := 'Publishing failed; an automatic retry was scheduled.';
  elsif new.status = 'failed' then
    disposition := 'blocked';
    code := 'publishing-terminal-failure';
    message := 'Publishing failed and requires operator attention.';
  elsif new.status = 'unknown' then
    disposition := 'manual-review';
    code := 'provider-outcome-unknown';
    message := 'Publishing outcome is unknown and requires reconciliation.';
  else
    disposition := 'manual-review';
    code := 'manual-publishing-required';
    message := 'Publishing requires manual handling.';
  end if;

  insert into operational_failures(
    id,workspace_id,brand_id,workflow_id,stage,diagnostic_code,summary,
    retry_disposition,attempt,max_attempts,state,trace_id,occurred_at
  ) values (
    'publishing:' || attempt_row.id,
    new.workspace_id,
    new.brand_id,
    'publishing:' || new.id,
    'publishing',
    code,
    message,
    disposition,
    attempt_row.attempt_number,
    3,
    'failed',
    null,
    coalesce(attempt_row.completed_at,new.last_attempt_at,now())
  ) on conflict(id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_publish_outcome_operations on publish_commands;
create trigger trg_publish_outcome_operations
after update of status on publish_commands
for each row execute function project_publish_outcome_to_operations();

commit;
