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

## 17 Ekim öğleden sonra tamamlananlar (hepsi canlıda, robot 31/31)

| İş | PR | Not |
|---|---|---|
| Teklif belgesi projeye bağlanır | #33 | Mevcut 72 teklif belgesi SQL ile geriye dönük bağlandı. |
| Teslim almada irsaliye / teslim fişi PDF'i | #34, #39 | İrsaliye no ile tek belgede toplanır; sipariş ve projeye bağlı; teslim kilidini bekletmez. |
| Proje rakamları tutarlı | #35 | `lib/projectFinance.js`: proje detayı, Finans, Kontrol Merkezi aynı kâr/maliyet tanımı. |
| Robota yeni akışlar | #36, #37 | Ödünç/iade, belge ekleme, geçmiş kur, teklif bağı, irsaliye, kâr eşitliği. |
| Her türlü belge yüklenebilir | #37, #38 | Word/DWG/XML/metin genel ikili türle yüklenir (`lib/storageContentType.js`). |

## 17 Ekim akşam: derinlemesine test (robot 34/34 + ekran taraması 43/43)

| Bulgu | Çözüm |
|---|---|
| request-reports dosya alanında 3 elle eklenmiş gevşek kural: başka firmanın raporları okunabiliyordu | Canlıda silindi; migration 0046 (#40) |
| Döviz siparişe farklı para birimiyle ödeme yanlış toplanıyordu | #41 |
| 24 sayı kutusunda kuruşlu tutar/ondalık girilemiyordu (form sessizce gönderilmiyordu) | step="any" (#41) |
| Eşzamanlı teslimde sipariş teslim miktarı eziliyordu | Kayıt öncesi güncel sipariş okunur (#42) |
| İş Ortakları sayfası 22 sn (tarayıcıda 57 sn betik) | Teklif satırları bir kez çözümlenir (#42, #45) → 7,5 sn |
| Belge okuma: 25 bilgiden 4'ü doğru, tarama dakikalar | GİB düzeni, VKN, çizgi silme (#43) → 24/25, 2–5 sn |
| Robot önizleme işleriyle iptal oluyordu | concurrency (#44) |

Sağlam: 32 tabloda RLS, 21 tabloda çapraz firma denemesi engellendi, 12 sunucu ucu sahiplik kontrolü yapıyor, abonelik/iptal/ödenmeyen lisans doğru, 18 sayfa masaüstü+telefon hatasız, yoğun veriyle (4.640 kart, 247 proje) sayfalar 6–7,5 sn (robot bekleme payı dahil).

## Sıradaki işler (kullanıcı kararı gerekenler)

1. Supabase ücretsiz planda: **yedek yok**. Pro plana geçiş, sonra yedekten geri dönüş denemesi.
2. Ekip desteği yok (her hesap tek kişi) — satış için en büyük eksik.
3. Aboneye e-Arşiv fatura kesilmiyor — muhasebe mi, fatura servisi mi?
4. Süresiz lisanslı 3 hesap (ysmi…, bsra…, name…) bilinçli mi?
5. Benzer adlı iş ortakları (benzerlik ≥ 0,9) sayfa açılışında otomatik birleştiriliyor; "Anadolu Elektrik / Elektronik" 0,889 ile sınırda. Otomatik yerine öneri olması değerlendirilmeli.
6. Robota eklenmeyenler: açık ihtiyaçlara dağıtım, reçete okuma (yalnız birim testleri).
7. Bir hafta sonra: Sidney projesini ve Oregon Render servisini kapatmak. (Sidney'de aynı gevşek dosya kuralları olabilir.)
8. Bağımsız sızma testi ve KVKK metinlerinin hukuki kontrolü (uzman gerekli).

## Çalışma notları

- Canlı DB'de SQL: Supabase SQL Editor (corvian-eu). Monaco'ya metin `window.monaco.editor.getModels()[0].setValue(...)` ile konur.
- Silme/`drop` içeren sorgularda Supabase onay penceresi çıkar; onayı kullanıcı verir.
- Canlı fonksiyonlar repo dosyalarından farklı olabilir (ör. reserve_project_items_from_stock); değiştirmeden önce `pg_get_functiondef` ile kontrol, gerekirse yerinde yama.
- Robot: `.github/workflows/e2e.yml`, sonuç annotation'larda (log indirme engelli). GitHub en fazla 10 annotation gösterir; robot özet + başarısızları yazar.
- Dal push'u önizleme yayını tetikler ve aynı `concurrency` grubundaki elle başlatılmış robotu iptal eder; önizleme bitince yeniden başlat.
