-- Malzemenin yeri ve projeler arası hareket.
--
-- Proje kalemindeki miktarlar:
--   depoda (projeye ayrılmış)   = reserved_quantity - issued_to_production_quantity
--   üretimde / montajda          = issued_to_production_quantity
--
-- 1) Montajdan/üretimden depoya iade: kullanılmayan malzeme depoya döner, projeye
--    ayrılmış kalır (stok ve rezerv artar).
-- 2) Projeler arası aktarım: A projesinin depodaki ya da montajdaki malzemesi acil
--    olan B projesine verilir. Her aktarım bir "ödünç" kaydıdır; B'ye malzeme
--    gelince "geri ver" ile A'ya depoda iade edilir.
-- Stok kartının toplam stoğu/rezervi aktarımda değişmez; maliyet hareketlerdeki
-- işaretli rezerv miktarıyla (veren −, alan +) projeler arasında taşınır.
begin;

create table if not exists public.project_item_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  from_project_id uuid references public.projects(id) on delete cascade,
  from_item_id uuid references public.project_items(id) on delete cascade,
  to_project_id uuid references public.projects(id) on delete cascade,
  to_item_id uuid references public.project_items(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  returned_quantity numeric not null default 0 check (returned_quantity >= 0),
  location text not null check (location in ('depo', 'montaj')),
  note text,
  status text not null default 'açık' check (status in ('açık', 'kapandı')),
  created_at timestamptz not null default now(),
  returned_at timestamptz
);

create index if not exists project_item_transfers_user_idx on public.project_item_transfers (user_id, status);
create index if not exists project_item_transfers_from_idx on public.project_item_transfers (from_project_id);
create index if not exists project_item_transfers_to_idx on public.project_item_transfers (to_project_id);

alter table public.project_item_transfers enable row level security;
revoke all on public.project_item_transfers from anon, authenticated;
grant select on public.project_item_transfers to authenticated;
create policy project_item_transfers_owner_select on public.project_item_transfers
  for select to authenticated using (user_id = auth.uid());

-- İç fonksiyon: miktarı bir kalemden ötekine taşır (yetki kontrolü çağıranda).
create or replace function public.move_project_item_quantity(
  p_actor uuid, p_from uuid, p_to uuid, p_quantity numeric, p_location text, p_note text
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  from_row public.project_items%rowtype;
  to_row public.project_items%rowtype;
  product_row public.products%rowtype;
  movable numeric;
  open_need numeric;
  qty numeric;
begin
  if p_from = p_to then
    raise exception 'Aynı kaleme aktarım yapılamaz.';
  end if;
  select * into from_row from public.project_items where id = p_from and user_id = p_actor for update;
  select * into to_row from public.project_items where id = p_to and user_id = p_actor for update;
  if from_row.id is null or to_row.id is null then
    raise exception 'Proje kalemi bulunamadı veya yetki yok.';
  end if;
  if from_row.product_id is null then
    raise exception 'Veren kalemin stok kartı yok.';
  end if;
  if to_row.product_id is not null and to_row.product_id <> from_row.product_id then
    raise exception 'İki kalem farklı stok kartına bağlı; aynı ürün olmalı.';
  end if;

  if p_location = 'montaj' then
    movable := greatest(coalesce(from_row.issued_to_production_quantity, 0), 0);
  else
    movable := greatest(coalesce(from_row.reserved_quantity, 0) - coalesce(from_row.issued_to_production_quantity, 0), 0);
  end if;
  open_need := greatest(
    coalesce(to_row.estimated_quantity, 0) - coalesce(to_row.received_quantity, 0) - coalesce(to_row.reserved_quantity, 0),
    0
  );
  qty := least(greatest(coalesce(p_quantity, 0), 0), movable, open_need);
  if qty <= 0 then
    raise exception 'Taşınabilir miktar yok (verende % %, alanda açık ihtiyaç %).',
      movable, case when p_location = 'montaj' then 'montajda' else 'depoda' end, open_need;
  end if;

  select * into product_row from public.products where id = from_row.product_id and user_id = p_actor;

  update public.project_items
  set
    reserved_quantity = greatest(coalesce(reserved_quantity, 0) - qty, 0),
    issued_to_production_quantity = case when p_location = 'montaj'
      then greatest(coalesce(issued_to_production_quantity, 0) - qty, 0)
      else issued_to_production_quantity end,
    status = 'Başka projeye verildi',
    updated_at = now()
  where id = from_row.id;

  update public.project_items
  set
    product_id = coalesce(product_id, from_row.product_id),
    reserved_quantity = coalesce(reserved_quantity, 0) + qty,
    issued_to_production_quantity = case when p_location = 'montaj'
      then coalesce(issued_to_production_quantity, 0) + qty
      else issued_to_production_quantity end,
    status = case
      when coalesce(reserved_quantity, 0) + qty >= coalesce(estimated_quantity, 0) then
        case when p_location = 'montaj' then 'Üretime verildi' else 'Projeye rezerve edildi' end
      else 'Satınalma gerekli'
    end,
    updated_at = now()
  where id = to_row.id;

  insert into public.stock_movements (
    user_id, product_id, product_code, product_name, movement_type, quantity, reserved_quantity,
    unit, project_id, project_item_id, parent_item_id, movement_date, source, notes, unit_price, currency
  ) values
    (p_actor, product_row.id, product_row.product_code, product_row.product_name, 'out', qty, -qty,
     coalesce(from_row.unit, product_row.unit, 'adet'), from_row.project_id, from_row.id, from_row.parent_item_id,
     current_date, 'Projeler arası aktarım (veren)', coalesce(nullif(p_note, ''), 'Malzeme başka projeye verildi'),
     nullif(coalesce(nullif(product_row.last_unit_price, 0), nullif(product_row.manual_unit_price, 0)), 0),
     coalesce(nullif(product_row.last_currency, ''), 'TRY')),
    (p_actor, product_row.id, product_row.product_code, product_row.product_name, 'out', qty, qty,
     coalesce(to_row.unit, product_row.unit, 'adet'), to_row.project_id, to_row.id, to_row.parent_item_id,
     current_date, 'Projeler arası aktarım (alan)', coalesce(nullif(p_note, ''), 'Malzeme başka projeden alındı'),
     nullif(coalesce(nullif(product_row.last_unit_price, 0), nullif(product_row.manual_unit_price, 0)), 0),
     coalesce(nullif(product_row.last_currency, ''), 'TRY'));

  return qty;
end;
$$;

revoke all on function public.move_project_item_quantity(uuid, uuid, uuid, numeric, text, text) from public, anon, authenticated;

-- A projesinden B projesine aktarım (ödünç kaydı açılır).
create or replace function public.transfer_project_item(
  p_from_item uuid, p_to_item uuid, p_quantity numeric, p_location text default 'depo', p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  moved numeric;
  transfer_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Oturum gerekli.';
  end if;
  if p_location not in ('depo', 'montaj') then
    raise exception 'Yer depo veya montaj olmalı.';
  end if;
  moved := public.move_project_item_quantity(actor_id, p_from_item, p_to_item, p_quantity, p_location, p_note);
  insert into public.project_item_transfers (
    user_id, product_id, from_project_id, from_item_id, to_project_id, to_item_id, quantity, location, note
  )
  select actor_id, f.product_id, f.project_id, f.id, t.project_id, t.id, moved, p_location, nullif(p_note, '')
  from public.project_items f, public.project_items t
  where f.id = p_from_item and t.id = p_to_item
  returning id into transfer_id;
  return jsonb_build_object('transfer_id', transfer_id, 'quantity', moved);
end;
$$;

revoke all on function public.transfer_project_item(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.transfer_project_item(uuid, uuid, numeric, text, text) to authenticated;

-- Ödünç iadesi: alan projenin depodaki malzemesi veren projeye depoda geri verilir.
create or replace function public.return_project_item_transfer(p_transfer_id uuid, p_quantity numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  transfer_row public.project_item_transfers%rowtype;
  wanted numeric;
  moved numeric;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Oturum gerekli.';
  end if;
  select * into transfer_row from public.project_item_transfers
  where id = p_transfer_id and user_id = actor_id for update;
  if not found or transfer_row.status <> 'açık' then
    raise exception 'Açık ödünç kaydı bulunamadı.';
  end if;
  wanted := least(coalesce(p_quantity, transfer_row.quantity - transfer_row.returned_quantity),
                  transfer_row.quantity - transfer_row.returned_quantity);
  moved := public.move_project_item_quantity(
    actor_id, transfer_row.to_item_id, transfer_row.from_item_id, wanted, 'depo', 'Ödünç iadesi');
  update public.project_item_transfers
  set
    returned_quantity = returned_quantity + moved,
    status = case when returned_quantity + moved >= quantity then 'kapandı' else 'açık' end,
    returned_at = case when returned_quantity + moved >= quantity then now() else returned_at end
  where id = transfer_row.id;
  return jsonb_build_object('returned', moved);
end;
$$;

revoke all on function public.return_project_item_transfer(uuid, numeric) from public, anon;
grant execute on function public.return_project_item_transfer(uuid, numeric) to authenticated;

-- Montajdan/üretimden depoya iade.
create or replace function public.return_project_items_from_production(p_allocations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  allocation jsonb;
  item_row public.project_items%rowtype;
  qty numeric;
  returned_rows integer := 0;
  returned_total numeric := 0;
  failed_rows jsonb := '[]'::jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Oturum gerekli.';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'İade için kalem listesi gönderilmedi.';
  end if;
  for allocation in select * from jsonb_array_elements(p_allocations)
  loop
    select * into item_row from public.project_items
    where id = (allocation->>'project_item_id')::uuid and user_id = actor_id for update;
    if not found or item_row.product_id is null then
      failed_rows := failed_rows || jsonb_build_array(jsonb_build_object(
        'project_item_id', allocation->>'project_item_id', 'reason', 'Proje kalemi veya stok kartı bulunamadı.'));
      continue;
    end if;
    qty := least(greatest(coalesce((allocation->>'quantity')::numeric, 0), 0), coalesce(item_row.issued_to_production_quantity, 0));
    if qty <= 0 then
      failed_rows := failed_rows || jsonb_build_array(jsonb_build_object(
        'project_item_id', item_row.id, 'reason', 'Montajda/üretimde iade edilecek miktar yok.'));
      continue;
    end if;

    perform 1 from public.products where id = item_row.product_id and user_id = actor_id for update;
    update public.products
    set current_stock = coalesce(current_stock, 0) + qty,
        reserved_stock = coalesce(reserved_stock, 0) + qty,
        last_movement_at = now(),
        updated_at = now()
    where id = item_row.product_id and user_id = actor_id;

    update public.project_items
    set issued_to_production_quantity = greatest(coalesce(issued_to_production_quantity, 0) - qty, 0),
        status = case when greatest(coalesce(issued_to_production_quantity, 0) - qty, 0) > 0
          then 'Kısmen üretime verildi' else 'Projeye rezerve edildi' end,
        updated_at = now()
    where id = item_row.id;

    insert into public.stock_movements (
      user_id, product_id, product_code, product_name, movement_type, quantity, reserved_quantity,
      unit, project_id, project_item_id, parent_item_id, movement_date, source, notes
    )
    select actor_id, product.id, product.product_code, product.product_name, 'in', qty, 0,
           coalesce(item_row.unit, product.unit, 'adet'), item_row.project_id, item_row.id, item_row.parent_item_id,
           current_date, 'Üretimden iade', coalesce(nullif(allocation->>'note', ''), 'Montajdan/üretimden depoya iade')
    from public.products product where product.id = item_row.product_id;

    returned_rows := returned_rows + 1;
    returned_total := returned_total + qty;
  end loop;
  return jsonb_build_object('returned_items', returned_rows, 'returned_quantity', returned_total, 'failed', failed_rows);
end;
$$;

revoke all on function public.return_project_items_from_production(jsonb) from public, anon;
grant execute on function public.return_project_items_from_production(jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
