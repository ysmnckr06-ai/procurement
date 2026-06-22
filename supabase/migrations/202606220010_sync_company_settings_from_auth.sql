begin;

create or replace function public.sync_company_settings_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  metadata_company_name text;
begin
  metadata_company_name := nullif(btrim(new.raw_user_meta_data ->> 'company_name'), '');

  insert into public.company_settings (user_id, company_name)
  values (new.id, coalesce(metadata_company_name, ''))
  on conflict (user_id) do update
  set
    company_name = excluded.company_name,
    updated_at = now()
  where
    nullif(btrim(public.company_settings.company_name), '') is null
    and nullif(btrim(excluded.company_name), '') is not null;

  return new;
end;
$$;

drop trigger if exists auth_user_sync_company_settings on auth.users;
create trigger auth_user_sync_company_settings
after insert or update of raw_user_meta_data
on auth.users
for each row
execute function public.sync_company_settings_from_auth();

insert into public.company_settings (user_id, company_name)
select
  auth_user.id,
  coalesce(
    nullif(btrim(auth_user.raw_user_meta_data ->> 'company_name'), ''),
    nullif(btrim(user_license.company_name), ''),
    ''
  )
from auth.users auth_user
left join public.user_licenses user_license on user_license.user_id = auth_user.id
where not exists (
  select 1
  from public.company_settings settings
  where settings.user_id = auth_user.id
)
on conflict (user_id) do nothing;

update public.company_settings settings
set
  company_name = nullif(btrim(auth_user.raw_user_meta_data ->> 'company_name'), ''),
  updated_at = now()
from auth.users auth_user
where
  settings.user_id = auth_user.id
  and nullif(btrim(settings.company_name), '') is null
  and nullif(btrim(auth_user.raw_user_meta_data ->> 'company_name'), '') is not null;

update public.company_settings settings
set
  company_name = nullif(btrim(user_license.company_name), ''),
  updated_at = now()
from public.user_licenses user_license
where
  settings.user_id = user_license.user_id
  and nullif(btrim(settings.company_name), '') is null
  and nullif(btrim(user_license.company_name), '') is not null;

commit;
