begin;

create or replace function public.bulk_delete_products_with_stock_records(
  target_product_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  target_ids uuid[] := coalesce(target_product_ids, array[]::uuid[]);
  product_row public.products%rowtype;
  deleted_products integer := 0;
  failed_products integer := 0;
  deleted_movements integer := 0;
  blocked boolean;
  movement_ids uuid[];
  affected_count integer := 0;
  failed_ids uuid[] := array[]::uuid[];
  failed_rows jsonb := '[]'::jsonb;
  normalized_code text;
  normalized_name text;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Oturum bulunamadı';
  end if;

  if cardinality(target_ids) = 0 then
    return jsonb_build_object(
      'deletedProductCount', 0,
      'failedProductCount', 0,
      'deletedMovementCount', 0,
      'failedProductIds', '[]'::jsonb,
      'failedProducts', '[]'::jsonb
    );
  end if;

  for product_row in
    select product.*
    from public.products product
    where product.user_id = actor_id
      and product.id = any(target_ids)
    order by product.created_at, product.id
    for update
  loop
    normalized_code := nullif(upper(btrim(coalesce(product_row.product_code, ''))), '');
    normalized_name := lower(btrim(coalesce(product_row.product_name, '')));

    blocked := exists (
      select 1
      from public.project_items item
      where item.user_id = actor_id
        and (
          item.product_id = product_row.id
          or (
            item.product_id is null
            and lower(btrim(coalesce(item.product_name, ''))) = normalized_name
            and (
              (normalized_code is not null and upper(btrim(coalesce(item.product_code, ''))) = normalized_code)
              or (normalized_code is null and nullif(btrim(coalesce(item.product_code, '')), '') is null)
            )
          )
        )
    )
    or exists (
      select 1
      from public.stock_movements movement
      where movement.user_id = actor_id
        and (movement.product_id = product_row.id or (
          movement.product_id is null
          and lower(btrim(coalesce(movement.product_name, ''))) = normalized_name
          and (
            (normalized_code is not null and upper(btrim(coalesce(movement.product_code, ''))) = normalized_code)
            or (normalized_code is null and nullif(btrim(coalesce(movement.product_code, '')), '') is null)
          )
        ))
        and (
          movement.project_id is not null
          or movement.project_item_id is not null
          or movement.parent_item_id is not null
          or movement.order_id is not null
          or movement.receipt_id is not null
          or movement.request_id is not null
          or movement.report_id is not null
        )
    )
    or exists (
      select 1
      from public.order_receipts receipt
      where receipt.user_id = actor_id
        and lower(btrim(coalesce(receipt.product_name, ''))) = normalized_name
        and (
          (normalized_code is not null and upper(btrim(coalesce(receipt.product_code, ''))) = normalized_code)
          or (normalized_code is null and nullif(btrim(coalesce(receipt.product_code, '')), '') is null)
        )
    )
    or exists (
      select 1
      from public.orders order_row
      where order_row.user_id = actor_id
        and (
          position(product_row.id::text in coalesce(order_row.items, '[]'::jsonb)::text) > 0
          or (
            position(normalized_name in lower(coalesce(order_row.items, '[]'::jsonb)::text)) > 0
            and (
              normalized_code is null
              or position(normalized_code in upper(coalesce(order_row.items, '[]'::jsonb)::text)) > 0
            )
          )
        )
    )
    or exists (
      select 1
      from public.requests request_row
      where request_row.user_id = actor_id
        and (
          position(product_row.id::text in coalesce(request_row.items, '[]'::jsonb)::text) > 0
          or (
            position(normalized_name in lower(coalesce(request_row.items, '[]'::jsonb)::text)) > 0
            and (
              normalized_code is null
              or position(normalized_code in upper(coalesce(request_row.items, '[]'::jsonb)::text)) > 0
            )
          )
        )
    )
    ;

    if blocked then
      failed_products := failed_products + 1;
      failed_ids := array_append(failed_ids, product_row.id);
      failed_rows := failed_rows || jsonb_build_array(jsonb_build_object(
        'id', product_row.id,
        'productName', product_row.product_name
      ));
      continue;
    end if;

    select coalesce(array_agg(movement.id), array[]::uuid[])
    into movement_ids
    from public.stock_movements movement
    where movement.user_id = actor_id
      and (
        movement.product_id = product_row.id
        or (
          movement.product_id is null
          and lower(btrim(coalesce(movement.product_name, ''))) = normalized_name
          and (
            (normalized_code is not null and upper(btrim(coalesce(movement.product_code, ''))) = normalized_code)
            or (normalized_code is null and nullif(btrim(coalesce(movement.product_code, '')), '') is null)
          )
        )
      );

    if cardinality(movement_ids) > 0 then
      update public.stock_import_entries entry
      set product_id = null, movement_id = null
      where entry.user_id = actor_id
        and (entry.product_id = product_row.id or entry.movement_id = any(movement_ids));

      delete from public.stock_movements movement
      where movement.user_id = actor_id
        and movement.id = any(movement_ids);

      get diagnostics affected_count = row_count;
      deleted_movements := deleted_movements + affected_count;
    end if;

    update public.stock_import_entries entry
    set product_id = null
    where entry.user_id = actor_id
      and entry.product_id = product_row.id;

    delete from public.products product
    where product.user_id = actor_id
      and product.id = product_row.id;

    if found then
      deleted_products := deleted_products + 1;
    else
      failed_products := failed_products + 1;
      failed_ids := array_append(failed_ids, product_row.id);
      failed_rows := failed_rows || jsonb_build_array(jsonb_build_object(
        'id', product_row.id,
        'productName', product_row.product_name
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'deletedProductCount', deleted_products,
    'failedProductCount', greatest(cardinality(target_ids) - deleted_products, failed_products),
    'deletedMovementCount', deleted_movements,
    'failedProductIds', coalesce(to_jsonb(failed_ids), '[]'::jsonb),
    'failedProducts', failed_rows
  );
end;
$$;

revoke all on function public.bulk_delete_products_with_stock_records(uuid[]) from public;
grant execute on function public.bulk_delete_products_with_stock_records(uuid[]) to authenticated;

comment on function public.bulk_delete_products_with_stock_records(uuid[]) is
  'Kritik proje/siparis/talep/rapor baglantisi olmayan kullanici urunlerini, ilgili stok kayitlariyla birlikte kalici olarak siler.';

commit;
