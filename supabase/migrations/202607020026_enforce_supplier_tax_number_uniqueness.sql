begin;

-- Aynı kullanıcı altında aynı vergi numarasına sahip ikinci iş ortağı açılmasını engeller.
-- tax_number ve eski tax_no alanları aynı kural altında normalize edilir; boş vergi no kapsam dışıdır.
do $$
declare
  duplicate_count integer;
begin
  select count(*) into duplicate_count
  from (
    select
      user_id,
      regexp_replace(coalesce(nullif(tax_number, ''), tax_no, ''), '\D', '', 'g') as normalized_tax_number
    from public.suppliers
    where regexp_replace(coalesce(nullif(tax_number, ''), tax_no, ''), '\D', '', 'g') <> ''
    group by user_id, regexp_replace(coalesce(nullif(tax_number, ''), tax_no, ''), '\D', '', 'g')
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    raise exception
      'suppliers icinde ayni kullanici ve vergi numarasi icin % mukerrer grup var; once mukerrer is ortaklari birlestirilmelidir',
      duplicate_count;
  end if;
end $$;

create unique index if not exists suppliers_user_tax_number_unique_idx
on public.suppliers (
  user_id,
  regexp_replace(coalesce(nullif(tax_number, ''), tax_no, ''), '\D', '', 'g')
)
where regexp_replace(coalesce(nullif(tax_number, ''), tax_no, ''), '\D', '', 'g') <> '';

commit;
