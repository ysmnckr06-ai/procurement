begin;

create or replace function public.delete_stock_movement_with_reversal(
  target_movement_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  movement_row public.stock_movements%rowtype;
  product_row public.products%rowtype;
  project_item_row public.project_items%rowtype;
  movement_class text;
  normalized_source text;
  movement_quantity numeric;
  reversal_reserved_quantity numeric;
  next_project_received numeric;
  next_project_reserved numeric;
  next_project_status text;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Oturum bulunamadi';
  end if;

  select movement.*
  into movement_row
  from public.stock_movements movement
  where movement.id = target_movement_id
    and movement.user_id = current_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Stok hareketi bulunamadi veya bu kullaniciya ait degil';
  end if;

  if movement_row.movement_type not in ('in', 'out') then
    raise exception using
      errcode = '22023',
      message = format(
        'Bilinmeyen movement_type: %s. Hareket silinmedi',
        coalesce(movement_row.movement_type, '<null>')
      );
  end if;

  normalized_source := lower(btrim(coalesce(movement_row.source, '')));
  movement_quantity := greatest(coalesce(movement_row.quantity, 0), 0);
  reversal_reserved_quantity := greatest(coalesce(movement_row.reserved_quantity, 0), 0);

  if normalized_source like 'depo sayımı / toplu excel aktarımı%' then
    movement_class := 'inventory_adjustment';
  elsif movement_row.movement_type = 'out'
    and normalized_source like 'ana kalem tamamlanan miktar kaydı%'
    and coalesce(movement_row.issued_to_production_quantity, 0) > 0
  then
    movement_class := 'production_consumption';
  elsif movement_row.movement_type = 'out'
    and normalized_source like 'projeye stoktan karşılandı%'
    and coalesce(movement_row.issued_to_production_quantity, 0) = 0
    and reversal_reserved_quantity > 0
  then
    movement_class := 'reservation';
  elsif movement_row.movement_type = 'out'
    and coalesce(movement_row.issued_to_production_quantity, 0) = 0
    and reversal_reserved_quantity = 0
    and (
      normalized_source like 'stok çıkışı%'
      or normalized_source like 'manuel stok çıkışı%'
      or normalized_source like '%sevk%'
      or normalized_source like '%fire%'
      or normalized_source like '%hatalı%'
      or normalized_source like '%iade%'
      or normalized_source like '%montaj%'
    )
  then
    movement_class := 'normal_out';
  elsif movement_row.movement_type = 'in'
    and (
      normalized_source like 'depo teslim alma%'
      or normalized_source like 'sipariş teslimatı%'
      or normalized_source like 'proje teklifinden stok aktarımı%'
      or normalized_source like 'proje dosyasından ürün kartı oluşturuldu%'
    )
  then
    movement_class := 'in';
  else
    raise exception using
      errcode = '22023',
      message = format(
        'Stok hareketi guvenle siniflandirilamadi: type=%s, source=%s. Hareket silinmedi',
        movement_row.movement_type,
        coalesce(movement_row.source, '<bos>')
      );
  end if;

  if movement_class = 'production_consumption' then
    reversal_reserved_quantity := greatest(
      coalesce(movement_row.reserved_quantity, 0),
      0
    );
  elsif movement_class = 'reservation' then
    reversal_reserved_quantity := case
      when coalesce(movement_row.reserved_quantity, 0) > 0
        then movement_row.reserved_quantity
      else movement_quantity
    end;
  end if;

  if movement_row.product_id is not null and movement_quantity > 0 then
    select product.*
    into product_row
    from public.products product
    where product.id = movement_row.product_id
      and product.user_id = current_user_id
    for update;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'Harekete bagli urun bulunamadi veya kullaniciya ait degil. Hareket silinmedi';
    end if;

    if movement_class = 'inventory_adjustment' and exists (
      select 1
      from public.products duplicate_product
      where duplicate_product.user_id = current_user_id
        and duplicate_product.id <> product_row.id
        and (
          (
            nullif(btrim(product_row.product_code), '') is not null
            and lower(btrim(duplicate_product.product_code)) = lower(btrim(product_row.product_code))
            and lower(btrim(coalesce(duplicate_product.product_name, '')))
              = lower(btrim(coalesce(product_row.product_name, '')))
          )
          or (
            nullif(btrim(product_row.product_code), '') is null
            and nullif(btrim(duplicate_product.product_code), '') is null
            and lower(btrim(coalesce(duplicate_product.product_name, '')))
              = lower(btrim(coalesce(product_row.product_name, '')))
          )
        )
    ) then
      raise exception using
        errcode = '23514',
        message = 'Depo sayim hareketi birlestirilmis birden fazla urun kartina bagli olabilir. Hareket silinmedi';
    end if;

    if movement_class in ('in', 'inventory_adjustment')
      and movement_row.movement_type = 'in'
    then
      if coalesce(product_row.current_stock, 0) < movement_quantity then
        raise exception using
          errcode = '23514',
          message = format(
            'Urun stogu hareketi geri almaya yetmiyor: mevcut=%s, gerekli=%s. Hareket silinmedi',
            coalesce(product_row.current_stock, 0),
            movement_quantity
          );
      end if;

      update public.products
      set
        current_stock = coalesce(current_stock, 0) - movement_quantity,
        updated_at = now()
      where id = movement_row.product_id
        and user_id = current_user_id;
    elsif movement_class in ('normal_out', 'inventory_adjustment')
      and movement_row.movement_type = 'out'
    then
      update public.products
      set
        current_stock = coalesce(current_stock, 0) + movement_quantity,
        updated_at = now()
      where id = movement_row.product_id
        and user_id = current_user_id;
    elsif movement_class = 'reservation' then
      if coalesce(product_row.reserved_stock, 0) < reversal_reserved_quantity then
        raise exception using
          errcode = '23514',
          message = format(
            'Urun rezervi hareketi geri almaya yetmiyor: mevcut=%s, gerekli=%s. Hareket silinmedi',
            coalesce(product_row.reserved_stock, 0),
            reversal_reserved_quantity
          );
      end if;

      update public.products
      set
        reserved_stock = coalesce(reserved_stock, 0) - reversal_reserved_quantity,
        updated_at = now()
      where id = movement_row.product_id
        and user_id = current_user_id;
    elsif movement_class = 'production_consumption' then
      update public.products
      set
        current_stock = coalesce(current_stock, 0) + movement_quantity,
        reserved_stock = coalesce(reserved_stock, 0) + reversal_reserved_quantity,
        updated_at = now()
      where id = movement_row.product_id
        and user_id = current_user_id;
    else
      raise exception using
        errcode = '22023',
        message = 'Urun stok tersleme sinifi desteklenmiyor. Hareket silinmedi';
    end if;
  elsif movement_quantity > 0 then
    raise exception using
      errcode = 'P0002',
      message = 'Miktarli stok hareketinin urun baglantisi yok. Hareket silinmedi';
  end if;

  if movement_row.project_item_id is not null and movement_quantity > 0 then
    select project_item.*
    into project_item_row
    from public.project_items project_item
    where project_item.id = movement_row.project_item_id
      and project_item.user_id = current_user_id
    for update;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'Harekete bagli proje kalemi bulunamadi veya kullaniciya ait degil. Hareket silinmedi';
    end if;

    if movement_class = 'in' then
      if coalesce(project_item_row.received_quantity, 0) < movement_quantity then
        raise exception using
          errcode = '23514',
          message = format(
            'Proje teslim miktari hareketi geri almaya yetmiyor: mevcut=%s, gerekli=%s. Hareket silinmedi',
            coalesce(project_item_row.received_quantity, 0),
            movement_quantity
          );
      end if;

      next_project_received := coalesce(project_item_row.received_quantity, 0) - movement_quantity;
      next_project_reserved := coalesce(project_item_row.reserved_quantity, 0);
    elsif movement_class = 'reservation' then
      if coalesce(project_item_row.reserved_quantity, 0) < reversal_reserved_quantity then
        raise exception using
          errcode = '23514',
          message = format(
            'Proje rezervi hareketi geri almaya yetmiyor: mevcut=%s, gerekli=%s. Hareket silinmedi',
            coalesce(project_item_row.reserved_quantity, 0),
            reversal_reserved_quantity
          );
      end if;

      next_project_received := coalesce(project_item_row.received_quantity, 0);
      next_project_reserved := coalesce(project_item_row.reserved_quantity, 0) - reversal_reserved_quantity;
    elsif movement_class = 'production_consumption' then
      if coalesce(project_item_row.received_quantity, 0) < movement_quantity then
        raise exception using
          errcode = '23514',
          message = format(
            'Proje tuketim miktari hareketi geri almaya yetmiyor: mevcut=%s, gerekli=%s. Hareket silinmedi',
            coalesce(project_item_row.received_quantity, 0),
            movement_quantity
          );
      end if;

      next_project_received := coalesce(project_item_row.received_quantity, 0) - movement_quantity;
      next_project_reserved := coalesce(project_item_row.reserved_quantity, 0) + reversal_reserved_quantity;
    elsif movement_class in ('normal_out', 'inventory_adjustment') then
      raise exception using
        errcode = '22023',
        message = format(
          '%s hareketi beklenmedik bir proje kalemine bagli. Hareket silinmedi',
          movement_class
        );
    else
      raise exception using
        errcode = '22023',
        message = 'Proje stok tersleme sinifi desteklenmiyor. Hareket silinmedi';
    end if;

    if next_project_received < 0 or next_project_reserved < 0 then
      raise exception using
        errcode = '23514',
        message = 'Proje stok terslemesi negatif sayac uretti. Hareket silinmedi';
    end if;

    next_project_status := case
      when next_project_received >= coalesce(project_item_row.estimated_quantity, 0)
        and coalesce(project_item_row.estimated_quantity, 0) > 0
        then 'Tamamlandı'
      when next_project_received > 0
        then 'İşlemde'
      when next_project_reserved >= coalesce(project_item_row.estimated_quantity, 0)
        and coalesce(project_item_row.estimated_quantity, 0) > 0
        then 'Projeye rezerve edildi'
      else 'Satınalma gerekli'
    end;

    update public.project_items
    set
      received_quantity = next_project_received,
      reserved_quantity = next_project_reserved,
      status = next_project_status,
      updated_at = now()
    where id = movement_row.project_item_id
      and user_id = current_user_id;
  end if;

  delete from public.stock_movements
  where id = movement_row.id
    and user_id = current_user_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Stok hareketi silinemedi';
  end if;

  return movement_row.id;
end;
$$;

revoke all on function public.delete_stock_movement_with_reversal(uuid) from public;
grant execute on function public.delete_stock_movement_with_reversal(uuid) to authenticated;

comment on function public.delete_stock_movement_with_reversal(uuid) is
  'Kullanicinin kendi stok hareketini fail-closed siniflandirir, urun ve proje sayaclarini ayni transaction icinde tersleyerek siler.';

commit;
