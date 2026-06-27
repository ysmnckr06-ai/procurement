# Corvian ERP v1.0 Release Notes

## Özet

Corvian ERP v1.0; satınalma, proje, stok, teklif mukayesesi, sipariş, teslim alma, OCR belge analizi, finans ve AI destekli read-only analiz akışlarını demo/pilot müşteri kullanımına hazır hale getiren ilk release candidate kapsamıdır.

## Öne Çıkanlar

- Sipariş teslim alma RPC tarafında atomik ve idempotent hale getirildi.
- Negatif, sıfır ve fazla teslim senaryoları reddediliyor.
- Ürün stokları, proje kalemi teslim miktarları, sipariş satır durumları ve stok hareketleri aynı transaction içinde güncelleniyor.
- Supplier duplicate kontrolü DB seviyesinde normalize isim unique index ile güçlendirildi.
- Kur değerleri için pozitif değer zorunluluğu getirildi.
- Teklif upload doğrulamaları yanlış/boş dosyalara karşı güçlendirildi.
- AI Asistan read-only davranışı korundu.
- Requests/reports/orders/offers tenant izolasyonu uuid-safe RLS ile doğrulandı.
- QA/demo/test verileri RC1 öncesi arşivlenerek temizlendi.

## Release Hardening

- Frontend debug `console.log` çıktıları kaldırıldı.
- Backend/parser ham debug çıktıları production stdout yerine debug logger seviyesine indirildi.
- Runtime riski taşıyan bazı lint bulguları düzeltildi.
- Büyük liste ve dashboard performans riskleri analiz edildi.
- Production backup ve environment checklistleri oluşturuldu.

## Bilinen Riskler

- Lint tamamen sıfır değil; kalanların önemli kısmı formatting, import order, a11y ve hook dependency refactor borcudur.
- Büyük tenantlarda dashboard/proje detay/stok ekranları için ek pagination ve aggregation çalışması önerilir.
- OCR ve AI işlemleri için production timeout/queue stratejisi release sonrası izlenmelidir.

## Upgrade / Deploy Notları

- Sprint 1 DB migrationları production Supabase üzerinde uygulanmış olmalıdır.
- Release öncesi production backup checklist tamamlanmalıdır.
- Vercel/Railway/Supabase environment checklist production dashboardlarında doğrulanmalıdır.
- Service role key frontend ortamına tanımlanmamalıdır.
