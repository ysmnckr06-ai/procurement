-- Projeye ayrılmış malzemeyi depodan üretime/montaja çıkarma.
-- Önceden arayüzde bu adım yoktu; "yarım montaj / üretimde" durumları
-- kaydedilemiyordu.
--
-- Anlamı: malzeme depodan fiziksel olarak çıkar (current_stock ve reserved_stock
-- düşer). Proje kalemindeki reserved_quantity projeye ayrılan toplamı göstermeye
-- devam eder; issued_to_production_quantity bunun ne kadarının üretime çıktığını
-- tutar. Böylece projenin ihtiyaç/karşılanma hesabı değişmez.
begin;

create or replace function public.issue_project_items_to_production(p_allocations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  allocation jsonb;
  item_row public.project_items%rowtype;
  requested numeric;
  issuable numeric;
  issue_quantity numeric;
  issued_rows integer := 0;
  issued_total numeric := 0;
  failed_rows jsonb := '[]'::jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Oturum gerekli.';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception using errcode = '22023', message = 'Üretime çıkış için kalem listesi gönderilmedi.';
  end if;

  for allocation in select * from jsonb_array_elements(p_allocations)
  loop
    requested := greatest(coalesce((allocation->>'quantity')::numeric, 0), 0);

    select * into item_row
    from public.project_items
    where id = (allocation->>'project_item_id')::uuid and user_id = actor_id
    for update;

    if not found or item_row.product_id is null then
      failed_rows := failed_rows || jsonb_build_array(jsonb_build_object(
        'project_item_id', allocation->>'project_item_id',
        'reason', 'Proje kalemi veya bağlı stok kartı bulunamadı.'));
      continue;
    end if;

    issuable := greatest(coalesce(item_row.reserved_quantity, 0) - coalesce(item_row.issued_to_production_quantity, 0), 0);
    issue_quantity := least(requested, issuable);

    if issue_quantity <= 0 then
      failed_rows := failed_rows || jsonb_build_array(jsonb_build_object(
        'project_item_id', item_row.id,
        'reason', 'Projeye ayrılmış ve henüz üretime çıkmamış miktar yok.'));
      continue;
    end if;

    perform 1 from public.products where id = item_row.product_id and user_id = actor_id for update;

    update public.products
    set
      current_stock = greatest(coalesce(current_stock, 0) - issue_quantity, 0),
      reserved_stock = greatest(coalesce(reserved_stock, 0) - issue_quantity, 0),
      last_movement_at = now(),
      updated_at = now()
    where id = item_row.product_id and user_id = actor_id;

    update public.project_items
    set
      issued_to_production_quantity = coalesce(issued_to_production_quantity, 0) + issue_quantity,
      status = case
        when coalesce(issued_to_production_quantity, 0) + issue_quantity >= coalesce(estimated_quantity, 0)
          then 'Üretime verildi'
        else 'Kısmen üretime verildi'
      end,
      updated_at = now()
    where id = item_row.id and user_id = actor_id;

    insert into public.stock_movements (
      user_id, product_id, product_code, product_name, movement_type, quantity,
      reserved_quantity, issued_to_production_quantity, unit, project_id,
      project_item_id, parent_item_id, movement_date, source, notes
    )
    select
      actor_id, product.id, product.product_code, product.product_name, 'out', issue_quantity,
      0, issue_quantity, coalesce(item_row.unit, product.unit, 'adet'), item_row.project_id,
      item_row.id, item_row.parent_item_id, current_date, 'Üretime çıkış',
      coalesce(nullif(allocation->>'note', ''), 'Projeye ayrılan malzeme depodan üretime/montaja çıkarıldı')
    from public.products product
    where product.id = item_row.product_id;

    issued_rows := issued_rows + 1;
    issued_total := issued_total + issue_quantity;
  end loop;

  return jsonb_build_object('issued_items', issued_rows, 'issued_quantity', issued_total, 'failed', failed_rows);
end;
$$;

revoke all on function public.issue_project_items_to_production(jsonb) from public;
grant execute on function public.issue_project_items_to_production(jsonb) to authenticated;

-- Proje iptalinde yalnız depoda duran (üretime çıkmamış) rezerv bırakılır.
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
      and coalesce(project_item.reserved_quantity, 0) > coalesce(project_item.issued_to_production_quantity, 0)
    for update
  loop
    release_quantity := coalesce(item_row.reserved_quantity, 0) - coalesce(item_row.issued_to_production_quantity, 0);

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
      reserved_quantity = coalesce(project_item.issued_to_production_quantity, 0),
      status = 'İptal edildi',
      updated_at = now()
    where project_item.id = item_row.id and project_item.user_id = actor_id;

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

notify pgrst, 'reload schema';

commit;
