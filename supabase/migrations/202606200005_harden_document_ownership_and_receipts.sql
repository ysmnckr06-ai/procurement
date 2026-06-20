begin;

create table if not exists public.document_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  line_number integer,
  product_code text,
  product_name text,
  description text,
  quantity numeric(18,4),
  unit text,
  unit_price numeric(18,4),
  total numeric(18,4),
  currency text default 'TRY',
  normalized_product_code text,
  normalized_product_name text,
  normalized_unit text,
  exchange_rate numeric(18,6),
  exchange_rate_date date,
  base_currency text default 'TRY',
  unit_price_base numeric(18,4),
  total_base numeric(18,4),
  tax_rate numeric(18,4),
  tax_amount numeric(18,4),
  discount_amount numeric(18,4),
  source_type text default 'manual',
  source_page integer,
  source_row integer,
  source_bbox jsonb,
  ocr_raw_text text,
  ocr_raw_data jsonb,
  ocr_confidence numeric(5,4),
  verification_status text default 'pending',
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  matched_order_id uuid references public.orders(id) on delete set null,
  matched_order_item_key text,
  linked_project_id uuid references public.projects(id) on delete set null,
  match_status text default 'unmatched',
  match_confidence integer default 0,
  match_reason text,
  manual_review_required boolean default false,
  matched_by uuid references auth.users(id) on delete set null,
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.document_items
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists document_id uuid references public.documents(id) on delete cascade,
  add column if not exists line_number integer,
  add column if not exists product_code text,
  add column if not exists product_name text,
  add column if not exists description text,
  add column if not exists quantity numeric(18,4),
  add column if not exists unit text,
  add column if not exists unit_price numeric(18,4),
  add column if not exists total numeric(18,4),
  add column if not exists currency text default 'TRY',
  add column if not exists normalized_product_code text,
  add column if not exists normalized_product_name text,
  add column if not exists normalized_unit text,
  add column if not exists exchange_rate numeric(18,6),
  add column if not exists exchange_rate_date date,
  add column if not exists base_currency text default 'TRY',
  add column if not exists unit_price_base numeric(18,4),
  add column if not exists total_base numeric(18,4),
  add column if not exists tax_rate numeric(18,4),
  add column if not exists tax_amount numeric(18,4),
  add column if not exists discount_amount numeric(18,4),
  add column if not exists source_type text default 'manual',
  add column if not exists source_page integer,
  add column if not exists source_row integer,
  add column if not exists source_bbox jsonb,
  add column if not exists ocr_raw_text text,
  add column if not exists ocr_raw_data jsonb,
  add column if not exists ocr_confidence numeric(5,4),
  add column if not exists verification_status text default 'pending',
  add column if not exists verified_by uuid references auth.users(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists matched_order_id uuid references public.orders(id) on delete set null,
  add column if not exists matched_order_item_key text,
  add column if not exists linked_project_id uuid references public.projects(id) on delete set null,
  add column if not exists match_status text default 'unmatched',
  add column if not exists match_confidence integer default 0,
  add column if not exists match_reason text,
  add column if not exists manual_review_required boolean default false,
  add column if not exists matched_by uuid references auth.users(id) on delete set null,
  add column if not exists matched_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
declare
  orphan_count bigint;
  mismatched_user_count bigint;
begin
  select count(*) into orphan_count
  from public.document_items item
  left join public.documents document on document.id = item.document_id
  where item.document_id is null
     or document.id is null
     or document.user_id is null;

  if orphan_count > 0 then
    raise exception 'document_items backfill durduruldu: document baglantisi olmayan/orphan % satir var; veri silinmedi', orphan_count;
  end if;

  select count(*) into mismatched_user_count
  from public.document_items item
  join public.documents document on document.id = item.document_id
  where item.user_id is not null
    and item.user_id::text is distinct from document.user_id::text;

  if mismatched_user_count > 0 then
    raise exception 'document_items backfill durduruldu: documents.user_id ile uyusmayan % satir var; veri silinmedi', mismatched_user_count;
  end if;
end;
$$;

update public.document_items item
set user_id = document.user_id
from public.documents document
where document.id = item.document_id
  and item.user_id is null;

do $$
declare
  remaining_null_count bigint;
begin
  select count(*) into remaining_null_count
  from public.document_items
  where user_id is null;

  if remaining_null_count > 0 then
    raise exception 'document_items backfill tamamlanamadi: user_id bos % satir kaldi; RLS uygulanmadi', remaining_null_count;
  end if;
end;
$$;

alter table public.document_items
  alter column user_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.document_items'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (document_id)%'
  ) then
    alter table public.document_items
      add constraint document_items_document_id_fkey
      foreign key (document_id) references public.documents(id) on delete cascade;
  end if;
end;
$$;

alter table public.document_items enable row level security;

drop policy if exists "Users can read own document items" on public.document_items;
create policy "Users can read own document items" on public.document_items
for select to authenticated using (
  auth.uid()::text = user_id::text
  and exists (
    select 1 from public.documents parent_document
    where parent_document.id = document_items.document_id
      and parent_document.user_id::text = auth.uid()::text
  )
);

drop policy if exists "Users can insert own document items" on public.document_items;
create policy "Users can insert own document items" on public.document_items
for insert to authenticated with check (
  auth.uid()::text = user_id::text
  and exists (
    select 1 from public.documents parent_document
    where parent_document.id = document_items.document_id
      and parent_document.user_id::text = auth.uid()::text
  )
  and (document_items.matched_order_id is null or exists (
    select 1 from public.orders matched_order
    where matched_order.id = document_items.matched_order_id
      and matched_order.user_id::text = auth.uid()::text
  ))
  and (document_items.linked_project_id is null or exists (
    select 1 from public.projects linked_project
    where linked_project.id = document_items.linked_project_id
      and linked_project.user_id::text = auth.uid()::text
  ))
);

drop policy if exists "Users can update own document items" on public.document_items;
create policy "Users can update own document items" on public.document_items
for update to authenticated
using (
  auth.uid()::text = user_id::text
  and exists (
    select 1 from public.documents parent_document
    where parent_document.id = document_items.document_id
      and parent_document.user_id::text = auth.uid()::text
  )
)
with check (
  auth.uid()::text = user_id::text
  and exists (
    select 1 from public.documents parent_document
    where parent_document.id = document_items.document_id
      and parent_document.user_id::text = auth.uid()::text
  )
  and (document_items.matched_order_id is null or exists (
    select 1 from public.orders matched_order
    where matched_order.id = document_items.matched_order_id
      and matched_order.user_id::text = auth.uid()::text
  ))
  and (document_items.linked_project_id is null or exists (
    select 1 from public.projects linked_project
    where linked_project.id = document_items.linked_project_id
      and linked_project.user_id::text = auth.uid()::text
  ))
);

drop policy if exists "Users can delete own document items" on public.document_items;
create policy "Users can delete own document items" on public.document_items
for delete to authenticated using (
  auth.uid()::text = user_id::text
  and exists (
    select 1 from public.documents parent_document
    where parent_document.id = document_items.document_id
      and parent_document.user_id::text = auth.uid()::text
  )
);

do $$
begin
  if to_regclass('public.order_receipts') is null then
    raise exception 'public.order_receipts bulunamadi; once temel schema uygulanmalidir';
  end if;
end;
$$;

alter table public.order_receipts
  add column if not exists document_item_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_receipts'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (document_item_id)%'
  ) then
    alter table public.order_receipts
      add constraint order_receipts_document_item_id_fkey
      foreign key (document_item_id)
      references public.document_items(id)
      on delete set null;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.order_receipts_document_item_unique_idx') is not null then
    raise exception 'Eski global order_receipts_document_item_unique_idx mevcut; otomatik drop yapilmadi, manuel inceleme gerekli';
  end if;

  if exists (
    select user_id, order_id, document_item_id
    from public.order_receipts
    where document_item_id is not null
      and user_id is not null
      and order_id is not null
    group by user_id, order_id, document_item_id
    having count(*) > 1
  ) then
    raise exception 'Ayni kullanici/siparis/document_item icin mukerrer receipt var; veri silinmedi';
  end if;
end;
$$;

create unique index if not exists order_receipts_user_order_document_item_unique_idx
  on public.order_receipts(user_id, order_id, document_item_id)
  where document_item_id is not null;

alter table public.order_receipts enable row level security;

drop policy if exists "Users can read own order receipts" on public.order_receipts;
create policy "Users can read own order receipts" on public.order_receipts
for select to authenticated using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own order receipts" on public.order_receipts;
create policy "Users can insert own order receipts" on public.order_receipts
for insert to authenticated with check (
  auth.uid()::text = user_id::text
  and (order_receipts.order_id is null or exists (
    select 1 from public.orders receipt_order
    where receipt_order.id = order_receipts.order_id
      and receipt_order.user_id::text = auth.uid()::text
  ))
  and (order_receipts.project_id is null or exists (
    select 1 from public.projects receipt_project
    where receipt_project.id = order_receipts.project_id
      and receipt_project.user_id::text = auth.uid()::text
  ))
  and (order_receipts.document_item_id is null or exists (
    select 1 from public.document_items receipt_item
    where receipt_item.id = order_receipts.document_item_id
      and receipt_item.user_id::text = auth.uid()::text
      and (
        receipt_item.matched_order_id is null
        or receipt_item.matched_order_id = order_receipts.order_id
      )
  ))
);

drop policy if exists "Users can update own order receipts" on public.order_receipts;
create policy "Users can update own order receipts" on public.order_receipts
for update to authenticated
using (auth.uid()::text = user_id::text)
with check (
  auth.uid()::text = user_id::text
  and (order_receipts.order_id is null or exists (
    select 1 from public.orders receipt_order
    where receipt_order.id = order_receipts.order_id
      and receipt_order.user_id::text = auth.uid()::text
  ))
  and (order_receipts.project_id is null or exists (
    select 1 from public.projects receipt_project
    where receipt_project.id = order_receipts.project_id
      and receipt_project.user_id::text = auth.uid()::text
  ))
  and (order_receipts.document_item_id is null or exists (
    select 1 from public.document_items receipt_item
    where receipt_item.id = order_receipts.document_item_id
      and receipt_item.user_id::text = auth.uid()::text
      and (
        receipt_item.matched_order_id is null
        or receipt_item.matched_order_id = order_receipts.order_id
      )
  ))
);

drop policy if exists "Users can delete own order receipts" on public.order_receipts;
create policy "Users can delete own order receipts" on public.order_receipts
for delete to authenticated using (auth.uid()::text = user_id::text);

grant select, insert, update, delete on public.document_items to authenticated;
grant select, insert, update, delete on public.order_receipts to authenticated;

comment on column public.order_receipts.document_item_id is
  'OCR document item kaynagindan kullanici onayi ile olusturulan teslim referansi.';

commit;
