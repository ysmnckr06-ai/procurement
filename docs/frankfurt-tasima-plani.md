# Supabase'i Frankfurt'a taşıma planı (bekliyor)

Durum (14 Ekim 2026): Supabase projesi `tbyfwnpayppslkcqjwog` Sidney'de (Oceania).
Türkiye'den her veritabanı isteği ~400 ms. PR #19 sonrası stok sayfası 13 sn → 9 sn,
sayfa HTML'i 4,7 sn → 2,3 sn. Kalıcı çözüm: Frankfurt'ta yeni proje.

## Kullanıcının adımları
1. supabase.com → New project → Region: Central EU (Frankfurt), Free, ad "corvian-eu".
   Veritabanı şifresini kendisi belirler (Claude'a yazılmaz).
2. Taşıma bitince Vercel (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
   SUPABASE_SERVICE_ROLE_KEY) ve Render (SUPABASE_URL, SUPABASE_ANON_KEY,
   SUPABASE_SERVICE_ROLE_KEY) anahtarlarını yeni projeninkilerle değiştirir.

## Claude'un adımları (Supabase SQL ekranı, kullanıcının Chrome'unda)
1. Şema: supabase_schema.sql + supabase/migrations (sırayla) yeni projede.
2. Veri: eski projede tablo tablo JSON dışa aktarım → yeni projede insert
   (auth.users dahil; şifre özetleri korunur, kullanıcılar aynı şifreyle girer).
3. Storage: belgeler (documents bucket vb.) indir → yükle.
4. Doğrulama: her tabloda kayıt sayısı ve stok/rezerve toplamları iki projede aynı.
5. Anahtar değişiminden sonra canlı sitede giriş + test robotu.
6. vercel.json regions → ["fra1"].
7. Eski proje doğrulamadan sonra bir süre yedek olarak kalır.

Kesinti: ~30-60 dk (veri girişi yapılmamalı).
