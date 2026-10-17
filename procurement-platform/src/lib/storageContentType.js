// Depolama alanı yalnız PDF, resim ve tablo türlerini adıyla kabul eder. Word
// sözleşmesi, DWG çizim, ZIP gibi diğer dosyalar genel ikili türle yüklenir;
// gerçek tür ve dosya adı belge kaydında saklanır.
const STORAGE_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

export function storageContentType(file) {
  return STORAGE_MIME_TYPES.has(file.type) ? file.type : "application/octet-stream";
}

// Supabase istemcisi File/Blob yüklerken türü dosyanın kendisinden okur, verilen
// contentType seçeneğine bakmaz. Bu yüzden desteklenmeyen türdeki dosya aynı
// içerik ve adla, kabul edilen türde yeniden sarılır.
export function storageFile(file) {
  const type = storageContentType(file);
  if (file.type === type) return file;
  return new File([file], file.name || "belge", { type, lastModified: file.lastModified });
}
