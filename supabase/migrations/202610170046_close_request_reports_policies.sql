begin;

-- Supabase panelinden elle eklenmiş üç politika, request-reports alanındaki TÜM
-- dosyaları giriş yapmış her kullanıcıya okunur/güncellenir yapıyordu (yalnız
-- bucket_id kontrolü). Başka firmanın talep/mukayese raporları görülebiliyordu.
-- Sunucu bu alana service role ile yazar; kullanıcı erişimi klasör sahipliği
-- kontrol eden "Users can ... own request reports" politikalarıyla kalır.
drop policy if exists "allow-request-reports-insert 7allz5_0" on storage.objects;
drop policy if exists "allow-request-reports-update 7allz5_0" on storage.objects;
drop policy if exists "allow-request-reports-update 7allz5_1" on storage.objects;

commit;
