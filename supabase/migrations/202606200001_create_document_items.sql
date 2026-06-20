begin;

create table public.document_items (
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
  updated_at timestamptz not null default now(),

  constraint document_items_ocr_confidence_check
    check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 1)),
  constraint document_items_match_confidence_check
    check (match_confidence >= 0 and match_confidence <= 100)
);

create index document_items_document_id_idx
  on public.document_items(document_id);

create index document_items_user_id_idx
  on public.document_items(user_id);

create index document_items_match_status_idx
  on public.document_items(match_status);

create index document_items_order_idx
  on public.document_items(matched_order_id);

create index document_items_project_idx
  on public.document_items(linked_project_id);

alter table public.document_items enable row level security;

create policy "Users can read own document items"
on public.document_items
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own document items"
on public.document_items
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own document items"
on public.document_items
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own document items"
on public.document_items
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.set_document_items_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_document_items_updated_at
before update on public.document_items
for each row
execute function public.set_document_items_updated_at();

grant select, insert, update, delete on public.document_items to authenticated;

commit;
