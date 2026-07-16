alter table public.company_settings
  add column if not exists accepted_termin_days integer default 15,
  add column if not exists daily_delay_cost_try numeric default 0,
  add column if not exists missing_data_policy text default 'manual_review',
  add column if not exists critical_level text default 'medium',
  add column if not exists delay_impact text default 'medium',
  add column if not exists alternative_stock text default 'partial',
  add column if not exists shipping_included text default 'included',
  add column if not exists supplier_trust text default 'medium',
  add column if not exists quality_history text default 'unknown',
  add column if not exists currency_risk text default 'medium';

alter table public.company_settings
  drop constraint if exists company_settings_procurement_policy_check;

alter table public.company_settings
  add constraint company_settings_procurement_policy_check check (
    annual_interest_rate >= 0
    and accepted_termin_days >= 0
    and daily_delay_cost_try >= 0
    and missing_data_policy in ('manual_review', 'warn_only')
    and critical_level in ('low', 'medium', 'high', 'critical')
    and delay_impact in ('none', 'low', 'medium', 'high')
    and alternative_stock in ('full', 'partial', 'none')
    and shipping_included in ('included', 'excluded', 'unknown')
    and supplier_trust in ('low', 'medium', 'high')
    and quality_history in ('unknown', 'good', 'medium', 'bad')
    and currency_risk in ('none', 'low', 'medium', 'high')
  );
