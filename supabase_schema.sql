create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text default 'Genel',
  status text default 'Aktif',
  tax_no text default '',
  contact_name text default '',
  email text default '',
  phone text default '',
  score integer default 80,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.suppliers
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists name text,
add column if not exists category text default 'Genel',
add column if not exists status text default 'Aktif',
add column if not exists tax_no text default '',
add column if not exists contact_name text default '',
add column if not exists email text default '',
add column if not exists phone text default '',
add column if not exists score integer default 80,
add column if not exists notes text default '',
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

alter table public.suppliers enable row level security;

drop policy if exists "Users can read own suppliers" on public.suppliers;
create policy "Users can read own suppliers"
on public.suppliers for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own suppliers" on public.suppliers;
create policy "Users can insert own suppliers"
on public.suppliers for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own suppliers" on public.suppliers;
create policy "Users can update own suppliers"
on public.suppliers for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own suppliers" on public.suppliers;
create policy "Users can delete own suppliers"
on public.suppliers for delete
using (auth.uid()::text = user_id::text);

create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text default '',
  tax_no text default '',
  default_currency text default 'TRY',
  annual_interest_rate numeric default 45,
  max_file_size_mb integer default 10,
  max_offer_files integer default 15,
  default_payment_term text default '60 gÃ¼n',
  risk_level text default 'Orta',
  approval_required boolean default true,
  notify_email text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.company_settings
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists company_name text default '',
add column if not exists tax_no text default '',
add column if not exists default_currency text default 'TRY',
add column if not exists base_currency text default 'TRY',
add column if not exists usd_rate numeric default 1,
add column if not exists eur_rate numeric default 1,
add column if not exists gbp_rate numeric default 1,
add column if not exists exchange_rate_date date default current_date,
add column if not exists annual_interest_rate numeric default 45,
add column if not exists accepted_termin_days integer default 15,
add column if not exists daily_delay_cost_try numeric default 0,
add column if not exists missing_data_policy text default 'manual_review',
add column if not exists critical_level text default 'medium',
add column if not exists delay_impact text default 'medium',
add column if not exists alternative_stock text default 'partial',
add column if not exists shipping_included text default 'included',
add column if not exists supplier_trust text default 'medium',
add column if not exists quality_history text default 'unknown',
add column if not exists currency_risk text default 'medium',
add column if not exists max_file_size_mb integer default 10,
add column if not exists max_offer_files integer default 15,
add column if not exists default_payment_term text default '60 gÃ¼n',
add column if not exists risk_level text default 'Orta',
add column if not exists approval_required boolean default true,
add column if not exists notify_email text default '',
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

alter table public.company_settings enable row level security;

drop policy if exists "Users can read own company settings" on public.company_settings;
create policy "Users can read own company settings"
on public.company_settings for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own company settings" on public.company_settings;
create policy "Users can insert own company settings"
on public.company_settings for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own company settings" on public.company_settings;
create policy "Users can update own company settings"
on public.company_settings for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own company settings" on public.company_settings;
create policy "Users can delete own company settings"
on public.company_settings for delete
using (auth.uid()::text = user_id::text);

alter table if exists public.orders
add column if not exists items jsonb default '[]'::jsonb,
add column if not exists total_amount numeric default 0,
add column if not exists original_amount numeric default 0,
add column if not exists exchange_rate numeric default 1,
add column if not exists exchange_rate_date date default current_date,
add column if not exists base_currency text default 'TRY',
add column if not exists base_amount numeric default 0,
add column if not exists order_total numeric default 0,
add column if not exists order_total_base numeric default 0,
add column if not exists note text default '',
add column if not exists currency text default 'TRY',
add column if not exists delivery_date date,
add column if not exists termin_date date,
add column if not exists report_id uuid,
add column if not exists status_history jsonb default '[]'::jsonb;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text default '',
  normalized_product_code text,
  product_name text not null,
  brand text default '',
  unit text default 'adet',
  category text default 'Genel',
  current_stock numeric default 0,
  reserved_stock numeric default 0,
  min_stock numeric default 0,
  critical_stock numeric default 0,
  last_supplier text default '',
  last_unit_price numeric default 0,
  manual_unit_price numeric default 0,
  last_currency text default 'TRY',
  last_movement_at timestamptz,
  source text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists product_code text default '',
add column if not exists normalized_product_code text,
add column if not exists product_name text,
add column if not exists brand text default '',
add column if not exists unit text default 'adet',
add column if not exists category text default 'Genel',
add column if not exists current_stock numeric default 0,
add column if not exists reserved_stock numeric default 0,
add column if not exists min_stock numeric default 0,
add column if not exists critical_stock numeric default 0,
add column if not exists last_supplier text default '',
add column if not exists last_unit_price numeric default 0,
add column if not exists manual_unit_price numeric default 0,
add column if not exists last_currency text default 'TRY',
add column if not exists last_purchase_date date,
add column if not exists last_movement_at timestamptz,
add column if not exists source text default '',
add column if not exists notes text default '',
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

create unique index if not exists products_user_code_idx
on public.products (user_id, product_code)
where product_code <> '';

update public.products
set normalized_product_code = nullif(upper(btrim(product_code)), '')
where normalized_product_code is distinct from nullif(upper(btrim(product_code)), '');

create or replace function public.set_product_normalized_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.normalized_product_code := nullif(upper(btrim(new.product_code)), '');
  return new;
end;
$$;

drop trigger if exists products_set_normalized_code on public.products;
create trigger products_set_normalized_code
before insert or update of product_code, normalized_product_code
on public.products
for each row
execute function public.set_product_normalized_code();

create unique index if not exists products_user_normalized_code_uidx
on public.products (user_id, normalized_product_code)
where normalized_product_code is not null;

create index if not exists products_user_code_name_lookup_idx
on public.products (user_id, upper(product_code), lower(product_name));

create index if not exists products_user_name_lookup_idx
on public.products (user_id, lower(product_name));

alter table public.products enable row level security;

drop policy if exists "Users can read own products" on public.products;
create policy "Users can read own products"
on public.products for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own products" on public.products;
create policy "Users can insert own products"
on public.products for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own products" on public.products;
create policy "Users can update own products"
on public.products for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own products" on public.products;
create policy "Users can delete own products"
on public.products for delete
using (auth.uid()::text = user_id::text);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_code text default '',
  product_name text not null,
  movement_type text not null default 'in',
  quantity numeric not null default 0,
  unit text default 'adet',
  supplier_name text default '',
  order_id uuid,
  request_id uuid,
  report_id uuid,
  unit_price numeric default 0,
  currency text default 'TRY',
  movement_date date default current_date,
  source text default '',
  notes text default '',
  created_at timestamptz not null default now()
);

alter table public.stock_movements
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists product_id uuid references public.products(id) on delete set null,
add column if not exists product_code text default '',
add column if not exists product_name text,
add column if not exists movement_type text not null default 'in',
add column if not exists quantity numeric not null default 0,
add column if not exists unit text default 'adet',
add column if not exists supplier_name text default '',
add column if not exists order_id uuid,
add column if not exists request_id uuid,
add column if not exists report_id uuid,
add column if not exists unit_price numeric default 0,
add column if not exists currency text default 'TRY',
add column if not exists movement_date date default current_date,
add column if not exists source text default '',
add column if not exists notes text default '',
add column if not exists created_at timestamptz not null default now();

alter table public.stock_movements enable row level security;

drop policy if exists "Users can read own stock movements" on public.stock_movements;
create policy "Users can read own stock movements"
on public.stock_movements for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own stock movements" on public.stock_movements;
create policy "Users can insert own stock movements"
on public.stock_movements for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own stock movements" on public.stock_movements;
create policy "Users can update own stock movements"
on public.stock_movements for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own stock movements" on public.stock_movements;
create policy "Users can delete own stock movements"
on public.stock_movements for delete
using (auth.uid()::text = user_id::text);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_code text not null,
  project_name text not null,
  customer_name text default '',
  description text default '',
  contract_amount numeric default 0,
  estimated_budget numeric default 0,
  actual_cost numeric default 0,
  start_date date,
  planned_end_date date,
  project_owner text default '',
  status text default 'Taslak',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists project_code text,
add column if not exists project_name text,
add column if not exists customer_name text default '',
add column if not exists description text default '',
add column if not exists contract_amount numeric default 0,
add column if not exists contract_currency text default 'TRY',
add column if not exists contract_exchange_rate numeric default 1,
add column if not exists contract_base_amount numeric default 0,
add column if not exists estimated_budget numeric default 0,
add column if not exists estimated_budget_currency text default 'TRY',
add column if not exists estimated_budget_exchange_rate numeric default 1,
add column if not exists estimated_budget_base_amount numeric default 0,
add column if not exists actual_cost numeric default 0,
add column if not exists start_date date,
add column if not exists planned_end_date date,
add column if not exists project_owner text default '',
add column if not exists status text default 'Taslak',
add column if not exists closure_status text default 'Açık',
add column if not exists delivered_at timestamptz,
add column if not exists closed_at timestamptz,
add column if not exists archived_at timestamptz,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

create unique index if not exists projects_user_code_idx
on public.projects (user_id, project_code);

create table if not exists public.project_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_item_id uuid references public.project_items(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_code text default '',
  product_name text not null,
  unit text default 'adet',
  estimated_quantity numeric default 0,
  estimated_unit_price numeric default 0,
  estimated_total numeric default 0,
  status text default 'Bekliyor',
  note text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_items
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists project_id uuid references public.projects(id) on delete cascade,
add column if not exists parent_item_id uuid references public.project_items(id) on delete cascade,
add column if not exists product_id uuid references public.products(id) on delete set null,
add column if not exists product_code text default '',
add column if not exists brand text default '',
add column if not exists product_name text,
add column if not exists unit text default 'adet',
add column if not exists estimated_quantity numeric default 0,
add column if not exists estimated_unit_price numeric default 0,
add column if not exists quote_unit_price numeric default 0,
add column if not exists quote_total numeric default 0,
add column if not exists resolved_unit_price numeric default 0,
add column if not exists resolved_total numeric default 0,
add column if not exists price_source text default '',
add column if not exists price_source_order_id uuid,
add column if not exists price_source_date timestamptz,
add column if not exists currency text default 'TRY',
add column if not exists exchange_rate numeric default 1,
add column if not exists estimated_total numeric default 0,
add column if not exists estimated_total_base numeric default 0,
add column if not exists status text default 'Bekliyor',
add column if not exists source_file text default '',
add column if not exists source_type text default '',
add column if not exists raw_item_id text default '',
add column if not exists item_type text default 'sub',
add column if not exists note text default '',
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

create table if not exists public.project_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  payment_date date default current_date,
  amount numeric default 0,
  payment_type text default 'Avans',
  description text default '',
  created_at timestamptz not null default now()
);

alter table public.project_payments
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists project_id uuid references public.projects(id) on delete cascade,
add column if not exists payment_date date default current_date,
add column if not exists amount numeric default 0,
add column if not exists original_amount numeric default 0,
add column if not exists currency text default 'TRY',
add column if not exists exchange_rate numeric default 1,
add column if not exists exchange_rate_date date default current_date,
add column if not exists base_currency text default 'TRY',
add column if not exists base_amount numeric default 0,
add column if not exists payment_type text default 'Avans',
add column if not exists description text default '',
add column if not exists created_at timestamptz not null default now();

create table if not exists public.project_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  expense_type text default 'DiÄŸer',
  expense_date date default current_date,
  amount numeric default 0,
  original_amount numeric default 0,
  currency text default 'TRY',
  exchange_rate numeric default 1,
  exchange_rate_date date default current_date,
  base_currency text default 'TRY',
  base_amount numeric default 0,
  description text default '',
  created_at timestamptz not null default now()
);

alter table public.project_expenses
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists project_id uuid references public.projects(id) on delete cascade,
add column if not exists expense_type text default 'DiÄŸer',
add column if not exists expense_date date default current_date,
add column if not exists amount numeric default 0,
add column if not exists original_amount numeric default 0,
add column if not exists currency text default 'TRY',
add column if not exists exchange_rate numeric default 1,
add column if not exists exchange_rate_date date default current_date,
add column if not exists base_currency text default 'TRY',
add column if not exists base_amount numeric default 0,
add column if not exists description text default '',
add column if not exists created_at timestamptz not null default now();

create table if not exists public.project_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  revision_date date default current_date,
  revision_type text default 'Revizyon',
  title text not null,
  description text default '',
  revenue_amount numeric default 0,
  revenue_base_amount numeric default 0,
  cost_amount numeric default 0,
  cost_base_amount numeric default 0,
  currency text default 'TRY',
  exchange_rate numeric default 1,
  base_currency text default 'TRY',
  action_type text default 'manual',
  project_item_id uuid references public.project_items(id) on delete set null,
  product_code text default '',
  product_name text default '',
  unit text default 'adet',
  old_quantity numeric default 0,
  new_quantity numeric default 0,
  quantity_delta numeric default 0,
  old_unit_price numeric default 0,
  new_unit_price numeric default 0,
  unit_price_delta numeric default 0,
  old_total numeric default 0,
  new_total numeric default 0,
  cost_impact numeric default 0,
  performed_by uuid references auth.users(id) on delete set null,
  performed_by_email text default '',
  status text default 'Onay Bekliyor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_revisions
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists project_id uuid references public.projects(id) on delete cascade,
add column if not exists revision_date date default current_date,
add column if not exists revision_type text default 'Revizyon',
add column if not exists title text,
add column if not exists description text default '',
add column if not exists revenue_amount numeric default 0,
add column if not exists revenue_base_amount numeric default 0,
add column if not exists cost_amount numeric default 0,
add column if not exists cost_base_amount numeric default 0,
add column if not exists currency text default 'TRY',
add column if not exists exchange_rate numeric default 1,
add column if not exists base_currency text default 'TRY',
add column if not exists action_type text default 'manual',
add column if not exists project_item_id uuid references public.project_items(id) on delete set null,
add column if not exists product_code text default '',
add column if not exists product_name text default '',
add column if not exists unit text default 'adet',
add column if not exists old_quantity numeric default 0,
add column if not exists new_quantity numeric default 0,
add column if not exists quantity_delta numeric default 0,
add column if not exists old_unit_price numeric default 0,
add column if not exists new_unit_price numeric default 0,
add column if not exists unit_price_delta numeric default 0,
add column if not exists old_total numeric default 0,
add column if not exists new_total numeric default 0,
add column if not exists cost_impact numeric default 0,
add column if not exists performed_by uuid references auth.users(id) on delete set null,
add column if not exists performed_by_email text default '',
add column if not exists status text default 'Onay Bekliyor',
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

alter table if exists public.requests
add column if not exists project_id uuid references public.projects(id) on delete set null,
add column if not exists items jsonb default '[]'::jsonb;

alter table if exists public.reports
add column if not exists project_id uuid references public.projects(id) on delete set null,
add column if not exists supplier_offer_amount numeric default 0,
add column if not exists currency text default 'TRY',
add column if not exists exchange_rate numeric default 1,
add column if not exists exchange_rate_date date default current_date,
add column if not exists base_currency text default 'TRY',
add column if not exists base_amount numeric default 0,
add column if not exists net_unit_price numeric default 0,
add column if not exists net_unit_price_base numeric default 0,
add column if not exists net_total numeric default 0,
add column if not exists net_total_base numeric default 0;

alter table if exists public.orders
add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table if exists public.stock_movements
add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table if exists public.offers
add column if not exists project_id uuid references public.projects(id) on delete set null,
add column if not exists request_id uuid references public.requests(id) on delete set null;

create table if not exists public.order_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  project_item_id uuid references public.project_items(id) on delete set null,
  parent_item_id uuid references public.project_items(id) on delete set null,
  order_no text default '',
  supplier_name text default '',
  product_code text default '',
  product_name text not null,
  unit text default 'adet',
  ordered_quantity numeric default 0,
  received_quantity numeric default 0,
  accepted_quantity numeric default 0,
  missing_quantity numeric default 0,
  excess_quantity numeric default 0,
  defective_quantity numeric default 0,
  receipt_status text default 'Depoda',
  received_by text default '',
  receipt_date date default current_date,
  note text default '',
  created_at timestamptz not null default now()
);

alter table public.order_receipts
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists order_id uuid references public.orders(id) on delete cascade,
add column if not exists project_id uuid references public.projects(id) on delete set null,
add column if not exists project_item_id uuid references public.project_items(id) on delete set null,
add column if not exists parent_item_id uuid references public.project_items(id) on delete set null,
add column if not exists order_no text default '',
add column if not exists supplier_name text default '',
add column if not exists product_code text default '',
add column if not exists product_name text,
add column if not exists unit text default 'adet',
add column if not exists ordered_quantity numeric default 0,
add column if not exists received_quantity numeric default 0,
add column if not exists accepted_quantity numeric default 0,
add column if not exists missing_quantity numeric default 0,
add column if not exists excess_quantity numeric default 0,
add column if not exists defective_quantity numeric default 0,
add column if not exists receipt_status text default 'Depoda',
add column if not exists received_by text default '',
add column if not exists receipt_date date default current_date,
add column if not exists note text default '',
add column if not exists created_at timestamptz not null default now();

alter table public.stock_movements
add column if not exists project_item_id uuid references public.project_items(id) on delete set null,
add column if not exists parent_item_id uuid references public.project_items(id) on delete set null,
add column if not exists receipt_id uuid references public.order_receipts(id) on delete set null,
add column if not exists reserved_quantity numeric default 0,
add column if not exists issued_to_production_quantity numeric default 0;

alter table if exists public.orders
add column if not exists receipt_status text default 'Bekliyor',
add column if not exists received_total numeric default 0,
add column if not exists defective_total numeric default 0,
add column if not exists paid_amount numeric default 0,
add column if not exists paid_amount_base numeric default 0,
add column if not exists remaining_amount numeric default 0,
add column if not exists remaining_amount_base numeric default 0,
add column if not exists payment_status text default 'Ã–denmedi',
add column if not exists payment_note text default '',
add column if not exists last_payment_date date;

create table if not exists public.order_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  supplier_name text default '',
  payment_date date default current_date,
  amount numeric default 0,
  description text default '',
  created_at timestamptz not null default now()
);

alter table public.order_payments
add column if not exists user_id uuid references auth.users(id) on delete cascade,
add column if not exists order_id uuid references public.orders(id) on delete cascade,
add column if not exists project_id uuid references public.projects(id) on delete set null,
add column if not exists supplier_name text default '',
add column if not exists payment_date date default current_date,
add column if not exists amount numeric default 0,
add column if not exists original_amount numeric default 0,
add column if not exists currency text default 'TRY',
add column if not exists exchange_rate numeric default 1,
add column if not exists exchange_rate_date date default current_date,
add column if not exists base_currency text default 'TRY',
add column if not exists base_amount numeric default 0,
add column if not exists description text default '',
add column if not exists created_at timestamptz not null default now();

alter table public.project_items
add column if not exists received_quantity numeric default 0,
add column if not exists reserved_quantity numeric default 0,
add column if not exists issued_to_production_quantity numeric default 0,
add column if not exists defective_quantity numeric default 0,
add column if not exists panel_status text default 'Bekliyor';

alter table public.projects enable row level security;
alter table public.project_items enable row level security;
alter table public.project_payments enable row level security;
alter table public.project_expenses enable row level security;
alter table public.project_revisions enable row level security;
alter table public.order_receipts enable row level security;
alter table public.order_payments enable row level security;

drop policy if exists "Users can read own projects" on public.projects;
create policy "Users can read own projects"
on public.projects for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own projects" on public.projects;
create policy "Users can insert own projects"
on public.projects for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own projects" on public.projects;
create policy "Users can update own projects"
on public.projects for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own projects" on public.projects;
create policy "Users can delete own projects"
on public.projects for delete
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can read own project items" on public.project_items;
create policy "Users can read own project items"
on public.project_items for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own project items" on public.project_items;
create policy "Users can insert own project items"
on public.project_items for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own project items" on public.project_items;
create policy "Users can update own project items"
on public.project_items for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own project items" on public.project_items;
create policy "Users can delete own project items"
on public.project_items for delete
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can read own project payments" on public.project_payments;
create policy "Users can read own project payments"
on public.project_payments for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own project payments" on public.project_payments;
create policy "Users can insert own project payments"
on public.project_payments for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own project payments" on public.project_payments;
create policy "Users can update own project payments"
on public.project_payments for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own project payments" on public.project_payments;
create policy "Users can delete own project payments"
on public.project_payments for delete
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can read own project expenses" on public.project_expenses;
create policy "Users can read own project expenses"
on public.project_expenses for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own project expenses" on public.project_expenses;
create policy "Users can insert own project expenses"
on public.project_expenses for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own project expenses" on public.project_expenses;
create policy "Users can update own project expenses"
on public.project_expenses for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own project expenses" on public.project_expenses;
create policy "Users can delete own project expenses"
on public.project_expenses for delete
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can read own project revisions" on public.project_revisions;
create policy "Users can read own project revisions"
on public.project_revisions for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own project revisions" on public.project_revisions;
create policy "Users can insert own project revisions"
on public.project_revisions for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own project revisions" on public.project_revisions;
create policy "Users can update own project revisions"
on public.project_revisions for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own project revisions" on public.project_revisions;
create policy "Users can delete own project revisions"
on public.project_revisions for delete
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can read own order receipts" on public.order_receipts;
create policy "Users can read own order receipts"
on public.order_receipts for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own order receipts" on public.order_receipts;
create policy "Users can insert own order receipts"
on public.order_receipts for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own order receipts" on public.order_receipts;
create policy "Users can update own order receipts"
on public.order_receipts for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own order receipts" on public.order_receipts;
create policy "Users can delete own order receipts"
on public.order_receipts for delete
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can read own order payments" on public.order_payments;
create policy "Users can read own order payments"
on public.order_payments for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own order payments" on public.order_payments;
create policy "Users can insert own order payments"
on public.order_payments for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own order payments" on public.order_payments;
create policy "Users can update own order payments"
on public.order_payments for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own order payments" on public.order_payments;
create policy "Users can delete own order payments"
on public.order_payments for delete
using (auth.uid()::text = user_id::text);

-- Business partners extension: keep suppliers for old records, use it as the central partner table.
alter table public.suppliers
add column if not exists partner_type text default 'TedarikÃ§i',
add column if not exists normalized_name text,
add column if not exists contact_person text default '',
add column if not exists tax_number text default '',
add column if not exists city text default '',
add column if not exists address text default '';

update public.suppliers
set
  partner_type = coalesce(nullif(partner_type, ''), 'TedarikÃ§i'),
  contact_person = coalesce(nullif(contact_person, ''), contact_name, ''),
  tax_number = coalesce(nullif(tax_number, ''), tax_no, ''),
  normalized_name = lower(regexp_replace(trim(coalesce(name, '')), '\s+', ' ', 'g'))
where normalized_name is null or normalized_name = '';

create index if not exists suppliers_user_partner_type_idx
on public.suppliers(user_id, partner_type);

create index if not exists suppliers_user_normalized_name_idx
on public.suppliers(user_id, normalized_name);

alter table public.projects
add column if not exists customer_partner_id uuid references public.suppliers(id) on delete set null,
add column if not exists customer_partner_name text default '';

update public.projects
set customer_partner_name = coalesce(nullif(customer_partner_name, ''), customer_name, '')
where customer_name is not null and customer_name <> '';

alter table if exists public.reports
add column if not exists partner_id uuid references public.suppliers(id) on delete set null,
add column if not exists partner_name text default '',
add column if not exists partner_type text default 'TedarikÃ§i';

alter table if exists public.orders
add column if not exists partner_id uuid references public.suppliers(id) on delete set null,
add column if not exists partner_name text default '',
add column if not exists partner_type text default 'TedarikÃ§i';

update public.orders
set
  partner_name = coalesce(nullif(partner_name, ''), supplier_name, ''),
  partner_type = coalesce(nullif(partner_type, ''), 'TedarikÃ§i')
where supplier_name is not null and supplier_name <> '';

alter table if exists public.order_receipts
add column if not exists partner_id uuid references public.suppliers(id) on delete set null,
add column if not exists partner_name text default '',
add column if not exists partner_type text default 'TedarikÃ§i';

update public.order_receipts
set
  partner_name = coalesce(nullif(partner_name, ''), supplier_name, ''),
  partner_type = coalesce(nullif(partner_type, ''), 'TedarikÃ§i')
where supplier_name is not null and supplier_name <> '';

alter table if exists public.order_payments
add column if not exists partner_id uuid references public.suppliers(id) on delete set null,
add column if not exists partner_name text default '',
add column if not exists partner_type text default 'TedarikÃ§i';

update public.order_payments
set
  partner_name = coalesce(nullif(partner_name, ''), supplier_name, ''),
  partner_type = coalesce(nullif(partner_type, ''), 'TedarikÃ§i')
where supplier_name is not null and supplier_name <> '';

alter table if exists public.stock_movements
add column if not exists partner_id uuid references public.suppliers(id) on delete set null,
add column if not exists partner_name text default '',
add column if not exists partner_type text default 'TedarikÃ§i',
add column if not exists related_project_id uuid references public.projects(id) on delete set null,
add column if not exists related_project_name text default '';

update public.stock_movements
set
  partner_name = coalesce(nullif(partner_name, ''), supplier_name, ''),
  partner_type = coalesce(nullif(partner_type, ''), 'TedarikÃ§i')
where supplier_name is not null and supplier_name <> '';

create index if not exists projects_customer_partner_idx
on public.projects(customer_partner_id);

create index if not exists reports_partner_idx
on public.reports(partner_id);

create index if not exists orders_partner_idx
on public.orders(partner_id);

create index if not exists stock_movements_partner_idx
on public.stock_movements(partner_id);

alter table if exists public.requests
add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table if exists public.reports
add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table if exists public.orders
add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table if exists public.offers
add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table if exists public.requests enable row level security;
alter table if exists public.reports enable row level security;
alter table if exists public.orders enable row level security;
alter table if exists public.offers enable row level security;

drop policy if exists "Users can read own requests" on public.requests;
create policy "Users can read own requests"
on public.requests for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own requests" on public.requests;
create policy "Users can insert own requests"
on public.requests for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own requests" on public.requests;
create policy "Users can update own requests"
on public.requests for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own requests" on public.requests;
create policy "Users can delete own requests"
on public.requests for delete
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can read own reports" on public.reports;
create policy "Users can read own reports"
on public.reports for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own reports" on public.reports;
create policy "Users can insert own reports"
on public.reports for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own reports" on public.reports;
create policy "Users can update own reports"
on public.reports for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own reports" on public.reports;
create policy "Users can delete own reports"
on public.reports for delete
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can read own orders" on public.orders;
create policy "Users can read own orders"
on public.orders for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own orders" on public.orders;
create policy "Users can insert own orders"
on public.orders for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own orders" on public.orders;
create policy "Users can update own orders"
on public.orders for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own orders" on public.orders;
create policy "Users can delete own orders"
on public.orders for delete
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can read own offers" on public.offers;
create policy "Users can read own offers"
on public.offers for select
using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own offers" on public.offers;
create policy "Users can insert own offers"
on public.offers for insert
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own offers" on public.offers;
create policy "Users can update own offers"
on public.offers for update
using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own offers" on public.offers;
create policy "Users can delete own offers"
on public.offers for delete
using (auth.uid()::text = user_id::text);
