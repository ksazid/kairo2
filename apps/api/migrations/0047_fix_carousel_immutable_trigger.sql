-- Preserve approved carousel immutability while permitting edits to draft slides.
create or replace function prevent_approved_carousel_mutation() returns trigger language plpgsql as $$
declare target_project_id text;
begin
  if tg_table_name = 'carousel_projects' then
    target_project_id := old.id;
  else
    target_project_id := old.project_id;
  end if;
  if exists(select 1 from carousel_rendered_approvals where project_id = target_project_id) then
    raise exception 'Approved Carousel assets are immutable' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  return old;
end;
$$;
