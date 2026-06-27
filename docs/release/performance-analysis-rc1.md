# Corvian v1.0 RC1 Performance Analysis

## Durum

RC1 öncesi büyük liste ve dashboard sorguları incelendi. Demo/pilot ölçeği için kritik blokaj görülmedi; 1000 kullanıcı veya yüksek hacimli tenant için bazı alanlarda pagination/aggregation çalışması gerekir.

## Bulgular

| Alan | Mevcut durum | Risk | Öneri |
| --- | --- | --- | --- |
| Dashboard | Tenant bazlı birçok tabloyu aynı anda okuyor | Orta | Özet metrikler için view/RPC veya materialized aggregate |
| Stok | Ürünlerde count, hareketlerde `limit(2000)` var | Orta | Server-side pagination ve cursor/range standardı |
| Sipariş detay | Belge kalemlerinde yüksek limitler var | Orta | Belge kalemlerini sayfalı yükleme |
| Proje detay | Çok sayıda ilişkili tablo tek ekranda yükleniyor | Orta-yüksek | Sekme bazlı lazy loading |
| Teklif upload | Parser işi backend'de senkron | Orta | Büyük dosya için job/timeout stratejisi |
| OCR | Tesseract/PDF OCR CPU yoğun | Orta-yüksek | Dosya boyutu limiti, queue ve retry |
| AI | Server-side çağrı var | Orta | Timeout ve cevap cache stratejisi |

## RC1 Kararı

- Pilot/demo ölçeği: kabul edilebilir.
- 100 kullanıcı: dikkatli izleme ile mümkün.
- 1000 kullanıcı: ek pagination, async job ve dashboard aggregation olmadan önerilmez.

## Release Sonrası İzlenecek Metrikler

- Dashboard ilk yükleme süresi
- Stok listesi ilk yükleme süresi
- Proje detay sorgu sayısı ve toplam süre
- OCR ortalama ve p95 süre
- AI endpoint timeout oranı
- Supabase API rate limit ve slow query sinyalleri
