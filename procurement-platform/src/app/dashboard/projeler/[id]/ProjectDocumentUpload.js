"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { storageContentType, storageFile } from "@/lib/storageContentType";

// Projeye her türlü belgeyi (fatura, irsaliye, çizim, teklif, sözleşme...)
// ekler. Malzeme listesi gibi okunması gereken dosyalar için üstteki
// "Proje kaynak dosyası" alanı kullanılır; burası yalnız arşivler.
export const PROJECT_DOCUMENT_TYPES = [
  { value: "fatura", label: "Fatura" },
  { value: "irsaliye", label: "İrsaliye" },
  { value: "teslim_fisi", label: "Teslim fişi" },
  { value: "cizim", label: "Çizim / proje çizimi" },
  { value: "teklif", label: "Teklif" },
  { value: "malzeme_listesi", label: "Malzeme listesi (yalnız arşiv)" },
  { value: "sozlesme", label: "Sözleşme" },
  { value: "odeme", label: "Ödeme belgesi / makbuz" },
  { value: "diger", label: "Diğer" },
];

async function sha256(file) {
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function safeName(name) {
  return String(name || "belge")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);
}

export default function ProjectDocumentUpload({ projectId, onDone, onMessage }) {
  const [documentType, setDocumentType] = useState("fatura");
  const [busy, setBusy] = useState(false);

  async function uploadFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      onMessage?.("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      return;
    }

    const failed = [];
    let added = 0;
    for (const file of files) {
      const hash = await sha256(file);
      let documentId = null;
      if (hash) {
        const { data: existing } = await supabase
          .from("documents")
          .select("id")
          .eq("user_id", user.id)
          .eq("content_sha256", hash)
          .limit(1)
          .maybeSingle();
        documentId = existing?.id || null;
      }
      if (!documentId) {
        const fileId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const storagePath = `${user.id}/projects/${projectId}/${fileId}-${safeName(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from("order-documents")
          .upload(storagePath, storageFile(file), { contentType: storageContentType(file), upsert: false });
        if (uploadError) {
          failed.push(`${file.name} (${uploadError.message})`);
          continue;
        }
        const { data: row, error: rowError } = await supabase
          .from("documents")
          .insert({
            user_id: user.id,
            document_type: documentType,
            original_file_name: file.name,
            storage_bucket: "order-documents",
            storage_path: storagePath,
            mime_type: file.type || null,
            file_size: file.size || null,
            content_sha256: hash,
          })
          .select("id")
          .single();
        if (rowError) {
          failed.push(`${file.name} (${rowError.message})`);
          continue;
        }
        documentId = row.id;
      }
      const { data: link } = await supabase
        .from("document_links")
        .select("id")
        .eq("user_id", user.id)
        .eq("document_id", documentId)
        .eq("project_id", projectId)
        .limit(1)
        .maybeSingle();
      if (!link) {
        const { error: linkError } = await supabase
          .from("document_links")
          .insert({ user_id: user.id, document_id: documentId, project_id: projectId });
        if (linkError) {
          failed.push(`${file.name} (projeye bağlanamadı: ${linkError.message})`);
          continue;
        }
      }
      added += 1;
    }
    setBusy(false);
    onMessage?.(
      `${added} belge projeye eklendi.${failed.length ? ` Eklenemeyen: ${failed.join(", ")}.` : ""}`,
    );
    await onDone?.();
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-900">Projeye belge ekle</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            Fatura, irsaliye, çizim, teklif, sözleşme, makbuz... Dosya okunmaz, projenin belgelerine eklenir.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-bold text-slate-700"
            aria-label="Belge türü"
          >
            {PROJECT_DOCUMENT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <label className={`inline-flex cursor-pointer items-center justify-center rounded-xl px-5 py-3 text-sm font-black text-white ${busy ? "bg-slate-400" : "bg-slate-900 hover:bg-slate-700"}`}>
            {busy ? "Yükleniyor..." : "Belge Seç"}
            <input type="file" multiple disabled={busy} onChange={uploadFiles} className="hidden" />
          </label>
        </div>
      </div>
    </div>
  );
}
