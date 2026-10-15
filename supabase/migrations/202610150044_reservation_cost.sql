-- Stoktan projeye ayrılan malzemenin maliyeti teklif/BOM fiyatıyla değil gerçek
-- alış fiyatıyla hesaplanmalı. reserve_project_items_from_stock, ayırma hareketine
-- ürünün o anki son alış fiyatını (yoksa elle girilen fiyatı) ve para birimini yazar.
-- Canlıdaki fonksiyon sürümü dosyadakinden farklı olabildiği için yerinde yamalanır.
do $patch$
declare
  definition text := pg_get_functiondef('public.reserve_project_items_from_stock(jsonb)'::regprocedure);
  patched text;
begin
  if position('last_unit_price' in definition) > 0 then
    return;
  end if;
  patched := regexp_replace(
    definition,
    'movement_date,\s*source,\s*notes(\s*)\)',
    'movement_date, source, notes, unit_price, currency\1)'
  );
  patched := regexp_replace(
    patched,
    '''Çok projeli stok icmalinden ayrıldı''\)(\s*)\);',
    '''Çok projeli stok icmalinden ayrıldı''),
      nullif(coalesce(nullif(product_row.last_unit_price, 0), nullif(product_row.manual_unit_price, 0)), 0),
      coalesce(nullif(product_row.last_currency, ''''), ''TRY'')\1);'
  );
  if patched = definition or position('unit_price, currency' in patched) = 0 or position('last_unit_price' in patched) = 0 then
    raise exception 'reserve_project_items_from_stock yamalanamadı; beklenen metin bulunamadı.';
  end if;
  execute patched;
end
$patch$;
