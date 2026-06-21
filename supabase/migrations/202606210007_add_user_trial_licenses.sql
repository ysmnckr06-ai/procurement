begin;

create table if not exists public.user_licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_type text not null default 'demo',
  license_status text not null default 'active',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  activated_at timestamptz,
  expires_at timestamptz,
  company_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_licenses_plan_type_check
    check (plan_type in ('demo', 'active', 'expired')),
  constraint user_licenses_status_check
    check (license_status in ('active', 'expired', 'suspended')),
  constraint user_licenses_trial_range_check
    check (
      trial_ends_at is null
      or trial_started_at is null
      or trial_ends_at > trial_started_at
    )
);

alter table public.user_licenses
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists plan_type text default 'demo',
  add column if not exists license_status text default 'active',
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists company_name text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select user_id
    from public.user_licenses
    where user_id is not null
    group by user_id
    having count(*) > 1
  ) then
    raise exception 'user_licenses icinde ayni kullaniciya ait birden fazla kayit var; migration veri silmeden durduruldu';
  end if;
end;
$$;

create unique index if not exists user_licenses_user_id_unique_idx
  on public.user_licenses(user_id);

create index if not exists user_licenses_status_idx
  on public.user_licenses(license_status, plan_type);

create or replace function public.set_user_license_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_license_updated_at on public.user_licenses;
create trigger set_user_license_updated_at
before update on public.user_licenses
for each row
execute function public.set_user_license_updated_at();

create or replace function public.create_trial_license_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.user_licenses (
    user_id,
    plan_type,
    license_status,
    trial_started_at,
    trial_ends_at,
    company_name
  )
  values (
    new.id,
    'demo',
    'active',
    now(),
    now() + interval '14 days',
    nullif(btrim(new.raw_user_meta_data ->> 'company_name'), '')
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists create_trial_license_after_user_signup on auth.users;
create trigger create_trial_license_after_user_signup
after insert on auth.users
for each row
execute function public.create_trial_license_for_new_user();

-- Existing users receive a fresh 14-day window at migration time. This avoids
-- unexpectedly locking long-standing users when the licensing feature launches.
insert into public.user_licenses (
  user_id,
  plan_type,
  license_status,
  trial_started_at,
  trial_ends_at,
  company_name
)
select
  auth_user.id,
  'demo',
  'active',
  now(),
  now() + interval '14 days',
  nullif(btrim(auth_user.raw_user_meta_data ->> 'company_name'), '')
from auth.users auth_user
where not exists (
  select 1
  from public.user_licenses existing_license
  where existing_license.user_id = auth_user.id
)
on conflict (user_id) do nothing;

create or replace function public.has_active_license()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_licenses license
    where license.user_id = auth.uid()
      and license.license_status = 'active'
      and (
        (
          license.plan_type = 'demo'
          and license.trial_ends_at is not null
          and license.trial_ends_at > now()
        )
        or (
          license.plan_type = 'active'
          and (license.expires_at is null or license.expires_at > now())
        )
      )
  );
$$;

alter table public.user_licenses enable row level security;

drop policy if exists "Users can read own license" on public.user_licenses;
create policy "Users can read own license"
on public.user_licenses
for select
to authenticated
using (auth.uid() = user_id);

revoke all on public.user_licenses from anon, authenticated;
grant select on public.user_licenses to authenticated;
grant all on public.user_licenses to service_role;

revoke all on function public.create_trial_license_for_new_user() from public;
revoke all on function public.set_user_license_updated_at() from public;
revoke all on function public.has_active_license() from public;
grant execute on function public.has_active_license() to authenticated, service_role;

comment on table public.user_licenses is
  'Kullanici bazli demo ve aktif lisans kayitlari. Yazma islemleri yalnizca service-role/admin tarafindan yapilir.';

commit;
