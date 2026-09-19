-- Brand deletion must remove every direct Brand-owned record, including older
-- tables whose foreign keys predate the cascade policy.
do $$
declare
  fk record;
begin
  for fk in
    select
      con.conname,
      ns.nspname as schema_name,
      rel.relname as table_name,
      pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where con.contype = 'f'
      and con.confrelid = 'public.brands'::regclass
      and con.confdeltype <> 'c'
  loop
    execute format('alter table %I.%I drop constraint %I', fk.schema_name, fk.table_name, fk.conname);
    execute format(
      'alter table %I.%I add constraint %I %s on delete cascade',
      fk.schema_name, fk.table_name, fk.conname, fk.definition
    );
  end loop;
end $$;
