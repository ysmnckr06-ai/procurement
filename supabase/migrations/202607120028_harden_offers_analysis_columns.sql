begin;

alter table public.offers
  add column if not exists request_id uuid references public.requests(id) on delete set null,
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists firma_adi text default '',
  add column if not exists dosya_adi text default '',
  add column if not exists para_birimi text default 'TRY',
  add column if not exists toplam_tutar numeric default 0,
  add column if not exists durum text default 'Analiz edildi',
  add column if not exists satir_sayisi integer default 0,
  add column if not exists supplier_name text default '',
  add column if not exists partner_name text default '',
  add column if not exists currency text default 'TRY',
  add column if not exists total_amount numeric default 0,
  add column if not exists base_amount numeric default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.offers
set
  supplier_name = coalesce(nullif(supplier_name, ''), nullif(firma_adi, ''), partner_name, ''),
  partner_name = coalesce(nullif(partner_name, ''), nullif(firma_adi, ''), supplier_name, ''),
  currency = coalesce(nullif(currency, ''), nullif(para_birimi, ''), 'TRY'),
  para_birimi = coalesce(nullif(para_birimi, ''), nullif(currency, ''), 'TRY'),
  total_amount = coalesce(nullif(total_amount, 0), toplam_tutar, 0),
  toplam_tutar = coalesce(nullif(toplam_tutar, 0), total_amount, 0),
  base_amount = coalesce(nullif(base_amount, 0), nullif(total_amount, 0), toplam_tutar, 0),
  updated_at = now();

create index if not exists offers_user_request_idx
  on public.offers(user_id, request_id)
  where request_id is not null;

create index if not exists offers_user_project_idx
  on public.offers(user_id, project_id)
  where project_id is not null;

create index if not exists offers_user_created_at_idx
  on public.offers(user_id, created_at desc);

comment on column public.offers.firma_adi is
  'Supplier/company name parsed from analyzed offer files.';

comment on column public.offers.dosya_adi is
  'Original offer file name used by comparison/report screens.';

comment on column public.offers.toplam_tutar is
  'Offer total amount in para_birimi as parsed by analyze-offers.';

comment on column public.offers.satir_sayisi is
  'Number of parsed rows represented by this analyzed offer record.';

commit;

-- Verification queries for Supabase SQL Editor:
-- select column_name, data_type, column_default, is_nullable
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'offers'
--   and column_name in (
--     'request_id', 'project_id', 'firma_adi', 'dosya_adi', 'para_birimi',
--     'toplam_tutar', 'durum', 'satir_sayisi', 'supplier_name',
--     'partner_name', 'currency', 'total_amount', 'base_amount',
--     'created_at', 'updated_at'
--   )
-- order by column_name;
--
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename = 'offers'
--   and indexname in (
--     'offers_user_request_idx',
--     'offers_user_project_idx',
--     'offers_user_created_at_idx'
--   )
-- order by indexname;
