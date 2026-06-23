begin;

alter table if exists public.project_items
  add column if not exists reserved_quantity numeric default 0;

alter table if exists public.stock_movements
  add column if not exists reserved_quantity numeric default 0,
  add column if not exists project_item_id uuid,
  add column if not exists parent_item_id uuid;

create or replace function public.reserve_project_items_from_stock(
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  allocation jsonb;
  product_row public.products%rowtype;
  item_row public.project_items%rowtype;
  requested_quantity numeric;
  open_quantity numeric;
  available_quantity numeric;
  quantity_to_reserve numeric;
  processed_count integer := 0;
  total_reserved_quantity numeric := 0;
  failed_rows jsonb := '[]'::jsonb;
begin
  if actor_id is null then
    raise exception 'Oturum bulunamadı.';
  end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'Stoktan karşılama için geçerli kalem listesi gönderilmedi.';
  end if;

  for allocation in select * from jsonb_array_elements(p_allocations)
  loop
    requested_quantity := greatest(coalesce((allocation->>'quantity')::numeric, 0), 0);

    if requested_quantity <= 0 then
      failed_rows := failed_rows || jsonb_build_array(jsonb_build_object(
        'project_item_id', allocation->>'project_item_id',
        'reason', 'Ayrılacak miktar sıfır veya geçersiz.'
      ));
      continue;
    end if;

    select *
      into item_row
      from public.project_items
      where id = (allocation->>'project_item_id')::uuid
        and user_id = actor_id
      for update;

    if not found then
      failed_rows := failed_rows || jsonb_build_array(jsonb_build_object(
        'project_item_id', allocation->>'project_item_id',
        'reason', 'Proje kalemi bulunamadı veya yetki yok.'
      ));
      continue;
    end if;

    if allocation ? 'project_id'
      and nullif(allocation->>'project_id', '') is not null
      and item_row.project_id <> (allocation->>'project_id')::uuid then
      failed_rows := failed_rows || jsonb_build_array(jsonb_build_object(
        'project_item_id', item_row.id,
        'reason', 'Proje kalemi seçili projeye ait değil.'
      ));
      continue;
    end if;

    select *
      into product_row
      from public.products
      where id = (allocation->>'product_id')::uuid
        and user_id = actor_id
      for update;

    if not found then
      failed_rows := failed_rows || jsonb_build_array(jsonb_build_object(
        'project_item_id', item_row.id,
        'reason', 'Ürün kartı bulunamadı veya yetki yok.'
      ));
      continue;
    end if;

    open_quantity := greatest(
      coalesce(item_row.estimated_quantity, 0)
      - coalesce(item_row.received_quantity, 0)
      - coalesce(item_row.reserved_quantity, 0),
      0
    );
    available_quantity := greatest(coalesce(product_row.current_stock, 0) - coalesce(product_row.reserved_stock, 0), 0);
    quantity_to_reserve := least(requested_quantity, open_quantity, available_quantity);

    if quantity_to_reserve <= 0 then
      failed_rows := failed_rows || jsonb_build_array(jsonb_build_object(
        'project_item_id', item_row.id,
        'reason', 'Boşta stok veya açık ihtiyaç kalmadı.'
      ));
      continue;
    end if;

    update public.products
      set
        reserved_stock = coalesce(reserved_stock, 0) + quantity_to_reserve,
        last_movement_at = now(),
        updated_at = now()
      where id = product_row.id
        and user_id = actor_id;

    update public.project_items
      set
        product_id = coalesce(product_id, product_row.id),
        reserved_quantity = coalesce(reserved_quantity, 0) + quantity_to_reserve,
        status = case
          when open_quantity - quantity_to_reserve <= 0 then 'Projeye rezerve edildi'
          else 'Satınalma gerekli'
        end,
        updated_at = now()
      where id = item_row.id
        and user_id = actor_id;

    insert into public.stock_movements (
      user_id, product_id, product_code, product_name, movement_type, quantity,
      reserved_quantity, unit, project_id, project_item_id, parent_item_id,
      movement_date, source, notes
    ) values (
      actor_id, product_row.id,
      coalesce(nullif(allocation->>'product_code', ''), product_row.product_code, item_row.product_code, ''),
      coalesce(nullif(allocation->>'product_name', ''), product_row.product_name, item_row.product_name, ''),
      'out', quantity_to_reserve, quantity_to_reserve,
      coalesce(nullif(allocation->>'unit', ''), item_row.unit, product_row.unit, 'adet'),
      item_row.project_id, item_row.id, item_row.parent_item_id,
      current_date, 'Projeye stoktan karşılandı',
      coalesce(nullif(allocation->>'notes', ''), 'Çok projeli stok icmalinden ayrıldı')
    );

    processed_count := processed_count + 1;
    total_reserved_quantity := total_reserved_quantity + quantity_to_reserve;
  end loop;

  return jsonb_build_object(
    'processed', processed_count,
    'reserved_quantity', total_reserved_quantity,
    'failed', failed_rows
  );
end;
$$;

revoke all on function public.reserve_project_items_from_stock(jsonb) from public;
grant execute on function public.reserve_project_items_from_stock(jsonb) to authenticated;

comment on function public.reserve_project_items_from_stock(jsonb) is
  'Seçili proje kalemleri için tenant kontrollü, satır kilitlemeli stok rezervasyonu yapar.';

commit;
