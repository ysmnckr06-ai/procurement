# Corvian v1.0 RC1 Smoke Test

## Kapsam

RC1 smoke test, release hardening değişikliklerinden sonra temel sistem sağlığını doğrulamak için çalıştırılır.

## Kontrol Listesi

- [x] Production DB erişilebilir.
- [x] QA/demo/test kullanıcı temizliği doğrulandı.
- [x] `order_receipts` içinde 0 veya negatif teslim yok.
- [x] Strict duplicate receipt grubu yok.
- [x] `npm run build` başarılı.
- [x] Backend Python dosyaları compile oluyor.
- [x] Frontend `console.log` debug çıktısı kalmadı.
- [x] Storage bucketlar private.
- [x] AI endpoint static kontrolde read-only.
- [ ] `npm run lint` tamamen yeşil.

## Smoke Evidence

- QA/smoke auth kullanıcıları: 0
- 0 veya negatif receipt: 0
- Strict duplicate receipt grubu: 0
- Kritik tablo sayımları:
  - projects: 14
  - project_items: 1362
  - suppliers: 364
  - products: 248
  - orders: 6
  - requests: 5
  - offers: 19
  - reports: 7
  - stock_movements: 172
  - documents: 2
- `python -m py_compile`: PASS
- `npm run build`: PASS
- `npm run lint`: FAIL, 140 error / 19 warning

## Sonuç

RC1 smoke test: **PASS WITH LINT DEBT**
