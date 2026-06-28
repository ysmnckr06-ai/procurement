export async function createDocumentSignedUrl(supabase, document, expiresIn = 600) {
  if (!document?.storage_path) {
    throw new Error("Belge dosya yolu bulunamadı.");
  }

  const bucketName = document.storage_bucket || "order-documents";
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(document.storage_path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Belge için güvenli bağlantı oluşturulamadı.");
  }

  return data.signedUrl;
}

export async function downloadDocumentFile(supabase, document) {
  if (!document?.storage_path) {
    throw new Error("Belge dosya yolu bulunamadı.");
  }

  const bucketName = document.storage_bucket || "order-documents";
  const { data, error } = await supabase.storage
    .from(bucketName)
    .download(document.storage_path);

  if (error || !data) {
    throw new Error(error?.message || "Belge dosyası indirilemedi.");
  }

  const url = URL.createObjectURL(data);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = document.original_file_name || "belge";
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function isPdfDocument(document) {
  const mime = String(document?.mime_type || "").toLocaleLowerCase("tr-TR");
  const name = String(document?.original_file_name || "").toLocaleLowerCase("tr-TR");
  return mime.includes("pdf") || name.endsWith(".pdf");
}
