begin;

create or replace function set_retry_request_server_time()
returns trigger
language plpgsql
as $$
begin
  new.requested_at := transaction_timestamp();
  return new;
end;
$$;

drop trigger if exists trg_retry_request_server_time on retry_requests;
create trigger trg_retry_request_server_time
before insert on retry_requests
for each row execute function set_retry_request_server_time();

create or replace function set_automation_disable_server_time()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'enabled' and new.status = 'disabled' then
    new.disabled_at := transaction_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_automation_disable_server_time on automation_controls;
create trigger trg_automation_disable_server_time
before update of status on automation_controls
for each row execute function set_automation_disable_server_time();

create or replace function set_intervention_server_time()
returns trigger
language plpgsql
as $$
begin
  new.occurred_at := transaction_timestamp();
  return new;
end;
$$;

drop trigger if exists trg_intervention_server_time on operator_interventions;
create trigger trg_intervention_server_time
before insert on operator_interventions
for each row execute function set_intervention_server_time();

commit;
