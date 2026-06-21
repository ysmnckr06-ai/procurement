-- READ-ONLY PREFLIGHT / POSTFLIGHT: 008 migrationi oncesi ve sonrasi calistirilabilir.

-- 1) RPC'nin ihtiyac duydugu kolonlar.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'stock_movements' and column_name in (
      'id', 'user_id', 'product_id', 'project_item_id', 'movement_type',
      'quantity', 'reserved_quantity', 'issued_to_production_quantity',
      'source', 'notes'
    ))
    or (table_name = 'products' and column_name in (
      'id', 'user_id', 'current_stock', 'reserved_stock', 'updated_at'
    ))
    or (table_name = 'project_items' and column_name in (
      'id', 'user_id', 'estimated_quantity', 'received_quantity',
      'reserved_quantity', 'status', 'updated_at'
    ))
  )
order by table_name, column_name;

-- 2) movement_type dagilimi. Beklenen degerler yalnizca in/out.
select movement_type, count(*) as movement_count
from public.stock_movements
group by movement_type
order by movement_type;

-- 3) Source ve RPC siniflandirma dagilimi.
with classified as (
  select
    movement.*,
    lower(btrim(coalesce(movement.source, ''))) as normalized_source,
    case
      when movement.movement_type in ('in', 'out')
        and lower(btrim(coalesce(movement.source, ''))) like 'depo sayımı / toplu excel aktarımı%'
        then 'inventory_adjustment'
      when movement.movement_type = 'out'
        and lower(btrim(coalesce(movement.source, ''))) like 'ana kalem tamamlanan miktar kaydı%'
        and coalesce(movement.issued_to_production_quantity, 0) > 0
        then 'production_consumption'
      when movement.movement_type = 'out'
        and lower(btrim(coalesce(movement.source, ''))) like 'projeye stoktan karşılandı%'
        and coalesce(movement.issued_to_production_quantity, 0) = 0
        and coalesce(movement.reserved_quantity, 0) > 0
        then 'reservation'
      when movement.movement_type = 'out'
        and coalesce(movement.issued_to_production_quantity, 0) = 0
        and coalesce(movement.reserved_quantity, 0) = 0
        and (
          lower(btrim(coalesce(movement.source, ''))) like 'stok çıkışı%'
          or lower(btrim(coalesce(movement.source, ''))) like 'manuel stok çıkışı%'
          or lower(btrim(coalesce(movement.source, ''))) like '%sevk%'
          or lower(btrim(coalesce(movement.source, ''))) like '%fire%'
          or lower(btrim(coalesce(movement.source, ''))) like '%hatalı%'
          or lower(btrim(coalesce(movement.source, ''))) like '%iade%'
          or lower(btrim(coalesce(movement.source, ''))) like '%montaj%'
        )
        then 'normal_out'
      when movement.movement_type = 'in'
        and (
          lower(btrim(coalesce(movement.source, ''))) like 'depo teslim alma%'
          or lower(btrim(coalesce(movement.source, ''))) like 'sipariş teslimatı%'
          or lower(btrim(coalesce(movement.source, ''))) like 'proje teklifinden stok aktarımı%'
          or lower(btrim(coalesce(movement.source, ''))) like 'proje dosyasından ürün kartı oluşturuldu%'
        )
        then 'in'
      else 'unknown'
    end as movement_class
  from public.stock_movements movement
)
select
  movement_type,
  source,
  movement_class,
  count(*) as movement_count,
  sum(quantity) as total_quantity,
  sum(coalesce(reserved_quantity, 0)) as total_reserved_quantity,
  sum(coalesce(issued_to_production_quantity, 0)) as total_production_quantity
from classified
group by movement_type, source, movement_class
order by movement_class, movement_type, source;

-- 4) Fail-closed nedeniyle silinemeyecek bilinmeyen/riskli hareketler.
with classified as (
  select
    movement.*,
    case
      when movement.movement_type in ('in', 'out')
        and lower(btrim(coalesce(movement.source, ''))) like 'depo sayımı / toplu excel aktarımı%'
        then 'inventory_adjustment'
      when movement.movement_type = 'out'
        and lower(btrim(coalesce(movement.source, ''))) like 'ana kalem tamamlanan miktar kaydı%'
        and coalesce(movement.issued_to_production_quantity, 0) > 0
        then 'production_consumption'
      when movement.movement_type = 'out'
        and lower(btrim(coalesce(movement.source, ''))) like 'projeye stoktan karşılandı%'
        and coalesce(movement.issued_to_production_quantity, 0) = 0
        and coalesce(movement.reserved_quantity, 0) > 0
        then 'reservation'
      when movement.movement_type = 'out'
        and coalesce(movement.issued_to_production_quantity, 0) = 0
        and coalesce(movement.reserved_quantity, 0) = 0
        and (
          lower(btrim(coalesce(movement.source, ''))) like 'stok çıkışı%'
          or lower(btrim(coalesce(movement.source, ''))) like 'manuel stok çıkışı%'
          or lower(btrim(coalesce(movement.source, ''))) like '%sevk%'
          or lower(btrim(coalesce(movement.source, ''))) like '%fire%'
          or lower(btrim(coalesce(movement.source, ''))) like '%hatalı%'
          or lower(btrim(coalesce(movement.source, ''))) like '%iade%'
          or lower(btrim(coalesce(movement.source, ''))) like '%montaj%'
        )
        then 'normal_out'
      when movement.movement_type = 'in'
        and (
          lower(btrim(coalesce(movement.source, ''))) like 'depo teslim alma%'
          or lower(btrim(coalesce(movement.source, ''))) like 'sipariş teslimatı%'
          or lower(btrim(coalesce(movement.source, ''))) like 'proje teklifinden stok aktarımı%'
          or lower(btrim(coalesce(movement.source, ''))) like 'proje dosyasından ürün kartı oluşturuldu%'
        )
        then 'in'
      else 'unknown'
    end as movement_class
  from public.stock_movements movement
)
select
  id, user_id, product_id, project_item_id, movement_type, quantity,
  reserved_quantity, issued_to_production_quantity, source, notes
from classified
where movement_class = 'unknown'
order by created_at desc;

-- 5) Production/tuketim hareketleri ozet ve detay.
select
  count(*) as production_movement_count,
  sum(quantity) as total_quantity,
  sum(coalesce(reserved_quantity, 0)) as total_reserved_to_restore
from public.stock_movements
where movement_type = 'out'
  and lower(btrim(coalesce(source, ''))) like 'ana kalem tamamlanan miktar kaydı%'
  and coalesce(issued_to_production_quantity, 0) > 0;

-- 6) Cross-tenant veya orphan baglantilar. Beklenen: sifir satir.
select
  movement.id,
  movement.user_id as movement_user_id,
  product.user_id as product_user_id,
  project_item.user_id as project_item_user_id
from public.stock_movements movement
left join public.products product on product.id = movement.product_id
left join public.project_items project_item on project_item.id = movement.project_item_id
where (
    movement.product_id is not null
    and (product.id is null or product.user_id::text is distinct from movement.user_id::text)
  )
  or (
    movement.project_item_id is not null
    and (project_item.id is null or project_item.user_id::text is distinct from movement.user_id::text)
  );

-- 7) Sayaç bütünlüğü. Beklenen: sifir satir.
select 'products' as source_table, id, user_id
from public.products
where coalesce(current_stock, 0) < 0 or coalesce(reserved_stock, 0) < 0
union all
select 'project_items' as source_table, id, user_id
from public.project_items
where coalesce(received_quantity, 0) < 0 or coalesce(reserved_quantity, 0) < 0;

-- 8) Bilinen hareketlerde terslemeyi engelleyecek yetersiz sayaçlar.
-- Satir donerse ilgili hareket fail-closed durur; veri degismez.
select
  movement.id,
  movement.movement_type,
  movement.source,
  movement.quantity,
  movement.reserved_quantity,
  product.current_stock,
  product.reserved_stock,
  project_item.received_quantity,
  project_item.reserved_quantity,
  case
    when movement.movement_type = 'in'
      and coalesce(product.current_stock, 0) < coalesce(movement.quantity, 0)
      then 'insufficient_product_current_stock'
    when movement.movement_type = 'in'
      and movement.project_item_id is not null
      and coalesce(project_item.received_quantity, 0) < coalesce(movement.quantity, 0)
      then 'insufficient_project_received_quantity'
    when movement.movement_type = 'out'
      and lower(btrim(coalesce(movement.source, ''))) like 'projeye stoktan karşılandı%'
      and coalesce(product.reserved_stock, 0) < coalesce(movement.reserved_quantity, movement.quantity, 0)
      then 'insufficient_product_reserved_stock'
    when movement.movement_type = 'out'
      and lower(btrim(coalesce(movement.source, ''))) like 'projeye stoktan karşılandı%'
      and movement.project_item_id is not null
      and coalesce(project_item.reserved_quantity, 0) < coalesce(movement.reserved_quantity, movement.quantity, 0)
      then 'insufficient_project_reserved_quantity'
    when movement.movement_type = 'out'
      and lower(btrim(coalesce(movement.source, ''))) like 'ana kalem tamamlanan miktar kaydı%'
      and movement.project_item_id is not null
      and coalesce(project_item.received_quantity, 0) < coalesce(movement.quantity, 0)
      then 'insufficient_project_consumed_quantity'
  end as blocker
from public.stock_movements movement
left join public.products product on product.id = movement.product_id
left join public.project_items project_item on project_item.id = movement.project_item_id
where (
    movement.movement_type = 'in'
    and (
      coalesce(product.current_stock, 0) < coalesce(movement.quantity, 0)
      or (
        movement.project_item_id is not null
        and coalesce(project_item.received_quantity, 0) < coalesce(movement.quantity, 0)
      )
    )
  )
  or (
    movement.movement_type = 'out'
    and lower(btrim(coalesce(movement.source, ''))) like 'projeye stoktan karşılandı%'
    and (
      coalesce(product.reserved_stock, 0) < coalesce(movement.reserved_quantity, movement.quantity, 0)
      or (
        movement.project_item_id is not null
        and coalesce(project_item.reserved_quantity, 0) < coalesce(movement.reserved_quantity, movement.quantity, 0)
      )
    )
  )
  or (
    movement.movement_type = 'out'
    and lower(btrim(coalesce(movement.source, ''))) like 'ana kalem tamamlanan miktar kaydı%'
    and movement.project_item_id is not null
    and coalesce(project_item.received_quantity, 0) < coalesce(movement.quantity, 0)
  );

-- 9) Depo sayimi geri almayi belirsiz yapan yinelenen urun kartlari.
-- Satir donerse bu urunlere ait inventory_adjustment hareketleri fail-closed durur.
select
  first_product.user_id,
  lower(btrim(coalesce(first_product.product_code, ''))) as normalized_product_code,
  lower(btrim(coalesce(first_product.product_name, ''))) as normalized_product_name,
  count(*) as duplicate_count,
  array_agg(first_product.id order by first_product.id) as product_ids
from public.products first_product
group by
  first_product.user_id,
  lower(btrim(coalesce(first_product.product_code, ''))),
  lower(btrim(coalesce(first_product.product_name, '')))
having count(*) > 1
order by duplicate_count desc;

-- 10) POSTFLIGHT: RPC tanimi ve yetkisi.
select
  routine_schema,
  routine_name,
  security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'delete_stock_movement_with_reversal';

select
  has_function_privilege(
    'authenticated',
    'public.delete_stock_movement_with_reversal(uuid)',
    'EXECUTE'
  ) as authenticated_can_execute,
  has_function_privilege(
    'anon',
    'public.delete_stock_movement_with_reversal(uuid)',
    'EXECUTE'
  ) as anon_can_execute;

-- 11) POSTFLIGHT: Fonksiyon govdesinin canli tanimi.
select pg_get_functiondef(
  'public.delete_stock_movement_with_reversal(uuid)'::regprocedure
);
