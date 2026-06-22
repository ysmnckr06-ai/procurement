begin;

create or replace function public.apply_stock_count_import(
  p_product_id uuid,
  p_counted_stock numeric,
  p_unit text default 'adet',
  p_brand text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  product_row public.products%rowtype;
  stock_difference numeric;
  movement_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Oturum gerekli.';
  end if;
  if p_product_id is null or p_counted_stock is null or p_counted_stock < 0 then
    raise exception using errcode = '22023', message = 'Geçerli ürün ve negatif olmayan sayım stoğu zorunludur.';
  end if;

  select * into product_row
  from public.products product
  where product.id = p_product_id and product.user_id = actor_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Ürün bulunamadı veya kullanıcıya ait değil.';
  end if;

  stock_difference := p_counted_stock - coalesce(product_row.current_stock, 0);

  update public.products product
  set
    current_stock = p_counted_stock,
    unit = coalesce(nullif(p_unit, ''), product.unit, 'adet'),
    brand = coalesce(nullif(product.brand, ''), nullif(p_brand, ''), ''),
    source = 'Depo sayımı',
    notes = format('Depo sayımı ile güncellendi. Eski stok: %s, yeni stok: %s', coalesce(product_row.current_stock, 0), p_counted_stock),
    updated_at = now(),
    last_movement_at = case when stock_difference <> 0 then now() else product.last_movement_at end
  where product.id = p_product_id and product.user_id = actor_id;

  if stock_difference <> 0 then
    insert into public.stock_movements (
      user_id, product_id, product_code, product_name, movement_type, quantity,
      unit, source, notes, movement_date
    ) values (
      actor_id, product_row.id, product_row.product_code, product_row.product_name,
      case when stock_difference > 0 then 'in' else 'out' end,
      abs(stock_difference), coalesce(nullif(p_unit, ''), product_row.unit, 'adet'),
      'Depo sayımı / toplu Excel aktarımı',
      format('Sayım sonucu stok %s → %s olarak güncellendi.', coalesce(product_row.current_stock, 0), p_counted_stock),
      current_date
    ) returning id into movement_id;
  end if;

  return movement_id;
end;
$$;

revoke all on function public.apply_stock_count_import(uuid, numeric, text, text) from public;
grant execute on function public.apply_stock_count_import(uuid, numeric, text, text) to authenticated;

commit;
