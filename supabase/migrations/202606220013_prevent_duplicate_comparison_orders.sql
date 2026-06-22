begin;

do $$
declare
  duplicate_group_count bigint;
begin
  if to_regclass('public.orders') is null then
    raise exception 'public.orders bulunamadi; temel schema uygulanmalidir';
  end if;

  select count(*)
  into duplicate_group_count
  from (
    select
      user_id,
      report_id,
      lower(btrim(coalesce(nullif(partner_name, ''), supplier_name, ''))) as supplier_key,
      upper(btrim(coalesce(currency, 'TRY'))) as currency_key,
      coalesce(exchange_rate, 1) as exchange_rate_key
    from public.orders
    where report_id is not null
    group by
      user_id,
      report_id,
      lower(btrim(coalesce(nullif(partner_name, ''), supplier_name, ''))),
      upper(btrim(coalesce(currency, 'TRY'))),
      coalesce(exchange_rate, 1)
    having count(*) > 1
  ) duplicate_groups;

  if duplicate_group_count > 0 then
    raise exception
      'orders icinde ayni rapor/tedarikci/para birimi/kur icin % mukerrer grup var; unique index olusturulmadi ve veri degistirilmedi',
      duplicate_group_count;
  end if;
end;
$$;

create unique index if not exists orders_comparison_group_unique_idx
on public.orders (
  user_id,
  report_id,
  lower(btrim(coalesce(nullif(partner_name, ''), supplier_name, ''))),
  upper(btrim(coalesce(currency, 'TRY'))),
  coalesce(exchange_rate, 1)
)
where report_id is not null;

comment on index public.orders_comparison_group_unique_idx is
  'Ayni mukayese raporundaki tedarikci + para birimi + kur grubu icin ikinci siparisi atomik olarak engeller.';

commit;
