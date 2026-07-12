begin;

alter table public.reports
  add column if not exists report_storage_bucket text default 'request-reports',
  add column if not exists report_storage_path text;

create index if not exists reports_user_storage_path_idx
  on public.reports(user_id, report_storage_path)
  where report_storage_path is not null;

comment on column public.reports.report_storage_bucket is
  'Private Supabase Storage bucket for generated report files.';

comment on column public.reports.report_storage_path is
  'Private Supabase Storage object path for generated report files.';

commit;

-- Verification queries for Supabase SQL Editor:
-- 1) Both rows must be returned.
-- select column_name, data_type, column_default, is_nullable
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'reports'
--   and column_name in ('report_storage_bucket', 'report_storage_path')
-- order by column_name;
--
-- 2) Index must be returned.
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename = 'reports'
--   and indexname = 'reports_user_storage_path_idx';
--
-- 3) Existing report rows can be inspected with storage fields.
-- select id, user_id, reportpath, report_storage_bucket, report_storage_path, created_at
-- from public.reports
-- order by created_at desc
-- limit 10;
