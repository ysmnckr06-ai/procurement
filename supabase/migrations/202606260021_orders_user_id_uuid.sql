begin;

do $$
declare
  invalid_count integer;
  missing_auth_count integer;
begin
  select count(*)
  into invalid_count
  from public.orders
  where user_id is null
    or btrim(user_id::text) = ''
    or btrim(user_id::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  if invalid_count > 0 then
    raise exception 'orders.user_id uuid donusumu durduruldu: % null/bos/invalid user_id var', invalid_count;
  end if;

  select count(*)
  into missing_auth_count
  from public.orders order_row
  left join auth.users auth_user
    on auth_user.id = btrim(order_row.user_id::text)::uuid
  where auth_user.id is null;

  if missing_auth_count > 0 then
    raise exception 'orders.user_id uuid donusumu durduruldu: % orders satiri auth.users ile eslesmiyor', missing_auth_count;
  end if;
end $$;

alter table public.orders
  alter column user_id type uuid using btrim(user_id::text)::uuid;

alter table public.orders
  alter column user_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_user_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

create index if not exists orders_user_id_idx
  on public.orders(user_id);

alter table public.orders enable row level security;

drop policy if exists "Users can read own orders" on public.orders;
create policy "Users can read own orders" on public.orders
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own orders" on public.orders;
create policy "Users can insert own orders" on public.orders
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own orders" on public.orders;
create policy "Users can update own orders" on public.orders
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own orders" on public.orders;
create policy "Users can delete own orders" on public.orders
for delete
using (auth.uid() = user_id);

notify pgrst, 'reload schema';

commit;
