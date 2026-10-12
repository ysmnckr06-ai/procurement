begin;

-- iyzico aylık abonelik: lisans kaydına abonelik bilgileri eklenir.
-- Yazma işlemlerini yalnız sunucu (servis rolü) yapar; kullanıcı kendi
-- lisansını sadece okuyabilir (mevcut "Users can read own license" politikası).
alter table public.user_licenses
  add column if not exists billing_provider text,
  add column if not exists subscription_reference_code text,
  add column if not exists customer_reference_code text,
  add column if not exists subscription_status text,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists last_payment_at timestamptz,
  add column if not exists last_payment_failed_at timestamptz;

create unique index if not exists user_licenses_subscription_ref_idx
  on public.user_licenses(subscription_reference_code)
  where subscription_reference_code is not null;

-- Ödeme formu başlatıldığında token → kullanıcı eşlemesi. Callback geldiğinde
-- token yalnız bir kez ve yalnız başlatan kullanıcı için işlenir.
create table if not exists public.billing_checkouts (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pricing_plan_reference_code text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  result_status text
);

create index if not exists billing_checkouts_user_idx
  on public.billing_checkouts(user_id, created_at desc);

-- iyzico webhook bildirimleri: aynı bildirim iki kez işlenmesin.
create table if not exists public.billing_events (
  iyzi_reference_code text primary key,
  event_type text not null,
  subscription_reference_code text,
  order_reference_code text,
  user_id uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now(),
  payload jsonb
);

alter table public.billing_checkouts enable row level security;
alter table public.billing_events enable row level security;

revoke all on public.billing_checkouts from public, anon, authenticated;
revoke all on public.billing_events from public, anon, authenticated;
grant all on public.billing_checkouts to service_role;
grant all on public.billing_events to service_role;

notify pgrst, 'reload schema';

commit;
