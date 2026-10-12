begin;

-- 1) Süresi dolmuş deneme/lisans ile veriye doğrudan erişimi kapat.
--    Mevcut "kendi kaydını gör" politikalarına ek olarak RESTRICTIVE bir politika
--    eklenir: her iki koşul da sağlanmadan satır okunamaz/yazılamaz.
--    Destek tabloları, şirket ayarları ve lisans tablosu bilinçli olarak hariç
--    tutulur; lisansı biten kullanıcı destekle iletişim kurabilmeli ve lisans
--    durumunu görebilmelidir.
do $$
declare
  target_table text;
  target_tables text[] := array[
    'products',
    'stock_movements',
    'stock_import_entries',
    'projects',
    'project_items',
    'project_payments',
    'project_expenses',
    'project_revisions',
    'requests',
    'offers',
    'reports',
    'orders',
    'order_receipts',
    'order_payments',
    'order_audit_log',
    'suppliers',
    'documents',
    'document_items',
    'document_links',
    'document_audit_log'
  ];
begin
  foreach target_table in array target_tables loop
    if to_regclass('public.' || target_table) is null then
      continue;
    end if;

    execute format(
      'drop policy if exists "Active license required" on public.%I',
      target_table
    );
    execute format(
      'create policy "Active license required" on public.%I '
      'as restrictive for all to authenticated '
      'using ((select public.has_active_license())) '
      'with check ((select public.has_active_license()))',
      target_table
    );
  end loop;
end
$$;

-- 2) SECURITY DEFINER fonksiyonlar içeride auth.uid() kontrolü yapıyor; yine de
--    giriş yapmamış (anon) rolün bunları çağırabilmesine gerek yok.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke execute on function %s from anon', fn);
  end loop;
end
$$;

-- 3) Belge depolama alanlarına boyut ve tür sınırı.
--    text/html ve image/svg+xml gibi tarayıcıda çalışabilen türler kabul edilmez.
update storage.buckets
set
  file_size_limit = 26214400, -- 25 MB
  allowed_mime_types = array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/octet-stream'
  ]
where id in ('order-documents', 'request-reports');

commit;
