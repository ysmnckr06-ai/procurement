# First Customer Tenant Checklist

Bu checklist ilk ücretli/pilot müşteri için demo hesabından ayrı, temiz tenant açarken kullanılmalıdır.

## Gerekli müşteri bilgileri

- Şirket adı
- Yetkili kullanıcı e-posta adresi
- Başlangıç şifresi veya şifre belirleme yöntemi
- Vergi no / VKN
- Varsayılan para birimi
- Bildirim e-postası
- Plan tipi: demo, pilot veya active
- Deneme/lisans bitiş tarihi

## Açılış adımları

1. Supabase Auth içinde yeni kullanıcı oluştur.
2. Kullanıcı e-postasını doğrulanmış olarak işaretle veya müşteriye doğrulama maili gönder.
3. `company_settings` için ilk ayar kaydını oluştur.
4. Lisans/demo tablosu kullanılıyorsa kullanıcıya plan tanımı yap.
5. Demo/test verisi kesinlikle bu kullanıcıya taşınmasın.
6. İlk girişten sonra kullanıcı kendi iş ortaklarını, stoklarını ve projelerini oluştursun.
7. Storage bucket erişimlerinin public olmadığını tekrar kontrol et.
8. RLS policy doğrulaması yap.

## İlk giriş sonrası kontrol

- Kullanıcı login olabiliyor mu?
- Dashboard boş/temiz tenant olarak açılıyor mu?
- Ayarlar kaydedilip reload sonrası korunuyor mu?
- Başka tenant verisi görünmüyor mu?
- Belge yükleme bucket erişimi çalışıyor mu?

## Not

İlk müşteri hesabı açılmadan önce production backup durumu ve environment variable listesi doğrulanmalıdır.
