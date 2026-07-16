begin;

create or replace function public.sync_company_settings_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  metadata_company_name text;
  metadata_tax_no text;
begin
  metadata_company_name := nullif(btrim(new.raw_user_meta_data ->> 'company_name'), '');
  metadata_tax_no := nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'tax_no', ''), '\D', '', 'g'), '');

  insert into public.company_settings (user_id, company_name, tax_no, notify_email)
  values (
    new.id,
    coalesce(metadata_company_name, ''),
    coalesce(metadata_tax_no, ''),
    coalesce(new.email, '')
  )
  on conflict (user_id) do update
  set
    company_name = case
      when nullif(btrim(public.company_settings.company_name), '') is null
        then coalesce(metadata_company_name, public.company_settings.company_name)
      else public.company_settings.company_name
    end,
    tax_no = case
      when nullif(btrim(public.company_settings.tax_no), '') is null
        then coalesce(metadata_tax_no, public.company_settings.tax_no)
      else public.company_settings.tax_no
    end,
    notify_email = case
      when nullif(btrim(public.company_settings.notify_email), '') is null
        then coalesce(new.email, public.company_settings.notify_email)
      else public.company_settings.notify_email
    end,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists auth_user_sync_company_settings on auth.users;
create trigger auth_user_sync_company_settings
after insert or update of raw_user_meta_data, email
on auth.users
for each row
execute function public.sync_company_settings_from_auth();

update public.company_settings settings
set
  company_name = coalesce(
    nullif(btrim(settings.company_name), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'company_name'), ''),
    nullif(btrim(user_license.company_name), ''),
    ''
  ),
  tax_no = coalesce(
    nullif(regexp_replace(coalesce(settings.tax_no, ''), '\D', '', 'g'), ''),
    nullif(regexp_replace(coalesce(auth_user.raw_user_meta_data ->> 'tax_no', ''), '\D', '', 'g'), ''),
    ''
  ),
  notify_email = coalesce(nullif(btrim(settings.notify_email), ''), auth_user.email, ''),
  updated_at = now()
from auth.users auth_user
left join public.user_licenses user_license on user_license.user_id = auth_user.id
where settings.user_id = auth_user.id;

create or replace function public.prevent_company_identity_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_company_name text := nullif(btrim(coalesce(old.company_name, '')), '');
  new_company_name text := nullif(btrim(coalesce(new.company_name, '')), '');
  old_tax_no text := nullif(regexp_replace(coalesce(old.tax_no, ''), '\D', '', 'g'), '');
  new_tax_no text := nullif(regexp_replace(coalesce(new.tax_no, ''), '\D', '', 'g'), '');
begin
  if old_company_name is not null and new_company_name is distinct from old_company_name then
    raise exception 'Şirket adı kayıt sonrasında kullanıcı tarafından değiştirilemez.';
  end if;

  if old_tax_no is not null and new_tax_no is distinct from old_tax_no then
    raise exception 'Vergi numarası kayıt sonrasında kullanıcı tarafından değiştirilemez.';
  end if;

  new.company_name := coalesce(new_company_name, '');
  new.tax_no := coalesce(new_tax_no, '');
  return new;
end;
$$;

drop trigger if exists company_settings_lock_identity on public.company_settings;
create trigger company_settings_lock_identity
before update of company_name, tax_no
on public.company_settings
for each row
execute function public.prevent_company_identity_change();

commit;
