-- İptal edilen projenin stoktan ayrılmış (rezerve) malzemelerini depoya geri bırakır.
-- Önceden proje "İptal" yapılınca rezervasyonlar sonsuza kadar kilitli kalıyordu;
-- stok sayfasında "Projeye Ayrılan" düşmüyor, başka proje kullanamıyordu.
begin;

create or replace function public.release_project_reservations(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  item_row record;
  released_items integer := 0;
  released_total numeric := 0;
  release_quantity numeric;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Oturum gerekli.';
  end if;

  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id and project.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'Proje bulunamadı veya kullanıcıya ait değil.';
  end if;

  for item_row in
    select project_item.*
    from public.project_items project_item
    where project_item.project_id = p_project_id
      and project_item.user_id = actor_id
      and coalesce(project_item.reserved_quantity, 0) > 0
    for update
  loop
    release_quantity := coalesce(item_row.reserved_quantity, 0);

    if item_row.product_id is not null then
      update public.products product
      set
        reserved_stock = greatest(coalesce(product.reserved_stock, 0) - release_quantity, 0),
        last_movement_at = now(),
        updated_at = now()
      where product.id = item_row.product_id and product.user_id = actor_id;
    end if;

    update public.project_items project_item
    set
      reserved_quantity = 0,
      status = 'İptal edildi',
      updated_at = now()
    where project_item.id = item_row.id and project_item.user_id = actor_id;

    -- Stok ekranı rezerveyi hareketlerden de topladığı için ayırma hareketleri
    -- serbest bırakıldı olarak işaretlenir.
    update public.stock_movements movement
    set
      reserved_quantity = 0,
      notes = concat_ws(' | ', nullif(movement.notes, ''), 'Proje iptal edildi; rezerve stoğa geri bırakıldı')
    where movement.user_id = actor_id
      and movement.project_item_id = item_row.id
      and coalesce(movement.reserved_quantity, 0) > 0
      and coalesce(movement.issued_to_production_quantity, 0) = 0;

    released_items := released_items + 1;
    released_total := released_total + release_quantity;
  end loop;

  return jsonb_build_object('released_items', released_items, 'released_quantity', released_total);
end;
$$;

revoke all on function public.release_project_reservations(uuid) from public;
grant execute on function public.release_project_reservations(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
