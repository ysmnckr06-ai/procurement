import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tek seferlik taşıma: eski Supabase projesindeki depolama dosyalarını yeni
// projeye kopyalar. Yalnız destek yöneticisi çağırabilir. Eski projenin adresi
// ve servis anahtarı yalnız sunucu ortam değişkenlerinden okunur
// (OLD_SUPABASE_URL, OLD_SUPABASE_SERVICE_ROLE_KEY); taşıma bitince silinir.
// Her çağrı en fazla `limit` dosya kopyalar; zaten var olan dosyalar atlanır.
const BUCKETS = ["order-documents", "request-reports"];

export async function POST(request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  const { data: isAdmin } = await supabase.rpc("is_support_admin");
  if (isAdmin !== true) return NextResponse.json({ error: "Yetkiniz yok." }, { status: 403 });

  const oldUrl = String(process.env.OLD_SUPABASE_URL || "").trim();
  const oldKey = String(process.env.OLD_SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const target = createAdminSupabaseClient();
  if (!oldUrl || !oldKey || !target) {
    return NextResponse.json({ error: "OLD_SUPABASE_URL / OLD_SUPABASE_SERVICE_ROLE_KEY tanımlı değil." }, { status: 503 });
  }
  if (oldUrl.replace(/\/$/, "") === String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "")) {
    return NextResponse.json({ error: "Eski ve yeni proje adresi aynı." }, { status: 400 });
  }
  const source = createClient(oldUrl, oldKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const body = await request.json().catch(() => ({}));
  const deadline = Date.now() + 50_000;
  const summary = { copied: 0, skipped: 0, failed: [], remaining: 0 };

  // Dosya listesi çağıran tarafından verilir (eski veritabanındaki storage.objects);
  // klasör klasör listelemek uzak bölgede çok yavaş.
  const files = (Array.isArray(body.files) ? body.files : [])
    .filter((file) => BUCKETS.includes(file?.bucket) && typeof file?.path === "string" && file.path)
    .slice(0, 200);
  for (const file of files) {
    if (Date.now() > deadline) {
      summary.remaining += 1;
      continue;
    }
    const { data: blob, error: downloadError } = await source.storage.from(file.bucket).download(file.path);
    if (downloadError) {
      summary.failed.push({ ...file, error: downloadError.message });
      continue;
    }
    const { error: uploadError } = await target.storage
      .from(file.bucket)
      .upload(file.path, blob, { contentType: file.mimetype || blob.type || "application/octet-stream", upsert: false });
    if (uploadError && /exists|duplicate/i.test(uploadError.message)) summary.skipped += 1;
    else if (uploadError) summary.failed.push({ ...file, error: uploadError.message });
    else summary.copied += 1;
  }
  return NextResponse.json(summary);
}
