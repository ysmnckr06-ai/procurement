-- READ-ONLY PREFLIGHT: orders.user_id text -> uuid donusumu oncesi.
-- Bu dosya veri veya schema degistirmez.

-- 1) Mevcut kolon tipi, nullability ve default
select
  table_schema,
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name = 'user_id';

-- 2) Toplam, null ve bos user_id sayilari
select
  count(*) as total_orders,
  count(*) filter (where user_id is null) as null_user_id_count,
  count(*) filter (where user_id is not null and btrim(user_id::text) = '') as blank_user_id_count
from public.orders;

-- 3) Canonical UUID formatina uymayan degerler
select id, user_id
from public.orders
where user_id is not null
  and btrim(user_id::text) <> ''
  and btrim(user_id::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
order by id;

-- 4) UUID formati gecerli gorunup auth.users karsiligi olmayan kayitlar
select orders_row.id, orders_row.user_id
from public.orders orders_row
left join auth.users auth_user
  on auth_user.id::text = btrim(orders_row.user_id::text)
where orders_row.user_id is not null
  and btrim(orders_row.user_id::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and auth_user.id is null
order by orders_row.id;

-- 5) Bosluk/normalize farki bulunan fakat UUID olabilecek degerler
select id, user_id, btrim(user_id::text) as trimmed_user_id
from public.orders
where user_id is not null
  and user_id::text is distinct from btrim(user_id::text);

-- 6) orders tablosunun tum constraintleri
select
  constraint_row.conname as constraint_name,
  constraint_row.contype as constraint_type,
  pg_get_constraintdef(constraint_row.oid) as definition
from pg_constraint constraint_row
where constraint_row.conrelid = 'public.orders'::regclass
   or constraint_row.confrelid = 'public.orders'::regclass
order by constraint_row.conname;

-- 7) Ozellikle user_id kolonunu kullanan foreign keyler
select
  source_namespace.nspname as source_schema,
  source_table.relname as source_table,
  constraint_row.conname as constraint_name,
  pg_get_constraintdef(constraint_row.oid) as definition
from pg_constraint constraint_row
join pg_class source_table on source_table.oid = constraint_row.conrelid
join pg_namespace source_namespace on source_namespace.oid = source_table.relnamespace
where constraint_row.contype = 'f'
  and (
    constraint_row.conrelid = 'public.orders'::regclass
    or constraint_row.confrelid = 'public.orders'::regclass
  )
  and pg_get_constraintdef(constraint_row.oid) ilike '%user_id%'
order by source_namespace.nspname, source_table.relname, constraint_row.conname;

-- 8) orders indexleri; user_id indexleri ALTER TYPE sirasinda yeniden kurulabilir.
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'orders'
order by indexname;

-- 9) orders RLS durumu ve policy ifadeleri
select
  namespace_row.nspname as schema_name,
  table_row.relname as table_name,
  table_row.relrowsecurity as rls_enabled,
  table_row.relforcerowsecurity as rls_forced
from pg_class table_row
join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
where namespace_row.nspname = 'public'
  and table_row.relname = 'orders';

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'orders'
order by policyname;

-- 10) UUID donusumu icin ozet blocker sayilari
select
  count(*) filter (where user_id is null) as null_blockers,
  count(*) filter (
    where user_id is not null
      and btrim(user_id::text) = ''
  ) as blank_blockers,
  count(*) filter (
    where user_id is not null
      and btrim(user_id::text) <> ''
      and btrim(user_id::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) as invalid_uuid_blockers
from public.orders;
