-- READ-ONLY PREFLIGHT: Supabase SQL Editor'da 004/005/006 oncesi calistirin.
-- Bu dosya veri veya schema degistirmez.

-- 1) Migration history
select version, name
from supabase_migrations.schema_migrations
order by version;

-- 2) Hedef tablolar ve kolonlar
select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('documents', 'document_links', 'document_items', 'order_receipts')
order by table_name, ordinal_position;

-- 3) 004: documents sahiplik kontrolu
select
  count(*) filter (where user_id is null) as documents_missing_user_id
from public.documents;

-- 4) 004: document_links orphan ve tenant uyusmazliklari
select
  link.id,
  link.user_id as link_user_id,
  document.user_id as document_user_id,
  linked_order.user_id as order_user_id,
  linked_project.user_id as project_user_id,
  case
    when document.id is null then 'missing_document'
    when link.user_id is null then 'missing_link_user'
    when document.user_id::text is distinct from link.user_id::text then 'document_user_mismatch'
    when link.order_id is not null and linked_order.id is null then 'missing_order'
    when link.order_id is not null and linked_order.user_id::text is distinct from link.user_id::text then 'order_user_mismatch'
    when link.project_id is not null and linked_project.id is null then 'missing_project'
    when link.project_id is not null and linked_project.user_id::text is distinct from link.user_id::text then 'project_user_mismatch'
  end as problem
from public.document_links link
left join public.documents document on document.id = link.document_id
left join public.orders linked_order on linked_order.id = link.order_id
left join public.projects linked_project on linked_project.id = link.project_id
where link.user_id is null
   or document.id is null
   or document.user_id::text is distinct from link.user_id::text
   or (link.order_id is not null and (
     linked_order.id is null or linked_order.user_id::text is distinct from link.user_id::text
   ))
   or (link.project_id is not null and (
     linked_project.id is null or linked_project.user_id::text is distinct from link.user_id::text
   ));

-- 5) 005: document_items -> documents orphan kontrolu
select
  item.id,
  item.document_id,
  document.id as found_document_id,
  document.user_id as source_user_id
from public.document_items item
left join public.documents document on document.id = item.document_id
where item.document_id is null
   or document.id is null
   or document.user_id is null;

-- 6) 005: user_id kolonu varsa mevcut tenant uyusmazligi.
-- to_jsonb kullanimi kolon henuz yoksa sorgunun calismaya devam etmesini saglar.
select
  item.id,
  to_jsonb(item)->>'user_id' as item_user_id,
  document.user_id as document_user_id
from public.document_items item
join public.documents document on document.id = item.document_id
where nullif(to_jsonb(item)->>'user_id', '') is not null
  and (to_jsonb(item)->>'user_id') is distinct from document.user_id::text;

-- 7) 005: document_items backfill aday sayisi
select
  count(*) as rows_waiting_for_user_id_backfill
from public.document_items item
join public.documents document on document.id = item.document_id
where nullif(to_jsonb(item)->>'user_id', '') is null
  and document.user_id is not null;

-- 8) order_receipts document_item_id kolon durumu
select exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'order_receipts'
    and column_name = 'document_item_id'
) as order_receipts_has_document_item_id;

-- 9) Kolon varsa receipt mukerrerleri; kolon yoksa bos sonuc doner.
select
  receipt.user_id,
  receipt.order_id,
  to_jsonb(receipt)->>'document_item_id' as document_item_id,
  count(*) as duplicate_count
from public.order_receipts receipt
where nullif(to_jsonb(receipt)->>'document_item_id', '') is not null
group by receipt.user_id, receipt.order_id, to_jsonb(receipt)->>'document_item_id'
having count(*) > 1;

-- 10) Kolon varsa receipt -> document_items orphan/cross-tenant kontrolu.
select
  receipt.id as receipt_id,
  receipt.user_id as receipt_user_id,
  to_jsonb(receipt)->>'document_item_id' as document_item_id,
  to_jsonb(item)->>'user_id' as item_user_id
from public.order_receipts receipt
left join public.document_items item
  on item.id::text = to_jsonb(receipt)->>'document_item_id'
where nullif(to_jsonb(receipt)->>'document_item_id', '') is not null
  and (
    item.id is null
    or (to_jsonb(item)->>'user_id') is distinct from receipt.user_id::text
  );

-- 11) Tum ilgili foreign key ve check constraintler
select
  source.relname as table_name,
  constraint_row.conname as constraint_name,
  constraint_row.contype as constraint_type,
  pg_get_constraintdef(constraint_row.oid) as definition
from pg_constraint constraint_row
join pg_class source on source.oid = constraint_row.conrelid
join pg_namespace namespace_row on namespace_row.oid = source.relnamespace
where namespace_row.nspname = 'public'
  and source.relname in ('documents', 'document_links', 'document_items', 'order_receipts')
order by source.relname, constraint_row.conname;

-- 12) Mevcut indexler; eski global index burada gorulmelidir.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('documents', 'document_links', 'document_items', 'order_receipts')
order by tablename, indexname;

select
  to_regclass('public.order_receipts_document_item_unique_idx') as old_global_unique_index,
  to_regclass('public.order_receipts_user_order_document_item_unique_idx') as tenant_scoped_unique_index;

-- 13) RLS acik/kapali durumu
select
  namespace_row.nspname as schema_name,
  table_row.relname as table_name,
  table_row.relrowsecurity as rls_enabled,
  table_row.relforcerowsecurity as rls_forced
from pg_class table_row
join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
where namespace_row.nspname = 'public'
  and table_row.relname in ('documents', 'document_links', 'document_items', 'order_receipts')
order by table_row.relname;

-- 14) Public tablo RLS policy listesi
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('documents', 'document_links', 'document_items', 'order_receipts')
order by tablename, policyname;

-- 15) Storage bucket public/private ve limit bilgileri
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('order-documents', 'request-reports')
order by id;

-- 16) Storage RLS policy listesi
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;
