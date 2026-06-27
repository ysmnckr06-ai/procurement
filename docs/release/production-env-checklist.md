# Corvian v1.0 Production Environment Checklist

Bu liste local `.env` dosyalarından bağımsız olarak Railway, Vercel ve Supabase production ayarlarında doğrulanmalıdır.

## Frontend

- [ ] `NEXT_PUBLIC_SUPABASE_URL` production Supabase projesini gösteriyor.
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` production anon key.
- [ ] `NEXT_PUBLIC_API_URL` localhost değil, production Railway backend URL.
- [ ] Vercel domain ve custom domain doğru.
- [ ] Preview env ile production env ayrılmış.

## Backend

- [ ] `SUPABASE_URL` production Supabase projesini gösteriyor.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` sadece backend ortamında tanımlı.
- [ ] `SUPABASE_ANON_KEY` backend doğrulama ihtiyaçları için tanımlı.
- [ ] CORS allowlist production frontend URL ile sınırlı.
- [ ] `TESSERACT_CMD` veya OCR runtime production ortamında mevcut.
- [ ] Upload temp dizini yazılabilir.
- [ ] Backend health endpoint veya Railway deploy health check çalışıyor.

## AI

- [ ] `OPENAI_API_KEY` sadece server-side ortamda tanımlı.
- [ ] AI endpoint read-only kalıyor; insert/update/delete/RPC yok.
- [ ] API key eksikken kullanıcıya sade yapılandırma mesajı dönüyor.

## Storage

- [ ] `request-reports` private.
- [ ] `order-documents` private.
- [ ] Signed URL süreleri sınırlı.
- [ ] Public bucket yok veya business gerekçesi yazılı.

## Secrets

- [ ] Service role key frontend bundle içinde yok.
- [ ] `.env` dosyaları repository'ye commit edilmiyor.
- [ ] Test/QA kullanıcıları production auth içinde yok.
- [ ] Debug log seviyesi production'da kapalı.
