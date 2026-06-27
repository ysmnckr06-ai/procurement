# Corvian v1.0 Production Backup Checklist

Release öncesi bu liste manuel olarak tamamlanmadan production deploy yapılmamalıdır.

## Supabase Database

- [ ] Supabase Dashboard > Database > Backups ekranında son otomatik backup zamanı kontrol edildi.
- [ ] Manual backup veya PITR restore noktası release öncesi oluşturuldu.
- [ ] Backup timestamp kaydedildi.
- [ ] Restore hedefi ve restore yöntemi doğrulandı.
- [ ] `projects`, `project_items`, `suppliers`, `products`, `orders`, `requests`, `offers`, `reports`, `stock_movements`, `documents` tabloları backup kapsamına dahil.
- [ ] `auth.users` kullanıcı datasının restore stratejisi doğrulandı.
- [ ] Storage bucket dosyaları için ayrıca export/snapshot planı doğrulandı.

## Storage

- [ ] `request-reports` bucket private durumda.
- [ ] `order-documents` bucket private durumda.
- [ ] Kritik PDF/Excel dosyaları için bucket-level backup veya external copy planı var.

## Rollback Evidence

- [ ] Son uygulanan migration listesi kaydedildi.
- [ ] Sprint 1 migration rollback SQL'i hazır.
- [ ] QA/test cleanup arşiv dosyaları saklandı:
  - `qa-files/rc1-qa-cleanup-archive-*.json`
  - `qa-files/rc1-smoke-cleanup-archive-*.json`
- [ ] Rollback sorumlusu ve karar eşiği belirlendi.

## Go / No-Go

- Backup doğrulanmadan release kararı: **NO-GO**
- Backup doğrulandıktan sonra beklenen rollback süresi: 30-90 dakika
- Storage restore gerekiyorsa beklenen süre: veri hacmine bağlı olarak ayrıca ölçülmeli
