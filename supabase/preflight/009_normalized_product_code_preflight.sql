-- READ-ONLY PREFLIGHT: migration 009 uygulanmadan once calistirin.

-- Tenant icinde normalize edilince cakisan kodlar. Bu sorgu satir dondurursa NO-GO.
select
  product.user_id,
  nullif(upper(btrim(product.product_code)), '') as normalized_product_code,
  count(*) as product_count,
  array_agg(product.id order by product.created_at, product.id) as product_ids,
  array_agg(product.product_code order by product.created_at, product.id) as code_variants
from public.products product
where nullif(upper(btrim(product.product_code)), '') is not null
group by product.user_id, nullif(upper(btrim(product.product_code)), '')
having count(*) > 1
order by product.user_id, normalized_product_code;

-- Farkli tenant'lar arasindaki ayni kodlar bilgi amaclidir; mukerrer sayilmaz ve birlestirilmez.
select
  nullif(upper(btrim(product.product_code)), '') as normalized_product_code,
  count(*) as product_count,
  count(distinct product.user_id) as tenant_count
from public.products product
where nullif(upper(btrim(product.product_code)), '') is not null
group by nullif(upper(btrim(product.product_code)), '')
having count(*) > 1
order by product_count desc, normalized_product_code;
