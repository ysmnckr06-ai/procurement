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

async function listAll(client, bucket, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const entry of data || []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) files.push(...(await listAll(client, bucket, path)));
      else files.push({ path, size: entry.metadata?.size || 0, mimetype: entry.metadata?.mimetype });
    }
    if (!data || data.length < 1000) break;
  }
  return files;
}

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
  const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 200);
  const deadline = Date.now() + 50_000;
  const summary = { copied: 0, skipped: 0, failed: [], remaining: 0, buckets: {} };

  for (const bucket of BUCKETS) {
    const [sourceFiles, targetFiles] = await Promise.all([listAll(source, bucket), listAll(target, bucket)]);
    const existing = new Set(targetFiles.map((file) => file.path));
    const todo = sourceFiles.filter((file) => !existing.has(file.path));
    summary.buckets[bucket] = { source: sourceFiles.length, target: targetFiles.length };
    summary.skipped += sourceFiles.length - todo.length;
    for (const file of todo) {
      if (summary.copied >= limit || Date.now() > deadline) {
        summary.remaining += 1;
        continue;
      }
      const { data: blob, error: downloadError } = await source.storage.from(bucket).download(file.path);
      if (downloadError) {
        summary.failed.push({ bucket, path: file.path, error: downloadError.message });
        continue;
      }
      const { error: uploadError } = await target.storage
        .from(bucket)
        .upload(file.path, blob, { contentType: file.mimetype || blob.type || "application/octet-stream", upsert: false });
      if (uploadError) summary.failed.push({ bucket, path: file.path, error: uploadError.message });
      else summary.copied += 1;
    }
  }
  return NextResponse.json(summary);
}
