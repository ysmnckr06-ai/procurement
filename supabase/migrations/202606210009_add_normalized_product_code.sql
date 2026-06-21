begin;

alter table public.products
add column if not exists normalized_product_code text;

update public.products
set normalized_product_code = nullif(upper(btrim(product_code)), '')
where normalized_product_code is distinct from nullif(upper(btrim(product_code)), '');

do $$
declare
  duplicate_report text;
begin
  select string_agg(
    format(
      'user_id=%s normalized_product_code=%s count=%s product_ids=%s',
      duplicate_group.user_id,
      duplicate_group.normalized_product_code,
      duplicate_group.product_count,
      duplicate_group.product_ids
    ),
    E'\n'
    order by duplicate_group.user_id, duplicate_group.normalized_product_code
  )
  into duplicate_report
  from (
    select
      product.user_id,
      product.normalized_product_code,
      count(*) as product_count,
      string_agg(product.id::text, ',' order by product.created_at, product.id) as product_ids
    from public.products product
    where product.normalized_product_code is not null
    group by product.user_id, product.normalized_product_code
    having count(*) > 1
  ) duplicate_group;

  if duplicate_report is not null then
    raise exception using
      errcode = '23505',
      message = 'Tenant icinde normalize urun kodu mukerrerleri bulundu. Migration veri silmeden durduruldu.',
      detail = duplicate_report,
      hint = 'Ayni user_id icindeki urunleri inceleyin; farkli user_id kayitlarini birlestirmeyin.';
  end if;
end
$$;

create or replace function public.set_product_normalized_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.normalized_product_code := nullif(upper(btrim(new.product_code)), '');
  return new;
end;
$$;

drop trigger if exists products_set_normalized_code on public.products;
create trigger products_set_normalized_code
before insert or update of product_code, normalized_product_code
on public.products
for each row
execute function public.set_product_normalized_code();

create unique index if not exists products_user_normalized_code_uidx
on public.products (user_id, normalized_product_code)
where normalized_product_code is not null;

commit;
