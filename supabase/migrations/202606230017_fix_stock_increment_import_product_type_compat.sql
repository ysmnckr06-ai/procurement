begin;

-- Production compatibility patch for tenants where public.products has no product_type column.
-- Keeps the existing RPC signature so the deployed frontend can continue sending p_product_type,
-- but does not read or write products.product_type.

create or replace function public.apply_stock_increment_import(
  p_product_id uuid,
  p_product_code text,
  p_product_name text,
  p_quantity numeric,
  p_unit text default 'adet',
  p_brand text default '',
  p_batch_id uuid default null,
  p_row_key text default null,
  p_source_file text default null,
  p_product_type text default 'component'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  normalized_code text := nullif(upper(btrim(coalesce(p_product_code, ''))), '');
  safe_name text := nullif(btrim(coalesce(p_product_name, '')), '');
  safe_row_key text := nullif(btrim(coalesce(p_row_key, '')), '');
  product_row public.products%rowtype;
  existing_entry public.stock_import_entries%rowtype;
  movement_id uuid;
  old_stock numeric;
  new_stock numeric;
  product_created boolean := false;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Oturum gerekli.';
  end if;

  if p_batch_id is null or safe_row_key is null then
    raise exception using errcode = '22023', message = 'Import batch ve satir anahtari zorunludur.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'Eklenecek stok miktari sifirdan buyuk olmalidir.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':stock-import:' || p_batch_id::text || ':' || safe_row_key, 0));

  select * into existing_entry
  from public.stock_import_entries entry
  where entry.user_id = actor_id
    and entry.batch_id = p_batch_id
    and entry.row_key = safe_row_key;

  if found then
    return jsonb_build_object(
      'success', true,
      'already_applied', true,
      'created', false,
      'product_id', existing_entry.product_id,
      'movement_id', existing_entry.movement_id,
      'applied_quantity', 0,
      'recorded_quantity', existing_entry.quantity
    );
  end if;

  if p_product_id is not null then
    select * into product_row
    from public.products product
    where product.id = p_product_id
      and product.user_id = actor_id
      and product.archived_at is null
    for update;

    if not found then
      raise exception using errcode = '42501', message = 'Urun bulunamadi, arsivli veya kullaniciya ait degil.';
    end if;

    if normalized_code is not null
       and nullif(upper(btrim(coalesce(product_row.normalized_product_code, product_row.product_code, ''))), '') is distinct from normalized_code then
      raise exception using errcode = 'P0001', message = 'Secilen urun kartinin kodu import satiriyla uyusmuyor.';
    end if;
  else
    if normalized_code is null then
      raise exception using errcode = '22023', message = 'Yeni urun karti icin urun kodu zorunludur.';
    end if;

    if safe_name is null then
      raise exception using errcode = '22023', message = 'Yeni urun karti icin urun adi zorunludur.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':product-code:' || normalized_code, 0));

    select * into product_row
    from public.products product
    where product.user_id = actor_id
      and product.normalized_product_code = normalized_code
      and product.archived_at is null
    for update;

    if not found and exists (
      select 1 from public.products archived_product
      where archived_product.user_id = actor_id
        and archived_product.normalized_product_code = normalized_code
        and archived_product.archived_at is not null
    ) then
      raise exception using errcode = 'P0001', message = 'Bu urun kodu arsivde bulunuyor. Once urunu aktif listeye geri yukleyin.';
    end if;

    if not found then
      insert into public.products (
        user_id, product_code, normalized_product_code, product_name, brand, unit,
        category, current_stock, reserved_stock, min_stock, critical_stock,
        source, notes, created_at, updated_at, last_movement_at
      ) values (
        actor_id, btrim(p_product_code), normalized_code, safe_name, coalesce(btrim(p_brand), ''),
        coalesce(nullif(btrim(p_unit), ''), 'adet'),
        case when p_product_type = 'main_product' then 'Ana Urun' else 'Toplu Yukleme' end,
        0, 0, 0, 0, 'Toplu dosya stok girisi',
        'Excel/PDF stok girisi sirasinda otomatik olusturuldu.', now(), now(), null
      )
      returning * into product_row;

      product_created := true;
    end if;
  end if;

  old_stock := coalesce(product_row.current_stock, 0);
  new_stock := old_stock + p_quantity;

  update public.products product
  set
    current_stock = new_stock,
    unit = coalesce(nullif(btrim(p_unit), ''), product.unit, 'adet'),
    brand = coalesce(nullif(product.brand, ''), nullif(btrim(p_brand), ''), ''),
    source = 'Toplu dosya stok girisi',
    notes = format('Dosya stok girisi ile %s adet eklendi. Eski stok: %s, yeni stok: %s', p_quantity, old_stock, new_stock),
    updated_at = now(),
    last_movement_at = now()
  where product.id = product_row.id
    and product.user_id = actor_id;

  insert into public.stock_movements (
    user_id, product_id, product_code, product_name, movement_type, quantity,
    unit, source, notes, movement_date
  ) values (
    actor_id, product_row.id, product_row.product_code, product_row.product_name,
    'in', p_quantity, coalesce(nullif(btrim(p_unit), ''), product_row.unit, 'adet'),
    'Toplu dosya stok girisi',
    format('Dosya: %s | Satir: %s | Stok %s + %s = %s', coalesce(p_source_file, '-'), safe_row_key, old_stock, p_quantity, new_stock),
    current_date
  )
  returning id into movement_id;

  insert into public.stock_import_entries (
    user_id, batch_id, row_key, source_file, product_id, quantity, movement_id
  ) values (
    actor_id, p_batch_id, safe_row_key, left(coalesce(p_source_file, ''), 500),
    product_row.id, p_quantity, movement_id
  );

  return jsonb_build_object(
    'success', true,
    'already_applied', false,
    'created', product_created,
    'product_id', product_row.id,
    'movement_id', movement_id,
    'old_stock', old_stock,
    'new_stock', new_stock,
    'applied_quantity', p_quantity,
    'recorded_quantity', p_quantity
  );
end;
$$;

revoke all on function public.apply_stock_increment_import(uuid, text, text, numeric, text, text, uuid, text, text, text) from public;
grant execute on function public.apply_stock_increment_import(uuid, text, text, numeric, text, text, uuid, text, text, text) to authenticated;

comment on function public.apply_stock_increment_import(uuid, text, text, numeric, text, text, uuid, text, text, text) is
  'Excel/PDF stok satirini tenant urunune atomik ve idempotent olarak ekler; products.product_type kolonu olmayan production semalariyla uyumludur.';

commit;
