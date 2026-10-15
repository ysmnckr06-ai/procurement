begin;

-- Canlı veritabanında belge türü kısıtı yalnız teklif/irsaliye/fatura/odeme/diger
-- kabul ediyordu (0036 hiç uygulanmamıştı): proje kaynak dosyaları, teslim
-- fişleri, sipariş formları ve projeye eklenen çizim/sözleşme belgeleri
-- kaydedilemiyordu. Kod ve tablodaki tüm türleri kapsayan kısıt kurulur.
do $$
declare
  allowed_types text[];
begin
  select array_agg(distinct value order by value)
  into allowed_types
  from (
    select unnest(array[
      'fatura', 'e_fatura', 'e_arsiv', 'irsaliye', 'e_irsaliye', 'teslim_fisi', 'depo_giris',
      'teklif', 'proje', 'malzeme_listesi', 'cizim', 'siparis', 'siparis_formu', 'sozlesme', 'odeme', 'diger'
    ]) as value
    union
    select distinct document_type from public.documents where document_type is not null
  ) types;

  alter table public.documents drop constraint if exists documents_document_type_check;
  execute format(
    'alter table public.documents add constraint documents_document_type_check check (document_type = any (%L::text[]))',
    allowed_types
  );
end
$$;

commit;
