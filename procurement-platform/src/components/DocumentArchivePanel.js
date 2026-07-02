"use client";

const documentTypeLabels = {
  proje: "Proje Kaynak Dosyası",
  fatura: "Fatura",
  irsaliye: "İrsaliye",
  depo_giris: "Teslim Fişi",
  teslim_fisi: "Teslim Fişi",
  teklif: "Teklif",
  siparis_formu: "Sipariş Formu",
  odeme: "Ödeme Belgesi",
  diger: "Diğer",
};

function documentTypeLabel(type) {
  return documentTypeLabels[String(type || "").toLocaleLowerCase("tr-TR")] || "Diğer";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (!size) return "-";
  if (size < 1024 * 1024) return `${(size / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} KB`;
  return `${(size / (1024 * 1024)).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
}

function ocrStatusLabel(status) {
  const value = String(status || "").toLocaleLowerCase("tr-TR");
  if (value === "completed") return "OCR tamamlandı";
  if (value === "failed") return "OCR başarısız";
  if (value === "processing") return "OCR işleniyor";
  return "OCR bekliyor";
}

function ocrStatusClass(status) {
  const value = String(status || "").toLocaleLowerCase("tr-TR");
  if (value === "completed") return "bg-emerald-100 text-emerald-700";
  if (value === "failed") return "bg-red-100 text-red-700";
  if (value === "processing") return "bg-blue-100 text-blue-700";
  return "bg-slate-100 text-slate-600";
}

function isPdfDocument(document) {
  const mime = String(document?.mime_type || "").toLocaleLowerCase("tr-TR");
  const name = String(document?.original_file_name || "").toLocaleLowerCase("tr-TR");
  return mime.includes("pdf") || name.endsWith(".pdf");
}

export default function DocumentArchivePanel({
  documents = [],
  title = "Belgeler",
  emptyMessage = "Henüz belge yüklenmedi.",
  preview,
  loadingDocumentId,
  error,
  onPreview,
  onOpen,
  onDownload,
  onDelete,
  renderExtra,
  compact = false,
}) {
  const groupedDocuments = documents.reduce((groups, document) => {
    const type = String(document.document_type || "diger").toLocaleLowerCase("tr-TR");
    if (!groups[type]) groups[type] = [];
    groups[type].push(document);
    return groups;
  }, {});
  const orderedTypes = ["proje", "fatura", "irsaliye", "depo_giris", "teslim_fisi", "teklif", "siparis_formu", "diger", "odeme"];
  const visibleTypes = [
    ...orderedTypes.filter((type) => groupedDocuments[type]?.length),
    ...Object.keys(groupedDocuments).filter((type) => !orderedTypes.includes(type)),
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-blue-950">{title}</h2>
            {!compact && <p className="mt-1 text-sm font-semibold text-blue-800">
              Orijinal PDF ve belge dosyaları private storage içinde saklanır; OCR sadece analiz özeti olarak kullanılır.
            </p>}
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-800">
            {documents.length} belge
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
          {error}
        </div>
      )}

      {!compact && preview?.url && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-black text-slate-900">PDF Önizleme</div>
              <div className="mt-1 text-xs font-bold text-slate-500">
                {preview.fileName || "Belge"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpen?.(preview.document)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
            >
              Yeni sekmede aç
            </button>
          </div>
          {preview.isPdf ? (
            <iframe
              title={preview.fileName || "Belge önizleme"}
              src={preview.url}
              className="h-[70vh] w-full rounded-xl border border-slate-200 bg-slate-100"
            />
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
              Bu dosya sayfa içinde PDF olarak görüntülenemiyor. Yeni sekmede açabilir veya indirebilirsiniz.
            </div>
          )}
        </div>
      )}

      {documents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm font-bold text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleTypes.map((type) => (
            <section key={type} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-base font-black text-slate-900">{documentTypeLabel(type)}</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                  {groupedDocuments[type].length}
                </span>
              </div>
              <div className={compact ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 xl:grid-cols-2"}>
                {groupedDocuments[type].map((document) => {
                  const pdfDocument = isPdfDocument(document);
                  const hasStoredFile = Boolean(document.storage_path);
                  if (compact) {
                    return (
                      <article key={document.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="truncate font-black text-slate-950" title={document.original_file_name || "Belge"}>
                              {document.original_file_name || "Belge"}
                            </div>
                            <div className="mt-1 text-xs font-bold text-slate-500">
                              Yükleme tarihi: {formatDateTime(document.created_at)}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!hasStoredFile || loadingDocumentId === document.id}
                            onClick={() => onOpen?.(document)}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {loadingDocumentId === document.id ? "Açılıyor..." : "Aç"}
                          </button>
                        </div>
                        {renderExtra?.(document)}
                      </article>
                    );
                  }
                  return (
                    <article key={document.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-black text-slate-950" title={document.original_file_name || "Belge"}>
                            {document.original_file_name || "Belge"}
                          </div>
                          <div className="mt-1 text-xs font-bold text-slate-500">
                            {formatFileSize(document.file_size)} · {document.mime_type || "dosya"}
                          </div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${ocrStatusClass(document.ocr_status)}`}>
                          {ocrStatusLabel(document.ocr_status)}
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Info label="Belge tipi" value={documentTypeLabel(document.document_type)} />
                        <Info label="Yükleme tarihi" value={formatDateTime(document.created_at)} />
                        <Info label="Bağlı sipariş" value={document.linked_order_no || document.order_no || document.linked_order_id || "-"} />
                        <Info label="Bağlı proje" value={document.linked_project_code || document.project_code || document.linked_project_id || "-"} />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!hasStoredFile || !pdfDocument || loadingDocumentId === document.id}
                          onClick={() => onPreview?.(document)}
                          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {loadingDocumentId === document.id ? "Açılıyor..." : "Önizle"}
                        </button>
                        <button
                          type="button"
                          disabled={!hasStoredFile || loadingDocumentId === document.id}
                          onClick={() => onOpen?.(document)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
                        >
                          Yeni sekmede aç
                        </button>
                        <button
                          type="button"
                          disabled={!hasStoredFile || loadingDocumentId === document.id}
                          onClick={() => onDownload?.(document)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
                        >
                          İndir
                        </button>
                      </div>

                      {!hasStoredFile && (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                          Bu proje eski akışta açıldığı için orijinal dosya arşive kaydedilmemiş; burada proje kaydından okunan kaynak dosya adı gösteriliyor.
                        </div>
                      )}

                      {renderExtra?.(document)}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-lg bg-white p-3">
      <div className="text-[11px] font-black uppercase text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}
