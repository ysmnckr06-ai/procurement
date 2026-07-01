begin;

alter table public.user_licenses
  drop constraint if exists user_licenses_plan_type_check;

alter table public.user_licenses
  add constraint user_licenses_plan_type_check
  check (plan_type in (
    'demo',
    'active',
    'expired',
    'suresiz',
    'süresiz',
    'unlimited',
    'lifetime',
    'permanent',
    'enterprise'
  ));

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
          lower(license.plan_type) = 'demo'
          and license.trial_ends_at is not null
          and license.trial_ends_at > now()
        )
        or (
          lower(license.plan_type) = 'active'
          and (license.expires_at is null or license.expires_at > now())
        )
        or lower(license.plan_type) in (
          'suresiz',
          'süresiz',
          'unlimited',
          'lifetime',
          'permanent',
          'enterprise'
        )
      )
  );
$$;

grant execute on function public.has_active_license() to authenticated, service_role;

commit;
