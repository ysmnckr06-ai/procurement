# Uçtan uca test bulguları (13 Ekim 2026, test hesabı)

1. [UX] Stok toplu yüklemede aynı kod iki kez geçince tüm yükleme kilitleniyor ("4 satır kontrol gerekiyor") ama önizleme yalnız ilk 20 satırı gösteriyor; sorunlu satırlar (144-145. sıra civarı) görünmüyor, hangi kod olduğu yazmıyor. Kullanıcı neyi düzelteceğini bulamaz. → Çakışan satırları üstte göster, kodları mesajda say.
2. [PERF] 500 satırlık stok yüklemesi satır satır sırayla 2 istek (RPC ~430ms + ürün güncelleme ~490ms) → ~8 dk. Ekranda yalnız "uygulanıyor..." yazıyor, ilerleme yok. Kullanıcı sekmeyi kapatırsa yarım yükleme kalır; yeniden yüklerse yeni batchId ile ilk satırlar ikinci kez eklenir (çift stok riski). → Eşzamanlı (6-8 paralel) işle, "120/500" ilerleme göster, sayfadan çıkarken uyar.
3. [BUG] Miktarı 0 olan 80 satır hiç kart olarak açılmadı (RPC miktar>0 istiyor); sonuç İngilizce "HIGH RISK" uyarısı. Toplamlar doğru olsa da alarm verdi.
4. [OK] Yüklenen 420 kartın stok, kritik, fiyat, para birimi, marka, adı dosyayla birebir; özet kartlar 420 / 76.583 / düşük stok 96 doğru.
5. [PERF-KRİTİK] 420 ürünle stok kartı formunda her tuş ~2,9 sn gecikiyor (her render'da 420x420 hareket eşleştirmesi, özet toplamlar memo'suz). → Kırılımlar useMemo ile bir kez.
6. [OK] 20 proje formdan oluşturuldu (her biri ~17 sn, Excel analiziyle); 18 malzeme listesinin miktar/fiyatları birebir aktarıldı; müşteriler otomatik iş ortağı oldu (8 firma).
7. [BUG-KRİTİK] Proje malzeme Excel'indeki "Para Birimi" sütunu yok sayılıyor: 22 USD/EUR satırı TL olarak kaydedildi (ör. 9,78 EUR → 9,78 TL). Proje maliyeti/kârı yanlış. Sebep: backend /parse-project-items sonuç satırına currency koymuyor. → Düzeltildi.
   Ek: EUR projesinde (TST-20) TL fiyatlı 7 satır EUR olarak kaydedildi (410 TL → 410 EUR!) çünkü para birimi gelmeyince proje para birimi varsayılıyor. Aynı düzeltmeyle çözülür. Test verisinde 23 satır elle düzeltildi.
8. [NOT] Yeni hesapta proje sayfası her proje için localStorage'a 2 anahtar yazıyor ve hiç temizlemiyor (önemsiz, ileride şişer).
9. [OK] 16 projede stoktan ayırma: toplam 1.647 adet; her ürün kartındaki rezerve = projelerdeki rezerve toplamı (420 kartta 0 fark), rezerve hiçbir kartta stoğu aşmıyor. Kıt ürünlerde (YDK-0482) ilk proje stoğu aldı, sonraki proje tamamını talep etti — doğru.
10. [OK] 14 talep oluştu; talep miktarları = ihtiyaç − rezerve (birebir). 12 mukayese, 2 tedarikçi; yarım adet teklif "Koşul eksik", eksik teklif edilen kalem tek teklifle doğru gösterildi. 21 sipariş; sipariş toplamları kalem toplamlarıyla tutarlı; EUR projesinde para birimine göre ayrı sipariş.
11. [UX] İş Ortakları'nda kayıtlı olmayan tedarikçilerde hiçbir kalemde otomatik seçim yapılmıyor (11 kalemin 11'i "kullanıcı kontrolü gerekli"). Bilgi kutusu var ama yeni kullanıcı için ilk deneyim zayıf; tedarikçi kaydedilince 8 kalemin 7'si otomatik seçildi.
12. [BUG] Mukayeseden sipariş verildikten sonra talep "Rapor Oluşturuldu"da kalıyor, "Teklif Havuzunda" rozeti gösteriyor; "Açık Süreç" sayacı 14 talep varken 0 (proje taleplerini saymıyor). → Düzeltildi.
13. [UX] Talep adı "PRJ-00008 - Satınalma Gerekenler" — proje adı/müşteri yok; kodsuz kaleme verilen otomatik kod "PRJ-0001" proje koduyla (PRJ-00001) karışıyor.
14. [BUG-KRİTİK] (bekleyen hata #3 doğrulandı) TST-12'nin siparişinden gelen 20 adet YDK-0175 stoğa girdi ama projeye rezerve edilmedi; depoda "boşta" görünüyor, başka proje ayırabilir. → Teslim alma fonksiyonu projeye açık ihtiyaç kadar rezerve edecek şekilde düzeltildi (migration 0038).
15. [BUG-KRİTİK] Aynı sipariş kalemine aynı gün aynı miktarda ikinci sevkiyat (8+8) "Depo teslim alma kaydedildi ve stok girişine işlendi" mesajı verdi ama HİÇBİR şey kaydedilmedi (stok 10→10, sipariş 8/16'da kaldı). Sebep: veritabanı "tekrar kayıt" korumasının süresiz olması. → 2 dakikalık çift tıklama penceresine indirildi.
16. [NOT] Üretim/montaj çıkışı yalnız "ana kalem + alt kalem" yapısındaki projelerde var; düz malzeme listesiyle açılan projelerde (bu testteki 18 proje) üretime çıkış yapılamıyor. Ayrıca alt kalemlerde received_quantity hem "tedarikçiden gelen" hem "üretimde kullanılan" için kullanılıyor (çift anlam).
17. [BUG] Proje "İptal" yapılınca projeye stoktan ayrılmış 54 adet (6 kalem) kilitli kaldı; hiçbir uyarı yok, başka proje kullanamıyor. → İptalde onay sorusu + rezerve stoğu depoya bırakan fonksiyon (migration 0039).
18. [UX] Proje listesinde TST-19 için ilerleme "%0" ve "Sipariş yok" — 6 kalemi stoktan ayrılmış projede ilerleme 0 görünmesi yanıltıcı.
19. [BUG] Mukayeseden oluşturulan siparişlere teklifteki termin/vade aktarılmıyor → 21 siparişin 21'i "Terminsiz açık sipariş"; geciken sipariş / bu hafta teslimat uyarıları hiç çalışamaz. → Düzeltildi (test verisi de güncellendi).
20. [OK] Genel Bakış: Aktif proje 17 (20 − 1 iptal − 2 tamamlandı), ödeme bekleyen 21, siparişe dönmeyen rapor 2 — doğru.
21. [OK] TST-18 proje finansı: stoktan kullanılan 48.135,21 + sipariş 39.074,76, brüt 45.790,03 — bağımsız hesapla birebir.
22. [BUG] (bekleyen hata #2 doğrulandı) Finans sayfası proje kâr/zararı = sözleşme − sipariş; stoktan kullanılan ve ek giderler yok. Örn. TST-05 (tamamen stoktan): Finans'ta 117.000 TL kâr. → Düzeltildi, tabloya "Stoktan / Gider" sütunu eklendi.
23. [BUG] İptal edilen TST-19'un 237.000 TL sözleşmesi Finans'ta müşteri alacağına dahil (4.682.977 yerine 4.445.977 olmalı). → Düzeltildi.
24. [BUG] Proje finansındaki "stoktan kullanılan" kalemin anlık rezervinden hesaplanıyordu: üretime çıkınca maliyet kayboluyor, siparişle gelip ayrılan malzeme çift sayılacaktı. → Ayırma hareketlerinden hesaplanıyor.
25. [RİSK] Supabase sorgu başına en fazla 1000 satır döndürür; stok/finans sayfaları .limit(2000/5000) ile 1000'i aştığını sanıyordu. 1000+ stok kartı/hareketi olan firmada liste ve toplamlar sessizce eksik kalır. → Stok ve Finans sayfaları sayfalanarak tümünü okuyor (diğer sayfalar için de yapılmalı).
26. [KÜÇÜK] Proje finans ekranında ayırıcı olarak "?" görünüyordu ("Proje finansı ? Baz para birimi"). → "·" yapıldı.
27. [BUG] Kritik stok sayısı ekrana göre farklı: Genel Bakış 94 (depodaki stok), Stok ekranı ve Kontrol Merkezi 96 (projelere ayrılmamış stok). → Hepsi kullanılabilir stoğa göre.
28. [BUG] Kontrol Merkezi kısmi teslim alınmış siparişi "açık" saymıyor (21 açık siparişte 20 gösterdi; "Kısmi Teslim" /teslim/ kalıbına takılıyor). → Düzeltildi.
29. [OK] Kontrol Merkezi: 4 açık talep (teklifi/siparişi bekleyen), 265 proje kalemi, 21 sipariş — doğru. "Proje 20" iptal edileni de sayıyor (küçük).
30. [OK] Düzeltmeler canlıda: stoğu 0 olan 80 kart 27 sn'de açıldı (önceden ~1 sn/satır), ilerleme çubuğuyla. Stok formunda tuş gecikmesi 2.900 ms → 7-14 ms.
31. [OK] TST-13: aynı kalem iki ayrı irsaliye (5+5) ikisi de kaydedildi, 10 adet projeye rezerve. TST-14: 21 gelen/2 hatalı → 19 stoğa, siparişte 2 kalan, projede 2 eksik; 16'nın 14'ü eksik teslimat doğru.
32. [BUG] İki sevkiyatla ihtiyacın tamamı gelse de proje kalemi "Eksik geldi" kalıyordu. → Migration 0040 (canlıda).
33. [BUG-KRİTİK] Excel'de büyük harfli pano adları ("ANA DAĞITIM PANOSU") ana kalem olarak tanınmıyordu: ilk kelime marka sanılıyor, pano satırı alt malzeme oluyor, diğer panonun malzemeleri yanlış panoya bağlanıyordu. → Düzeltildi + test (PR #15).
34. [OK] TST-17 %40 avans; TST-18 avans+kapanış (tam tahsilat) + 4.500 TL nakliye: proje brüt 105.094,20 ve 41.290,03 — elle hesapla aynı.
35. [OK] Test robotu canlıda 22/22 geçti (GitHub Actions).
36. [EKSİK-KRİTİK] Arayüzde "üretime/montaja çıkış" adımı hiç yoktu (ana kalem tamamlama fonksiyonu kodda var, hiçbir düğmeye bağlı değil). → İhtiyaç Analizi'ne kısmi çıkışlı panel + issue_project_items_to_production (migration 0041). Stok ekranı üretimdeki miktarı kullanılabilirden ikinci kez düşüyordu → düzeltildi.
37. [OK] TST-21 (2 pano) yarım montaj 18/36, TST-22 tam 33, TST-15 yarı 69, TST-16 tam 66. 740 kartın hepsinde stok = girişler − üretime çıkış ve rezerve = projelerde tutulan; 0 fark. Stok ekranı: 82.433 / ayrılan 3.510 / üretimde 186 / kullanılabilir 78.923 — DB ile aynı.
38. [OK] Finans: TST-05 artık stok maliyetiyle (87.591,24), TST-17 105.094,20, TST-18 41.290,03 — proje sayfalarıyla aynı; iptal proje yok; tahsilat 265.000.
39. [PERF] 740 kart/930 hareketle Stok sayfasının ilk açılışı ~15 sn (sonraki yazma hızlı). İleride sunucu tarafı özet gerekir.
40. [BUG] "Örnek verilerle dene" canlıda veritabanında olmayan alan yüzünden hata verdi → PR #17.
41. [NOT] Test robotu her çalışmada test hesabına 30 kart + 2 proje ekliyor (sözleşmeler finansa yansıyor). Ayrı bir robot hesabı ya da sonda temizleme önerilir.
