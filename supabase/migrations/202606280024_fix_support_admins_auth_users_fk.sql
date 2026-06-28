begin;

do $$
begin
  if to_regclass('public.support_admins') is null then
    raise exception 'public.support_admins tablosu bulunamadi. Once 202606280023_support_center_v1.sql migration uygulanmali.';
  end if;
end;
$$;

-- support_admins.user_id must reference auth.users(id). If a wrong or stale FK
-- exists on user_id, drop only that FK and recreate the correct one.
do $$
declare
  fk_record record;
  has_auth_users_fk boolean := false;
begin
  for fk_record in
    select
      constraint_record.conname,
      referenced_namespace.nspname as referenced_schema,
      referenced_table.relname as referenced_table
    from pg_constraint constraint_record
    join pg_class source_table
      on source_table.oid = constraint_record.conrelid
    join pg_namespace source_namespace
      on source_namespace.oid = source_table.relnamespace
    join pg_class referenced_table
      on referenced_table.oid = constraint_record.confrelid
    join pg_namespace referenced_namespace
      on referenced_namespace.oid = referenced_table.relnamespace
    where source_namespace.nspname = 'public'
      and source_table.relname = 'support_admins'
      and constraint_record.contype = 'f'
      and constraint_record.conkey = array[
        (
          select attribute.attnum
          from pg_attribute attribute
          where attribute.attrelid = source_table.oid
            and attribute.attname = 'user_id'
            and not attribute.attisdropped
        )
      ]::smallint[]
  loop
    if fk_record.referenced_schema = 'auth'
       and fk_record.referenced_table = 'users' then
      has_auth_users_fk := true;
    else
      execute format(
        'alter table public.support_admins drop constraint %I',
        fk_record.conname
      );
    end if;
  end loop;

  if not has_auth_users_fk then
    if exists (
      select 1
      from public.support_admins admin_user
      left join auth.users auth_user
        on auth_user.id = admin_user.user_id
      where auth_user.id is null
    ) then
      raise exception 'support_admins icinde auth.users ile eslesmeyen user_id var. Veri silmeden migration durduruldu.';
    end if;

    alter table public.support_admins
      add constraint support_admins_user_id_auth_users_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
