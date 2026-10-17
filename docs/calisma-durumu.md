# Çalışma durumu — 17 Ekim 2026

Kaldığımız yer. Ayrıntılı rapor: "CORVIAN Uçtan Uca Test Raporu" belgesi
(https://claude.ai/code/artifact/1d73effe-7d46-4775-ae2f-ef4eca31e5de), en alttaki
"Gerçek firma test planı" ve "Durum — 15 Ekim akşam" bölümleri.

## Tamamlanan (hepsi main'de ve canlıda)

| Konu | PR | Not |
| --- | --- | --- |
| iyzico abonelik (sandbox) | #20, #21 | Plan 598,80 TL/ay (499 + KDV), kod Vercel'de `IYZICO_PRICING_PLAN_REFERENCE_CODE`. Ödeme/iptal/süre dolumu test edildi. Canlı ödeme için iyzico canlı anahtarları gerekecek. |
| Supabase Frankfurt'a taşındı | #22–#25 | Yeni proje `mxqvmpzeeyjcuqacdyre` (corvian-eu). 31 tablo, 37 kullanıcı, 251 dosya; kayıt kayıt aynı. Vercel + Render (corvian-backend, Frankfurt) yeni anahtarlarda. Sorgu ~400 → ~190 ms. |
| 1000+ satır sayfalama (proje detayı, icmal) | #24 | |
| Proje belgeleri + belge türü kısıtı | #26 | Canlıda kısıt yalnız 5 türdü; 16 türe çıktı. Hiç uygulanmamış 0020/0030/0031 canlıya uygulandı. |
| Okuma tutarlılığı + reçete (Seviye) düzeni | #27 | Aynı kod/farklı açıklama, aynı açıklama/farklı kod, kodsuz kalem uyarıları; tekstil düzeni. |
| Faturada anlaşılan kur | #28 | Sipariş günü / fatura günü TCMB / sabit / elle. `/api/live-rates?date=`. |
| Açık ihtiyaçlara dağıtım (100 sigorta) | #29 | Teslim Alma sekmesi. |
| Stok kullanımı gerçek alış fiyatıyla | #30 | Migration 0044 (fonksiyon yerinde yamalandı). |
| Montajdan iade, projeler arası aktarım (ödünç) | #31 | Migration 0045. Canlıda geri alınan işlemle test edildi. |
| Test robotu eşzamanlılık | #32 | Benzersiz etiket + `concurrency`. |

Canlıya elle uygulanan migrationlar: 0042, 0043, 0044, 0045 (+ eskiden eksik kalan 0020, 0030, 0031).

## Sıradaki işler

1. Siparişe dönüşmeyen teklifleri projeye bağlamak (backend `persist_source_offer_document` belgeyi bağlamıyor).
2. Teslim almada irsaliyenin belge olarak otomatik oluşması.
3. Test planı madde 2: proje raporları ↔ proje sayfası ↔ finans tutarlılık kontrolü.
4. Yeni akışları test robotuna eklemek: belge ekleme, kur sorusu, açık ihtiyaçlara dağıtım, ödünç/iade, reçete okuma.
5. Bir hafta sonra: eski Sidney projesini (`tbyfwnpayppslkcqjwog`) ve Render'daki kullanılmayan Oregon "procurement" servisini kapatmak.
6. Robotun test hesabında bıraktığı E2E- kartlarını temizlemek.

## Çalışma notları

- Canlı DB'de SQL: Supabase SQL Editor (corvian-eu). Monaco'ya metin `window.monaco.editor.getModels()[0].setValue(...)` ile konur.
- Silme/`drop` içeren sorgularda Supabase onay penceresi çıkar; onayı kullanıcı verir.
- Canlı fonksiyonlar repo dosyalarından farklı olabilir (ör. reserve_project_items_from_stock); değiştirmeden önce `pg_get_functiondef` ile kontrol, gerekirse yerinde yama.
- Robot: `.github/workflows/e2e.yml`, sonuç annotation'larda (log indirme engelli).
