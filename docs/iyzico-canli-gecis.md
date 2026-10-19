# iyzico: test ortamından canlı ödemeye geçiş

Kod canlıya hazır; yalnız ortam değişkenleri değişir. Sandbox'ta ödeme, iptal ve
süre dolumu test edildi (#20, #21).

## 1. iyzico tarafı (firma hesabı sahibi yapar)

1. iyzico üye işyeri başvurusu onaylı ve **canlı** panel açık olmalı.
2. Canlı panelde **Abonelik (Subscription)** ürününün açık olduğunu iyzico'ya teyit ettirin
   (abonelik servisi ayrıca aktifleştirilir; kapalıysa plan kurulumunda
   "yetkiniz yok" benzeri hata alınır).
3. Canlı panel → Ayarlar → **API anahtarı**, **Gizli anahtar** ve **Üye işyeri numarası**
   (merchant ID) alınır.
4. Canlı panel → Ayarlar → **Bildirimler / Webhook** adresi:
   `https://procurement-dun.vercel.app/api/billing/webhook`
   (özel alan adı bağlanırsa o adres). İmza sürümü V3.

## 2. Vercel ortam değişkenleri (Production)

| Değişken | Değer |
|---|---|
| `IYZICO_BASE_URL` | `https://api.iyzipay.com` |
| `IYZICO_API_KEY` | canlı API anahtarı |
| `IYZICO_SECRET_KEY` | canlı gizli anahtar |
| `IYZICO_MERCHANT_ID` | canlı üye işyeri numarası |
| `IYZICO_PRICING_PLAN_REFERENCE_CODE` | 3. adımda alınır |

Anahtarları değerleri hesap sahibi girer; sohbete, koda veya belgeye yazılmaz.
`IYZICO_BASE_URL` boş bırakılırsa kod **sandbox**'a gider; canlıda mutlaka yazılmalı.

## 3. Canlı ödeme planını oluşturma

1. Değişkenler kaydedilip yeniden yayınlandıktan sonra destek yöneticisi hesabıyla giriş yapın.
2. Tarayıcı konsolunda tanı:
   `fetch('/api/billing/setup-plan',{method:'POST',body:JSON.stringify({check:true})}).then(r=>r.json())`
   → `baseUrl` `https://api.iyzipay.com` olmalı; `binCheck.ok` ve `subscriptionList.ok` `true` olmalı.
3. Plan: `...JSON.stringify({price:598.80})...` → dönen `pricingPlanReferenceCode`
   Vercel'e `IYZICO_PRICING_PLAN_REFERENCE_CODE` olarak yazılır, yeniden yayınlanır.

## 4. Canlı doğrulama (gerçek kartla, küçük risk)

1. Yeni bir test hesabıyla abone olun → `subscriptions` satırı `active`, iyzico panelinde abonelik görünür.
2. iyzico panelinden webhook'un 200 döndüğünü görün.
3. Aboneliği uygulamadan iptal edin → iyzico'da iptal görünür; ödenen ay sonuna kadar erişim sürer.
4. Gerekirse ilk tahsilatı iyzico panelinden iade edin.

## Not

- Sandbox plan kodu canlıda geçmez; canlı plan 3. adımda yeniden oluşturulur.
- Mevcut süresiz lisanslı 3 hesap bu değişiklikten etkilenmez.
