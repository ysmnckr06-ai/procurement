begin;

-- Prevent duplicate project codes inside the same tenant.
-- This keeps project numbers safe when two browser tabs/users create a project at the same time.
-- Existing duplicates are reported explicitly; no data is changed or deleted.

do $$
declare
  duplicate_count integer;
begin
  select count(*) into duplicate_count
  from (
    select user_id, lower(btrim(project_code)) as normalized_project_code
    from public.projects
    where project_code is not null
      and btrim(project_code) <> ''
    group by user_id, lower(btrim(project_code))
    having count(*) > 1
  ) duplicate_groups;

  if duplicate_count > 0 then
    raise exception 'projects icinde ayni user_id + project_code icin % duplicate grup var; unique index olusturulmadi, veri silinmedi', duplicate_count;
  end if;
end $$;

create unique index if not exists projects_user_project_code_unique_idx
  on public.projects (user_id, lower(btrim(project_code)))
  where project_code is not null
    and btrim(project_code) <> '';

commit;
