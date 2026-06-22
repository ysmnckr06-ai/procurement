begin;

alter table public.products
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists products_user_archived_idx
  on public.products(user_id, archived_at);

create or replace function public.archive_zero_stock_product(
  target_product_id uuid,
  archive_reason text default 'Eski stok hareketi geri alinamadigi icin arsivlendi'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  target_product public.products%rowtype;
  normalized_code text;
  normalized_name text;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Oturum gerekli.';
  end if;

  select * into target_product
  from public.products product
  where product.id = target_product_id
    and product.user_id = actor_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Urun bulunamadi veya kullaniciya ait degil.';
  end if;

  if target_product.archived_at is not null then
    return jsonb_build_object('archived', true, 'already_archived', true, 'product_id', target_product.id);
  end if;

  if coalesce(target_product.current_stock, 0) <> 0
     or coalesce(target_product.reserved_stock, 0) <> 0 then
    raise exception using errcode = 'P0001', message = 'Arsivleme reddedildi: mevcut veya rezerve stok sifir degil.';
  end if;

  normalized_code := coalesce(
    nullif(upper(btrim(target_product.normalized_product_code)), ''),
    nullif(upper(btrim(target_product.product_code)), '')
  );
  normalized_name := nullif(upper(btrim(target_product.product_name)), '');

  if not exists (
    select 1 from public.stock_movements movement
    where movement.user_id = actor_id
      and movement.product_id = target_product.id
      and lower(btrim(coalesce(movement.movement_type, ''))) = 'in'
      and coalesce(movement.quantity, 0) > coalesce(target_product.current_stock, 0)
  ) then
    raise exception using errcode = 'P0001', message = 'Arsivleme reddedildi: stogu negatife dusurecek eski giris hareketi bulunmuyor.';
  end if;

  if exists (
    select 1 from public.stock_movements movement
    where movement.user_id = actor_id
      and movement.product_id = target_product.id
      and (
        movement.project_id is not null
        or movement.project_item_id is not null
        or movement.order_id is not null
        or movement.receipt_id is not null
        or movement.request_id is not null
        or movement.report_id is not null
      )
  ) then
    raise exception using errcode = 'P0001', message = 'Arsivleme reddedildi: proje/siparis/teslimat baglantili stok hareketi var.';
  end if;

  if exists (
    select 1 from public.project_items item
    where item.user_id = actor_id
      and (
        item.product_id = target_product.id
        or (normalized_code is not null and upper(btrim(coalesce(item.product_code, ''))) = normalized_code)
        or (
          normalized_code is null
          and normalized_name is not null
          and upper(btrim(coalesce(item.product_name, ''))) = normalized_name
        )
      )
  ) then
    raise exception using errcode = 'P0001', message = 'Arsivleme reddedildi: proje kalemi baglantisi var.';
  end if;

  if exists (
    select 1 from public.order_receipts receipt
    where receipt.user_id = actor_id
      and (
        (normalized_code is not null and upper(btrim(coalesce(receipt.product_code, ''))) = normalized_code)
        or (
          normalized_code is null
          and normalized_name is not null
          and upper(btrim(coalesce(receipt.product_name, ''))) = normalized_name
        )
      )
  ) then
    raise exception using errcode = 'P0001', message = 'Arsivleme reddedildi: siparis teslimat kaydi var.';
  end if;

  if exists (
    select 1
    from public.orders target_order
    cross join lateral jsonb_array_elements(coalesce(target_order.items, '[]'::jsonb)) order_item
    where target_order.user_id = actor_id
      and coalesce(target_order.status, '') not in (
        'Tam Teslim', 'Teslim Edildi', 'Tamamlandi', 'Tamamlandı',
        'Iptal', 'İptal', 'Kapandi', 'Kapandı'
      )
      and (
        coalesce(order_item->>'productId', order_item->>'product_id') = target_product.id::text
        or coalesce(target_order.items::text, '') like '%' || target_product.id::text || '%'
        or (
          normalized_code is not null
          and upper(btrim(coalesce(order_item->>'productCode', order_item->>'product_code', ''))) = normalized_code
        )
        or (
          normalized_code is not null
          and upper(coalesce(target_order.items::text, '')) like '%' || normalized_code || '%'
        )
      )
  ) then
    raise exception using errcode = 'P0001', message = 'Arsivleme reddedildi: acik siparis kalemi baglantisi var.';
  end if;

  if exists (
    select 1 from public.document_items document_item
    where document_item.user_id = actor_id
      and (
        (
          normalized_code is not null
          and (
            upper(btrim(coalesce(document_item.normalized_product_code, ''))) = normalized_code
            or upper(btrim(coalesce(document_item.product_code, ''))) = normalized_code
          )
        )
        or (
          normalized_code is null
          and normalized_name is not null
          and upper(btrim(coalesce(document_item.product_name, ''))) = normalized_name
        )
      )
  ) then
    raise exception using errcode = 'P0001', message = 'Arsivleme reddedildi: belge kalemi baglantisi var.';
  end if;

  update public.products product
  set
    archived_at = now(),
    archived_reason = left(coalesce(nullif(btrim(archive_reason), ''), 'Eski stok hareketi geri alinamadigi icin arsivlendi'), 500),
    archived_by = actor_id,
    updated_at = now()
  where product.id = target_product.id and product.user_id = actor_id;

  return jsonb_build_object('archived', true, 'already_archived', false, 'product_id', target_product.id);
end;
$$;

create or replace function public.restore_archived_product(target_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  restored_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Oturum gerekli.';
  end if;

  update public.products product
  set archived_at = null, archived_reason = null, archived_by = null, updated_at = now()
  where product.id = target_product_id
    and product.user_id = actor_id
    and product.archived_at is not null
  returning product.id into restored_id;

  if restored_id is null then
    raise exception using errcode = '42501', message = 'Arsivlenmis urun bulunamadi veya kullaniciya ait degil.';
  end if;

  return jsonb_build_object('restored', true, 'product_id', restored_id);
end;
$$;

revoke all on function public.archive_zero_stock_product(uuid, text) from public;
revoke all on function public.restore_archived_product(uuid) from public;
grant execute on function public.archive_zero_stock_product(uuid, text) to authenticated;
grant execute on function public.restore_archived_product(uuid) to authenticated;

comment on function public.archive_zero_stock_product(uuid, text) is
  'Sifir stoklu, aktif baglantisiz ve eski hareketi bulunan tenant urununu stok/hareket degistirmeden arsivler.';

commit;
