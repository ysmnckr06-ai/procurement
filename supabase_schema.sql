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
using (auth.uid() = user_id);

drop policy if exists "Users can insert own suppliers" on public.suppliers;
create policy "Users can insert own suppliers"
on public.suppliers for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own suppliers" on public.suppliers;
create policy "Users can update own suppliers"
on public.suppliers for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own suppliers" on public.suppliers;
create policy "Users can delete own suppliers"
on public.suppliers for delete
using (auth.uid() = user_id);

create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text default '',
  tax_no text default '',
  default_currency text default 'TRY',
  annual_interest_rate numeric default 45,
  max_file_size_mb integer default 10,
  max_offer_files integer default 15,
  default_payment_term text default '60 gün',
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
add column if not exists annual_interest_rate numeric default 45,
add column if not exists max_file_size_mb integer default 10,
add column if not exists max_offer_files integer default 15,
add column if not exists default_payment_term text default '60 gün',
add column if not exists risk_level text default 'Orta',
add column if not exists approval_required boolean default true,
add column if not exists notify_email text default '',
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

alter table public.company_settings enable row level security;

drop policy if exists "Users can read own company settings" on public.company_settings;
create policy "Users can read own company settings"
on public.company_settings for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own company settings" on public.company_settings;
create policy "Users can insert own company settings"
on public.company_settings for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own company settings" on public.company_settings;
create policy "Users can update own company settings"
on public.company_settings for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own company settings" on public.company_settings;
create policy "Users can delete own company settings"
on public.company_settings for delete
using (auth.uid() = user_id);

alter table public.orders
add column if not exists items jsonb default '[]'::jsonb,
add column if not exists total_amount numeric default 0,
add column if not exists note text default '',
add column if not exists currency text default 'TRY',
add column if not exists delivery_date date,
add column if not exists termin_date date,
add column if not exists report_id uuid,
add column if not exists status_history jsonb default '[]'::jsonb;
