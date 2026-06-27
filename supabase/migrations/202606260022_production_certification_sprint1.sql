begin;

alter table public.company_settings
  drop constraint if exists company_settings_positive_rates_check;

alter table public.company_settings
  add constraint company_settings_positive_rates_check
  check (
    usd_rate is not null and usd_rate > 0
    and eur_rate is not null and eur_rate > 0
    and gbp_rate is not null and gbp_rate > 0
  );

create or replace function public.set_supplier_normalized_name()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.name := nullif(regexp_replace(btrim(coalesce(new.name, new.firma_adi, '')), '\s+', ' ', 'g'), '');
  new.firma_adi := coalesce(nullif(regexp_replace(btrim(coalesce(new.firma_adi, '')), '\s+', ' ', 'g'), ''), new.name);
  new.normalized_name := lower(regexp_replace(btrim(coalesce(new.name, new.firma_adi, '')), '\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists suppliers_set_normalized_name on public.suppliers;
create trigger suppliers_set_normalized_name
before insert or update of name, firma_adi, normalized_name
on public.suppliers
for each row
execute function public.set_supplier_normalized_name();

do $$
declare
  duplicate_report text;
begin
  update public.suppliers
  set normalized_name = lower(regexp_replace(btrim(coalesce(name, firma_adi, '')), '\s+', ' ', 'g'))
  where nullif(btrim(coalesce(name, firma_adi, '')), '') is not null;

  select string_agg(
    format('user_id=%s normalized_name=%s count=%s', user_id, normalized_name, duplicate_count),
    '; '
    order by user_id, normalized_name
  )
  into duplicate_report
  from (
    select user_id, normalized_name, count(*) as duplicate_count
    from public.suppliers
    where normalized_name is not null
      and coalesce(status, 'Aktif') not in ('Pasif', 'Silindi')
    group by user_id, normalized_name
    having count(*) > 1
  ) duplicate_groups;

  if duplicate_report is not null then
    raise exception using
      errcode = '23505',
      message = 'suppliers icinde aktif normalize firma adi duplicate kayitlar var; unique index olusturulmadi.',
      detail = duplicate_report;
  end if;
end;
$$;

drop index if exists suppliers_user_normalized_name_active_uidx;
create unique index suppliers_user_normalized_name_active_uidx
on public.suppliers (user_id, normalized_name)
where normalized_name is not null
  and coalesce(status, 'Aktif') not in ('Pasif', 'Silindi');

create or replace function public.record_order_stock_receipt(
  p_order_id uuid,
  p_product_id uuid,
  p_project_id uuid default null,
  p_project_item_id uuid default null,
  p_parent_item_id uuid default null,
  p_document_item_id uuid default null,
  p_order_no text default '',
  p_supplier_name text default '',
  p_partner_id uuid default null,
  p_partner_name text default '',
  p_partner_type text default 'Tedarikçi',
  p_product_code text default '',
  p_product_name text default '',
  p_unit text default 'adet',
  p_ordered_quantity numeric default 0,
  p_received_quantity numeric default 0,
  p_accepted_quantity numeric default 0,
  p_missing_quantity numeric default 0,
  p_excess_quantity numeric default 0,
  p_defective_quantity numeric default 0,
  p_receipt_status text default 'Depoda',
  p_received_by text default '',
  p_receipt_date date default current_date,
  p_note text default '',
  p_unit_price numeric default 0,
  p_currency text default 'TRY',
  p_report_id uuid default null,
  p_order_items jsonb default null,
  p_order_status text default null,
  p_delivery_date date default null,
  p_status_history jsonb default null,
  p_order_receipt_status text default null,
  p_received_total numeric default null,
  p_defective_total numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  receipt_id uuid;
  duplicate_receipt_id uuid;
  safe_ordered numeric := greatest(coalesce(p_ordered_quantity, 0), 0);
  safe_received numeric := coalesce(p_received_quantity, 0);
  safe_accepted numeric := coalesce(p_accepted_quantity, 0);
  already_accepted numeric := 0;
  remaining_quantity numeric := 0;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Oturum gerekli.';
  end if;

  if p_order_id is null or p_product_id is null then
    raise exception using errcode = '22023', message = 'Sipariş ve ürün kartı zorunludur.';
  end if;

  if safe_received <= 0 or safe_accepted <= 0 then
    raise exception using errcode = '22023', message = 'Teslim miktarı 0''dan büyük olmalıdır.';
  end if;

  if safe_ordered <= 0 then
    raise exception using errcode = '22023', message = 'Sipariş miktarı 0''dan büyük olmalıdır.';
  end if;

  perform 1
  from public.orders target_order
  where target_order.id = p_order_id and target_order.user_id = actor_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Sipariş bulunamadı veya kullanıcıya ait değil.';
  end if;

  perform 1
  from public.products product
  where product.id = p_product_id and product.user_id = actor_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Ürün kartı bulunamadı veya kullanıcıya ait değil.';
  end if;

  if p_project_item_id is not null then
    perform 1
    from public.project_items project_item
    where project_item.id = p_project_item_id
      and project_item.user_id = actor_id
      and (p_project_id is null or project_item.project_id = p_project_id)
    for update;
    if not found then
      raise exception using errcode = '42501', message = 'Proje kalemi kullanıcıya ait değil.';
    end if;
  end if;

  if p_project_id is not null and not exists (
    select 1 from public.projects project where project.id = p_project_id and project.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'Proje kullanıcıya ait değil.';
  end if;

  if p_parent_item_id is not null and not exists (
    select 1 from public.project_items parent_item where parent_item.id = p_parent_item_id and parent_item.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'Üst proje kalemi kullanıcıya ait değil.';
  end if;

  if p_document_item_id is not null and not exists (
    select 1 from public.document_items document_item where document_item.id = p_document_item_id and document_item.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'Belge kalemi kullanıcıya ait değil.';
  end if;

  if p_partner_id is not null and not exists (
    select 1 from public.suppliers partner where partner.id = p_partner_id and partner.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'İş ortağı kullanıcıya ait değil.';
  end if;

  if p_report_id is not null and not exists (
    select 1 from public.reports report where report.id = p_report_id and report.user_id = actor_id
  ) then
    raise exception using errcode = '42501', message = 'Rapor kullanıcıya ait değil.';
  end if;

  select receipt.id
  into duplicate_receipt_id
  from public.order_receipts receipt
  where receipt.user_id = actor_id
    and receipt.order_id = p_order_id
    and coalesce(receipt.project_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_project_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(receipt.product_code, '') = coalesce(p_product_code, '')
    and coalesce(receipt.accepted_quantity, 0) = safe_accepted
    and coalesce(receipt.received_quantity, 0) = safe_received
    and coalesce(receipt.receipt_date, current_date) = coalesce(p_receipt_date, current_date)
    and coalesce(receipt.note, '') = coalesce(p_note, '')
    and coalesce(receipt.received_by, '') = coalesce(p_received_by, '')
  order by receipt.created_at desc
  limit 1;

  if duplicate_receipt_id is not null then
    return duplicate_receipt_id;
  end if;

  select coalesce(sum(receipt.accepted_quantity), 0)
  into already_accepted
  from public.order_receipts receipt
  where receipt.user_id = actor_id
    and receipt.order_id = p_order_id
    and (
      (p_project_item_id is not null and receipt.project_item_id = p_project_item_id)
      or (
        p_project_item_id is null
        and coalesce(receipt.product_code, '') = coalesce(p_product_code, '')
        and coalesce(receipt.product_name, '') = coalesce(p_product_name, '')
      )
    );

  remaining_quantity := safe_ordered - already_accepted;

  if safe_accepted > remaining_quantity then
    raise exception using
      errcode = '22023',
      message = format('Teslim miktarı kalan sipariş miktarını aşamaz. Kalan miktar: %s.', greatest(remaining_quantity, 0));
  end if;

  insert into public.order_receipts (
    user_id, order_id, project_id, project_item_id, parent_item_id, document_item_id,
    order_no, supplier_name, partner_id, partner_name, partner_type,
    product_code, product_name, unit, ordered_quantity, received_quantity,
    accepted_quantity, missing_quantity, excess_quantity, defective_quantity,
    receipt_status, received_by, receipt_date, note
  ) values (
    actor_id, p_order_id, p_project_id, p_project_item_id, p_parent_item_id, p_document_item_id,
    coalesce(p_order_no, ''), coalesce(p_supplier_name, ''), p_partner_id,
    coalesce(p_partner_name, ''), coalesce(p_partner_type, 'Tedarikçi'),
    coalesce(p_product_code, ''), coalesce(p_product_name, ''), coalesce(p_unit, 'adet'),
    safe_ordered, greatest(safe_received, 0),
    safe_accepted, greatest(coalesce(p_missing_quantity, 0), 0),
    greatest(coalesce(p_excess_quantity, 0), 0), greatest(coalesce(p_defective_quantity, 0), 0),
    coalesce(p_receipt_status, 'Depoda'), coalesce(p_received_by, ''),
    coalesce(p_receipt_date, current_date), coalesce(p_note, '')
  )
  returning id into receipt_id;

  update public.products product
  set
    current_stock = coalesce(product.current_stock, 0) + safe_accepted,
    last_supplier = coalesce(nullif(p_partner_name, ''), nullif(p_supplier_name, ''), product.last_supplier),
    last_unit_price = coalesce(p_unit_price, 0),
    last_currency = coalesce(nullif(p_currency, ''), 'TRY'),
    last_purchase_date = coalesce(p_receipt_date, current_date),
    last_movement_at = now(),
    updated_at = now()
  where product.id = p_product_id and product.user_id = actor_id;

  insert into public.stock_movements (
    user_id, product_id, product_code, product_name, movement_type, quantity, unit,
    supplier_name, partner_id, partner_name, partner_type, order_id, report_id,
    project_id, project_item_id, parent_item_id, receipt_id, unit_price, currency,
    movement_date, source, notes
  ) values (
    actor_id, p_product_id, coalesce(p_product_code, ''), coalesce(p_product_name, ''),
    'in', safe_accepted, coalesce(p_unit, 'adet'), coalesce(p_supplier_name, ''),
    p_partner_id, coalesce(p_partner_name, ''), coalesce(p_partner_type, 'Tedarikçi'),
    p_order_id, p_report_id, p_project_id, p_project_item_id, p_parent_item_id,
    receipt_id, coalesce(p_unit_price, 0), coalesce(nullif(p_currency, ''), 'TRY'),
    coalesce(p_receipt_date, current_date), 'Depo teslim alma',
    concat_ws(' - ', nullif(p_order_no, ''), nullif(p_receipt_status, ''))
  );

  if p_project_item_id is not null then
    update public.project_items project_item
    set
      received_quantity = coalesce(project_item.received_quantity, 0) + safe_accepted,
      defective_quantity = coalesce(project_item.defective_quantity, 0) + greatest(coalesce(p_defective_quantity, 0), 0),
      status = coalesce(p_receipt_status, project_item.status),
      updated_at = now()
    where project_item.id = p_project_item_id and project_item.user_id = actor_id;
  end if;

  if p_order_items is not null or p_order_status is not null or p_status_history is not null or p_order_receipt_status is not null then
    update public.orders target_order
    set
      items = coalesce(p_order_items, target_order.items),
      status = coalesce(p_order_status, target_order.status),
      delivery_date = case when p_order_status is not null then p_delivery_date else target_order.delivery_date end,
      status_history = coalesce(p_status_history, target_order.status_history),
      receipt_status = coalesce(p_order_receipt_status, target_order.receipt_status),
      received_total = coalesce(p_received_total, target_order.received_total),
      defective_total = coalesce(p_defective_total, target_order.defective_total),
      updated_at = now()
    where target_order.id = p_order_id and target_order.user_id = actor_id;
  end if;

  return receipt_id;
end;
$$;

revoke all on function public.record_order_stock_receipt(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, text, text,
  text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, date,
  text, numeric, text, uuid, jsonb, text, date, jsonb, text, numeric, numeric
) from public;

grant execute on function public.record_order_stock_receipt(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, text, text,
  text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, date,
  text, numeric, text, uuid, jsonb, text, date, jsonb, text, numeric, numeric
) to authenticated;

notify pgrst, 'reload schema';

commit;
