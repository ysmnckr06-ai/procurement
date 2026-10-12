begin;

-- Proje dosyaları "proje", mukayese kaynak teklifleri "teklif" belge türüyle
-- kaydediliyor; ancak veritabanındaki documents_document_type_check kısıtı
-- bu türleri kabul etmediği için proje dosyaları belge arşivine
-- kaydedilemiyordu. Kısıt, kodun kullandığı tüm türleri ve tabloda zaten
-- bulunan türleri kapsayacak şekilde yeniden kurulur.
do $$
declare
  allowed_types text[];
begin
  select array_agg(distinct value order by value)
  into allowed_types
  from (
    select unnest(array[
      'fatura', 'e_fatura', 'e_arsiv', 'irsaliye', 'e_irsaliye',
      'teklif', 'proje', 'siparis', 'sozlesme', 'diger'
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
