begin;

-- Talep numarasi artik ekrandaki siradan degil, kaydin kendisinden gelir.
alter table public.requests add column if not exists request_number text;

with current_max as (
  select
    user_id,
    coalesce(
      max(
        case
          when request_number ~ '^TLB-[0-9]+$'
            then substring(request_number from 5)::bigint
          else null
        end
      ),
      0
    ) as max_no
  from public.requests
  group by user_id
),
numbered as (
  select
    request_row.id,
    current_max.max_no + row_number() over (
      partition by request_row.user_id
      order by request_row.created_at, request_row.id
    ) as sequence_no
  from public.requests request_row
  join current_max on current_max.user_id = request_row.user_id
  where request_row.request_number is null or btrim(request_row.request_number) = ''
)
update public.requests request_row
set request_number = 'TLB-' || lpad(numbered.sequence_no::text, 5, '0')
from numbered
where request_row.id = numbered.id;

create unique index if not exists requests_user_request_number_unique_idx
  on public.requests(user_id, request_number)
  where request_number is not null;

create or replace function public.assign_request_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number bigint;
begin
  if new.request_number is not null and btrim(new.request_number) <> '' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(coalesce(new.user_id::text, ''), 0));
  select coalesce(max((regexp_match(request_number, '^TLB-([0-9]+)$'))[1]::bigint), 0) + 1
    into next_number
  from public.requests
  where user_id::text = new.user_id::text;

  new.request_number := 'TLB-' || lpad(next_number::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists assign_request_number on public.requests;
create trigger assign_request_number
before insert on public.requests
for each row execute function public.assign_request_number();

create or replace function public.protect_request_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.request_number is distinct from new.request_number then
    raise exception 'Talep numarası oluşturulduktan sonra değiştirilemez.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_request_number on public.requests;
create trigger protect_request_number
before update on public.requests
for each row execute function public.protect_request_number();

alter table public.reports
  add column if not exists source_request_id uuid,
  add column if not exists source_request_number text,
  add column if not exists source_request_title text,
  add column if not exists source_request_owner text,
  add column if not exists source_request_department text;

update public.reports report_row
set source_request_id = case
      when coalesce(report_row.items->0->>'sourceRequestId', '')
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (report_row.items->0->>'sourceRequestId')::uuid
      else null
    end,
    source_request_number = nullif(report_row.items->0->>'sourceRequestNumber', ''),
    source_request_title = nullif(report_row.items->0->>'sourceRequestTitle', ''),
    source_request_owner = nullif(report_row.items->0->>'requestOwner', ''),
    source_request_department = nullif(report_row.items->0->>'requestDepartment', '')
where report_row.source_request_id is null
   or report_row.source_request_number is null;

update public.reports report_row
set source_request_number = request_row.request_number,
    source_request_title = coalesce(report_row.source_request_title, request_row.ad)
from public.requests request_row
where request_row.id = report_row.source_request_id
  and (report_row.source_request_number is null or report_row.source_request_title is null);

update public.reports report_row
set source_request_id = null
where report_row.source_request_id is not null
  and not exists (
    select 1
    from public.requests request_row
    where request_row.id = report_row.source_request_id
      and request_row.user_id = report_row.user_id
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reports_source_request_id_fkey'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_source_request_id_fkey
      foreign key (source_request_id)
      references public.requests(id)
      on delete set null;
  end if;
end $$;

create index if not exists reports_source_request_id_idx on public.reports(source_request_id);
create index if not exists reports_user_source_request_number_idx
  on public.reports(user_id, source_request_number);

create or replace function public.populate_report_request_lineage()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  first_item jsonb := coalesce(new.items->0, '{}'::jsonb);
begin
  if new.source_request_id is null
     and coalesce(first_item->>'sourceRequestId', '')
       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    new.source_request_id := (first_item->>'sourceRequestId')::uuid;
  end if;
  new.source_request_number := coalesce(new.source_request_number, nullif(first_item->>'sourceRequestNumber', ''));
  new.source_request_title := coalesce(new.source_request_title, nullif(first_item->>'sourceRequestTitle', ''));
  new.source_request_owner := coalesce(new.source_request_owner, nullif(first_item->>'requestOwner', ''));
  new.source_request_department := coalesce(new.source_request_department, nullif(first_item->>'requestDepartment', ''));

  if new.source_request_id is not null then
    select request_row.request_number,
           request_row.ad
      into new.source_request_number, new.source_request_title
    from public.requests request_row
    where request_row.id = new.source_request_id;
  end if;
  return new;
end;
$$;

drop trigger if exists populate_report_request_lineage on public.reports;
create trigger populate_report_request_lineage
before insert or update of items, source_request_id, source_request_number on public.reports
for each row execute function public.populate_report_request_lineage();

-- Ticari siparis alanlari veritabaninda korunur; teslimat/odeme gibi operasyonel alanlar acik kalir.
create table if not exists public.order_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid,
  actor_email text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_audit_log_user_order_idx
  on public.order_audit_log(user_id, order_id, created_at desc);

create or replace function public.order_commercial_items(items_value jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(
    item - array[
      'deliveredQuantity','delivered_quantity','receivedQuantity','received_quantity',
      'acceptedQuantity','accepted_quantity','defectiveQuantity','defective_quantity',
      'missingQuantity','missing_quantity','excessQuantity','excess_quantity',
      'receiptStatus','receipt_status','deliveryStatus','delivery_status','status'
    ]::text[] order by ordinal
  ), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(items_value) = 'array' then items_value else '[]'::jsonb end)
       with ordinality as source(item, ordinal);
$$;

create or replace function public.order_commercial_payload(order_value jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'order_no', order_value->'order_no',
    'supplier_name', order_value->'supplier_name',
    'partner_id', order_value->'partner_id',
    'partner_name', order_value->'partner_name',
    'project_id', order_value->'project_id',
    'report_id', order_value->'report_id',
    'order_date', order_value->'order_date',
    'currency', order_value->'currency',
    'exchange_rate', order_value->'exchange_rate',
    'rate_locked', order_value->'rate_locked',
    'total_amount', order_value->'total_amount',
    'original_amount', order_value->'original_amount',
    'order_total', order_value->'order_total',
    'items', public.order_commercial_items(order_value->'items')
  );
$$;

create or replace function public.protect_order_commercial_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.report_id is not null or coalesce(old.status, '') <> 'Taslak' then
      raise exception 'Isleme alinmis veya mukayese kaynakli siparis silinemez; denetim izi korunmalidir.';
    end if;
    return old;
  end if;

  if (old.report_id is not null or coalesce(old.status, '') <> 'Taslak')
     and public.order_commercial_payload(to_jsonb(old))
       is distinct from public.order_commercial_payload(to_jsonb(new)) then
    raise exception 'Siparis ticari alanlari kilitlidir. Yalniz teslimat, belge, odeme ve durum islemleri yapilabilir.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_order_commercial_fields on public.orders;
create trigger protect_order_commercial_fields
before update or delete on public.orders
for each row execute function public.protect_order_commercial_fields();

create or replace function public.audit_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_user_id uuid := coalesce(new.user_id, old.user_id);
  row_order_id uuid := coalesce(new.id, old.id);
begin
  insert into public.order_audit_log(
    user_id, order_id, action, actor_id, actor_email, old_data, new_data
  ) values (
    row_user_id, row_order_id, lower(tg_op), auth.uid(), auth.jwt()->>'email',
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_order_change on public.orders;
create trigger audit_order_change
after insert or update or delete on public.orders
for each row execute function public.audit_order_change();

create or replace function public.prevent_audit_log_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Denetim kayitlari degistirilemez veya silinemez.';
end;
$$;

drop trigger if exists prevent_order_audit_log_mutation on public.order_audit_log;
create trigger prevent_order_audit_log_mutation
before update or delete on public.order_audit_log
for each row execute function public.prevent_audit_log_mutation();

alter table public.order_audit_log enable row level security;
drop policy if exists "Users can read own order audit log" on public.order_audit_log;
create policy "Users can read own order audit log" on public.order_audit_log
for select to authenticated using (auth.uid() = user_id);
revoke all on public.order_audit_log from anon, authenticated;
grant select on public.order_audit_log to authenticated;

-- UBL-TR'ye hazir e-belge kimligi, dogrulama sonucu ve degismez arsiv kaydi.
alter table public.documents
  add column if not exists document_profile text,
  add column if not exists document_uuid uuid,
  add column if not exists scenario_code text,
  add column if not exists ubl_version text default '2.1',
  add column if not exists customization_id text default 'TR1.2',
  add column if not exists issue_time time,
  add column if not exists tax_exclusive_amount numeric(18,4),
  add column if not exists tax_amount numeric(18,4),
  add column if not exists payable_amount numeric(18,4),
  add column if not exists gib_status text default 'not_validated',
  add column if not exists validation_errors jsonb default '[]'::jsonb,
  add column if not exists validated_at timestamptz,
  add column if not exists immutable_at timestamptz;

create unique index if not exists documents_user_document_uuid_unique_idx
  on public.documents(user_id, document_uuid)
  where document_uuid is not null;

create table if not exists public.document_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid,
  actor_email text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists document_audit_log_user_document_idx
  on public.document_audit_log(user_id, document_id, created_at desc);

create or replace function public.validate_and_protect_edocument()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  errors jsonb := '[]'::jsonb;
  is_edocument boolean;
  protected_old jsonb;
  protected_new jsonb;
begin
  if tg_op = 'DELETE' then
    if old.immutable_at is not null then
      raise exception 'Onaylanmis e-belge silinemez; yasal ve denetim arsivi korunmalidir.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.immutable_at is not null then
    protected_old := to_jsonb(old) - array['approval_note','ocr_status','ocr_text','ocr_result','ocr_confidence','ocr_processed_at','updated_at']::text[];
    protected_new := to_jsonb(new) - array['approval_note','ocr_status','ocr_text','ocr_result','ocr_confidence','ocr_processed_at','updated_at']::text[];
    if protected_old is distinct from protected_new then
      raise exception 'Onaylanmis e-belgenin kimlik, tutar veya dosya bilgileri degistirilemez.';
    end if;
  end if;

  is_edocument := new.document_type in ('fatura','e_fatura','e_arsiv','irsaliye','e_irsaliye');
  if is_edocument then
    if nullif(btrim(coalesce(new.document_number, '')), '') is null then
      errors := errors || jsonb_build_array('Belge numarasi eksik');
    end if;
    if new.document_date is null then errors := errors || jsonb_build_array('Belge tarihi eksik'); end if;
    if nullif(btrim(coalesce(new.supplier_tax_number, '')), '') is null then
      errors := errors || jsonb_build_array('Tedarikci VKN/TCKN eksik');
    end if;
    if new.document_uuid is null then errors := errors || jsonb_build_array('UBL belge UUID eksik'); end if;
    if nullif(btrim(coalesce(new.document_profile, '')), '') is null then
      errors := errors || jsonb_build_array('UBL-TR profil bilgisi eksik');
    end if;
    if nullif(btrim(coalesce(new.currency, '')), '') is null then
      errors := errors || jsonb_build_array('Para birimi eksik');
    end if;
    if new.payable_amount is not null and new.invoice_total is not null
       and abs(new.payable_amount - new.invoice_total) > 0.01 then
      errors := errors || jsonb_build_array('Odenecek tutar ile belge toplami uyusmuyor');
    end if;
  end if;

  new.validation_errors := errors;
  if is_edocument then
    new.gib_status := case when jsonb_array_length(errors) = 0 then 'validated' else 'needs_review' end;
    new.verification_status := case when jsonb_array_length(errors) = 0 then 'verified' else 'needs_review' end;
    new.validated_at := case when jsonb_array_length(errors) = 0 then now() else null end;
  end if;
  if new.approval_status = 'onaylandi' and jsonb_array_length(errors) = 0 then
    new.immutable_at := coalesce(new.immutable_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists validate_and_protect_edocument on public.documents;
create trigger validate_and_protect_edocument
before insert or update or delete on public.documents
for each row execute function public.validate_and_protect_edocument();

create or replace function public.audit_document_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.document_audit_log(
    user_id, document_id, action, actor_id, actor_email, old_data, new_data
  ) values (
    coalesce(new.user_id, old.user_id), coalesce(new.id, old.id), lower(tg_op),
    auth.uid(), auth.jwt()->>'email',
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_document_change on public.documents;
create trigger audit_document_change
after insert or update or delete on public.documents
for each row execute function public.audit_document_change();

drop trigger if exists prevent_document_audit_log_mutation on public.document_audit_log;
create trigger prevent_document_audit_log_mutation
before update or delete on public.document_audit_log
for each row execute function public.prevent_audit_log_mutation();

alter table public.document_audit_log enable row level security;
drop policy if exists "Users can read own document audit log" on public.document_audit_log;
create policy "Users can read own document audit log" on public.document_audit_log
for select to authenticated using (auth.uid() = user_id);
revoke all on public.document_audit_log from anon, authenticated;
grant select on public.document_audit_log to authenticated;

comment on column public.documents.gib_status is
  'Yerel UBL-TR kayit dogrulama durumu; GIB veya ozel entegrator iletim onayi degildir.';

notify pgrst, 'reload schema';
commit;
