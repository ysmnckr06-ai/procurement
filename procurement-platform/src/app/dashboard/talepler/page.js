"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useState, useMemo, useEffect, useRef } from "react";

function StatCard({ icon, title, value, text }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
          {icon}
        </div>

        <div>
          <div className="text-sm text-slate-500">{title}</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{value}</div>
          <div className="text-sm text-slate-500">{text}</div>
        </div>
      </div>
    </div>
  );
}

function Step({ no, title, text }) {
  return (
    <div>
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
        {no}
      </div>
      <div className="font-bold text-slate-800">{title}</div>
      <p className="mt-1 text-xs text-slate-500">{text}</p>
    </div>
  );
}

function parseRequestItemArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Talep kalemleri okunamadı:", error);
    return [];
  }
}

function getRequestItems(request) {
  const candidates = [
    parseRequestItemArray(request?.items),
    parseRequestItemArray(request?.rows),
    parseRequestItemArray(request?.analysis),
  ];

  return candidates.find((items) => items.length > 0) || [];
}

function readItemField(item, keys, fallback = "") {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
}

function formatRequestMoney(value, currency) {
  const amount = Number(value || 0);
  if (!amount) return "-";

  return `${amount.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency || "TRY"}`;
}

function safeFileName(value) {
  return String(value || "talep-listesi")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function safeSheetName(value, fallback = "Talep") {
  const name = String(value || fallback)
    .replace(/[\\/?*[\]:]/g, " ")
    .trim()
    .slice(0, 31);
  return name || fallback;
}

function cleanRequestNote(value) {
  const note = String(value || "").trim();
  if (!note || note === "-") return "";

  const contactPattern = /(\+?\d[\d\s().-]{7,}\d)|(@|www\.|telefon|tel\.?|gsm|fax|faks|e-posta|mail)/i;
  if (contactPattern.test(note)) return "";

  return note;
}

function requestItemsToExportRows(request) {
  const items = getRequestItems(request);

  return items.map((item, index) => {
    const quantity = readItemField(item, ["talepEdilenAdet", "quantity", "qty", "estimated_quantity"], 0);
    const currency = readItemField(item, ["paraBirimi", "currency"], "TRY");

    return {
      "Sıra": index + 1,
      "Ürün Kodu": readItemField(item, ["urunKodu", "product_code", "code"], ""),
      "Marka": readItemField(item, ["marka", "brand"], ""),
      "Açıklama": readItemField(item, ["urunAciklamasi", "product_name", "description", "name"], ""),
      "Miktar": Number(quantity || 0),
      "Birim": readItemField(item, ["birim", "unit"], "adet"),
      "Birim Fiyat": Number(readItemField(item, ["birimFiyat", "unit_price", "estimated_unit_price"], 0) || 0),
      "Toplam": Number(readItemField(item, ["toplam", "total", "estimated_total"], 0) || 0),
      "Para Birimi": currency,
      "Not": cleanRequestNote(readItemField(item, ["not", "note"], "")),
    };
  });
}

function buildMergedPurchasePreview(requests) {
  const grouped = new Map();

  (requests || []).forEach((request) => {
    getRequestItems(request).forEach((item, itemIndex) => {
      const productCode = String(
        readItemField(item, ["product_code", "urunKodu", "code"], ""),
      ).trim();
      const productName = String(
        readItemField(item, ["urunAciklamasi", "product_name", "description", "name"], ""),
      ).trim();
      const unit = String(readItemField(item, ["birim", "unit"], "adet")).trim() || "adet";
      const quantity = Number(
        readItemField(item, ["talepEdilenAdet", "quantity", "qty", "estimated_quantity"], 0),
      ) || 0;
      const normalizedUnit = unit.toLocaleLowerCase("tr-TR");
      const normalizedCode = productCode.toLocaleUpperCase("tr-TR");
      const normalizedName = productName.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
      const key = productCode
        ? `code:${normalizedCode}|unit:${normalizedUnit}`
        : `name:${normalizedName || `${request.id}-${itemIndex}`}|unit:${normalizedUnit}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          productCode,
          productName,
          unit,
          totalQuantity: 0,
          requestIds: new Set(),
          projectQuantities: new Map(),
          matchedByDescription: !productCode,
        });
      }

      const group = grouped.get(key);
      group.totalQuantity += quantity;
      group.requestIds.add(request.id);

      if (request.project_id) {
        group.projectQuantities.set(
          request.project_id,
          Number(group.projectQuantities.get(request.project_id) || 0) + quantity,
        );
      }
    });
  });

  return Array.from(grouped, ([groupKey, group]) => ({
    ...group,
    groupKey,
    requestCount: group.requestIds.size,
    projectDistribution: Array.from(group.projectQuantities, ([projectId, quantity]) => ({
      projectId,
      quantity,
    })),
  }));
}

function MergedPurchasePreview({ rows }) {
  return (
    <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Birleşik Satınalma Önizlemesi</h2>
          <p className="text-sm text-slate-500">Seçili talep listelerindeki aynı ürünler bir araya getirilmiştir.</p>
        </div>
        <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-blue-700">
          {rows.length} birleşik kalem
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs font-bold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Ürün kodu</th>
              <th className="px-3 py-3">Açıklama</th>
              <th className="px-3 py-3">Birim</th>
              <th className="px-3 py-3 text-right">Toplam miktar</th>
              <th className="px-3 py-3 text-right">Talep listesi</th>
              <th className="px-3 py-3">Proje dağılımı</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.groupKey} className="align-top">
                <td className="px-3 py-3 font-bold text-slate-900">
                  {row.productCode || "-"}
                  {row.matchedByDescription && (
                    <div className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                      Ürün kodu yok, açıklamaya göre eşleştirildi.
                    </div>
                  )}
                </td>
                <td className="max-w-[360px] px-3 py-3 font-semibold text-slate-800">{row.productName || "-"}</td>
                <td className="px-3 py-3 text-slate-700">{row.unit}</td>
                <td className="px-3 py-3 text-right font-black text-blue-700">{row.totalQuantity}</td>
                <td className="px-3 py-3 text-right font-bold text-slate-700">{row.requestCount}</td>
                <td className="px-3 py-3">
                  {row.projectDistribution.length > 0 ? (
                    <div className="space-y-1">
                      {row.projectDistribution.map((project) => (
                        <div key={project.projectId} className="rounded-lg bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                          {project.projectId}: {project.quantity} {row.unit}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TaleplerPage() {
  const router = useRouter();
  const API_URL = process.env.NEXT_PUBLIC_API_URL;
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [reportPath, setReportPath] = useState("");
  const [rows, setRows] = useState([]);
  const [savedRequests, setSavedRequests] = useState([]);
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState("");
  const [selectedRequestIds, setSelectedRequestIds] = useState([]);
  const isAnalyzingRef = useRef(false);

  const totalQty = useMemo(() => {
    return rows.reduce((sum, r) => sum + Number(r.talepEdilenAdet || 0), 0);
  }, [rows]);

  const visibleSavedRequests = useMemo(() => {
    return showAllRequests ? savedRequests : savedRequests.slice(0, 5);
  }, [savedRequests, showAllRequests]);

  const selectedRequests = useMemo(() => {
    return savedRequests.filter((request) => selectedRequestIds.includes(request.id));
  }, [savedRequests, selectedRequestIds]);

  const mergedPurchasePreview = useMemo(
    () => buildMergedPurchasePreview(selectedRequests),
    [selectedRequests],
  );
    useEffect(() => {
      loadRequests();
    }, []);

  const loadRequests = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data, error } = await supabase
        .from("requests")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error);
        return;
      }

      setSavedRequests(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const formatDateTime = (value) => {
  if (!value) return "-";

  return new Date(value).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  };

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files || []));
  };

  const handleAnalyze = async () => {
    if (isAnalyzingRef.current) return;
    isAnalyzingRef.current = true;

    if (files.length === 0) {
      setMessage("Lütfen dosya yükleyin.");
      isAnalyzingRef.current = false;
      return;
    }

    setIsLoading(true);
    setMessage("");

    const {
    data: { session },
    } = await supabase.auth.getSession();

    const token = session?.access_token;

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));



    try {
      const response = await fetch(`${API_URL}/analyze-requests`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
  },
  body: formData,
});

      const data = await response.json();

      if (!data.success) {
        setMessage(data.warnings?.join(", ") || "Hata oluştu.");
        setIsLoading(false);
        isAnalyzingRef.current = false;
        return;
      }

      setRows(data.rows || []);
      setReportPath(data.reportPath);
      setMessage("Talep listesi oluşturuldu ✅");
    } catch (err) {
      console.error(err);
      setMessage("Backend bağlantı hatası ❌");
    }

    setIsLoading(false);
  };

  const handleDownload = async () => {
  if (!reportPath) return;

  try {
    window.open(reportPath, "_blank");
  } catch (err) {
    console.error(err);
    setMessage("Excel indirilemedi ❌");
  }
};

  const handleSavedRequestDownload = async (fileName) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const token = session?.access_token;

    if (!token) {
      setMessage("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/download-request-report/${fileName}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await response.json();

      if (!response.ok || !data.reportPath) {
        setMessage(data.detail || "Excel indirilemedi.");
        return;
      }

      window.open(data.reportPath, "_blank");
    } catch (err) {
      console.error(err);
      setMessage("Excel indirilemedi.");
    }
  };

  const downloadRequestsAsExcel = async (requestsToDownload) => {
    if (requestsToDownload.length === 0) {
      setMessage("İndirmek için en az bir talep seçin.");
      return;
    }

    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();

    requestsToDownload.forEach((request, index) => {
      const rowsForSheet = requestItemsToExportRows(request);
      const rowsToWrite = rowsForSheet.length > 0 ? rowsForSheet : [{ Bilgi: "Kalem detayı bulunamadı." }];
      const worksheet = XLSX.utils.json_to_sheet(rowsToWrite);
      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        safeSheetName(`${index + 1} ${request.ad || "Talep"}`)
      );
    });

    const baseName =
      requestsToDownload.length === 1
        ? requestsToDownload[0].ad || "talep-listesi"
        : `secilen-talep-listeleri-${new Date().toISOString().slice(0, 10)}`;
    XLSX.writeFile(workbook, `${safeFileName(baseName)}.xlsx`);
  };

  const downloadRequestsAsPdf = async (requestsToDownload) => {
    if (requestsToDownload.length === 0) {
      setMessage("İndirmek için en az bir talep seçin.");
      return;
    }

    const [{ jsPDF }, autoTableModule] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

    requestsToDownload.forEach((request, index) => {
      if (index > 0) doc.addPage();

      const title = request.ad || "Talep Listesi";
      doc.setFontSize(14);
      doc.text(title, 40, 40);
      doc.setFontSize(9);
      doc.text(`Olusturma tarihi: ${formatDateTime(request.created_at || request.tarih)}`, 40, 58);

      const rowsForPdf = requestItemsToExportRows(request);
      const rowsToWrite = rowsForPdf.length > 0 ? rowsForPdf : [{ Bilgi: "Kalem detayi bulunamadi." }];
      const headers = Object.keys(rowsToWrite[0]);
      const body = rowsToWrite.map((row) => headers.map((header) => row[header] ?? ""));

      autoTable(doc, {
        head: [headers],
        body,
        startY: 78,
        styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: {
          3: { cellWidth: 230 },
          9: { cellWidth: 160 },
        },
        margin: { left: 40, right: 40 },
      });
    });

    const baseName =
      requestsToDownload.length === 1
        ? requestsToDownload[0].ad || "talep-listesi"
        : `secilen-talep-listeleri-${new Date().toISOString().slice(0, 10)}`;
    doc.save(`${safeFileName(baseName)}.pdf`);
  };

  const toggleRequestSelection = (requestId) => {
    setSelectedRequestIds((prev) =>
      prev.includes(requestId) ? prev.filter((id) => id !== requestId) : [...prev, requestId]
    );
  };

  const toggleVisibleRequestSelection = () => {
    const visibleIds = visibleSavedRequests.map((request) => request.id);
    const allVisibleSelected = visibleIds.every((id) => selectedRequestIds.includes(id));

    setSelectedRequestIds((prev) => {
      if (allVisibleSelected) return prev.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...prev, ...visibleIds]));
    });
  };

  const handleSendToOffers = () => {
    if (!reportPath) {
      setMessage("Önce talep listesi oluşturmalısınız.");
      return;
    }

    setMessage("Talep listesi tekliflere aktarıldı ✅");

    setTimeout(() => {
    router.push("/dashboard/teklifler");
    }, 700);
  };

  async function deleteRequest(requestId) {
  const onay = window.confirm("Bu talep listesini silmek istediğine emin misin?");
  if (!onay) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    alert("Kullanıcı bulunamadı.");
    return;
  }

  const { error } = await supabase
    .from("requests")
    .delete()
    .eq("id", requestId)
    .eq("user_id", user.id);

  if (error) {
    alert("Talep silinemedi: " + error.message);
    console.error(error);
    return;
  }

  setSavedRequests((prev) => prev.filter((r) => r.id !== requestId));
  setSelectedRequestIds((prev) => prev.filter((id) => id !== requestId));
}

  return (
    <div className="bg-slate-100">

      <main className="p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-100 text-3xl">
              📚
            </div>

            <div>
              <h1 className="text-3xl font-bold text-slate-900">Talepler</h1>
              <p className="mt-1 text-sm text-slate-600">
                Talep dosyalarınızı yükleyin, icmal listenizi oluşturun ve teklif
                karşılaştırmalarında kullanın.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard icon="📄" title="Yüklenen Dosya" value={files.length} text="Seçili dosya" />
            <StatCard icon="📦" title="Toplam Kalem" value={rows.length} text="İcmal listesinde" />
            <StatCard icon="🔢" title="Toplam Miktar" value={totalQty} text="Talep edilen adet" />
            <StatCard icon="✅" title="Durum" value={reportPath ? "Hazır" : "Bekliyor"} text={reportPath ? "Excel oluşturuldu" : "Analiz bekleniyor"} />
          </div>

          <div className="rounded-2xl border border-purple-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-2xl">
                💡
              </div>
              <p className="text-sm font-medium text-purple-900">
                Burada yüklediğiniz Excel, PDF veya görsel talep dosyaları backend
                tarafından analiz edilir. Ürün kodu, açıklama, adet ve birim
                bilgileri icmal listesine dönüştürülür.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-800">
              Yeni Talep Listesi Oluştur
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              En fazla 15 dosya yükleyebilirsiniz. Desteklenen formatlar: Excel,
              PDF ve görsel dosyalar.
            </p>

            <div className="mt-5 rounded-2xl border border-dashed border-blue-300 bg-slate-50 p-8 text-center">
              <input
                type="file"
                multiple
                accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg"
                onChange={handleFileChange}
                className="mx-auto block w-full max-w-xl rounded-xl border border-slate-300 bg-white p-3"
              />

              <p className="mt-3 text-sm text-slate-500">
                Desteklenen formatlar: .xlsx, .xls, .pdf, .png, .jpg, .jpeg
              </p>

              {files.length > 0 && (
                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-left">
                  <div className="text-sm font-bold text-blue-900">
                    Seçilen Dosyalar
                  </div>

                  <div className="mt-2 space-y-1 text-sm text-blue-800">
                    {files.map((file, index) => (
                      <div key={index}>📎 {file.name}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={handleAnalyze}
                disabled={isLoading}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isLoading ? "İcmal Oluşturuluyor..." : "+ Talep Listesini Oluştur"}
              </button>

              <button
                onClick={handleDownload}
                disabled={!reportPath}
                className="rounded-xl bg-green-600 px-5 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Excel İndir
              </button>

              <button
                onClick={handleSendToOffers}
                disabled={rows.length === 0}
                className="rounded-xl bg-purple-600 px-5 py-3 text-sm font-bold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Tekliflere Aktar
              </button>

            </div>

            {message && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                {message}
              </div>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Oluşturulan Talep Listeleri</h2>
                <p className="text-sm text-slate-500">Daha önce oluşturduğunuz talep listeleri burada görünür.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
                  {savedRequests.length} kayıt
                </span>
                {savedRequests.length > 0 && (
                  <>
                    <button
                      onClick={toggleVisibleRequestSelection}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      {visibleSavedRequests.every((req) => selectedRequestIds.includes(req.id))
                        ? "Görünen seçimi temizle"
                        : "Görünenleri seç"}
                    </button>
                    <button
                      onClick={() => downloadRequestsAsExcel(selectedRequests)}
                      disabled={selectedRequests.length === 0}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      Seçilenleri Excel indir ({selectedRequests.length})
                    </button>
                    <button
                      onClick={() => downloadRequestsAsPdf(selectedRequests)}
                      disabled={selectedRequests.length === 0}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      Seçilenleri PDF indir ({selectedRequests.length})
                    </button>
                  </>
                )}
              </div>
            </div>

            {savedRequests.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Henüz kayıtlı talep listesi yok.
              </div>
            ) : (
              <div className="space-y-3">
                {visibleSavedRequests.map((req, index) => {
                  const requestItems = getRequestItems(req);
                  const isExpanded = expandedRequestId === req.id;
                  const isSelected = selectedRequestIds.includes(req.id);

                  return (
                    <div
                      key={req.id}
                      className={`rounded-xl border bg-white p-4 ${isSelected ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"}`}
                    >
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-[32px_80px_1fr_auto]">
                        <div className="pt-1">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRequestSelection(req.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            aria-label={`${req.ad || "Talep Listesi"} seç`}
                          />
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-500">Sıra No</div>
                          <div className="mt-1 font-bold text-slate-900">{index + 1}</div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-500">Talep</div>
                          <div className="mt-1 font-bold text-slate-900">{req.ad || "Talep Listesi"}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            {req.durum || "Oluşturuldu"} · {req.totalitems || requestItems.length || 0} kalem
                          </div>
                          <div className="mt-2 text-xs font-semibold text-slate-500">Oluşturulma Tarihi</div>
                          <div className="mt-1 font-semibold text-slate-900">
                            {formatDateTime(req.created_at || req.tarih)}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-start gap-2 md:justify-end">
                          <button
                            onClick={() => setExpandedRequestId(isExpanded ? "" : req.id)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            {isExpanded ? "Detayı Gizle" : "Detay"}
                          </button>

                          {req.filepath && (
                            <button
                              onClick={() => handleSavedRequestDownload(req.filepath)}
                              className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white"
                            >
                              Orijinal Excel
                            </button>
                          )}

                          <button
                            onClick={() => downloadRequestsAsExcel([req])}
                            className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                          >
                            Excel indir
                          </button>

                          <button
                            onClick={() => downloadRequestsAsPdf([req])}
                            className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
                          >
                            PDF indir
                          </button>

                          <button
                            onClick={() => router.push(`/dashboard/teklifler?requestId=${req.id}${req.project_id ? `&projectId=${req.project_id}` : ""}`)}
                            className="rounded-lg bg-purple-600 px-3 py-2 text-sm font-semibold text-white"
                          >
                            Tekliflere Aktar
                          </button>
                          <button
                            onClick={() => deleteRequest(req.id)}
                            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white"
                          >
                            sil
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="text-sm font-bold text-slate-900">Talep Kalemleri</div>
                              <div className="text-xs font-medium text-slate-500">
                                Bu talep içinde satınalma için hazırlanan ürünler listelenir.
                              </div>
                            </div>
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">
                              {requestItems.length} kalem
                            </span>
                          </div>

                          {requestItems.length === 0 ? (
                            <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm font-semibold text-slate-500">
                              Bu talep kaydında kalem detayı bulunamadı.
                            </div>
                          ) : (
                            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                              <table className="min-w-full text-left text-sm">
                                <thead className="bg-slate-100 text-xs font-bold uppercase text-slate-500">
                                  <tr>
                                    <th className="px-3 py-3">#</th>
                                    <th className="px-3 py-3">Ürün kodu</th>
                                    <th className="px-3 py-3">Açıklama</th>
                                    <th className="px-3 py-3 text-right">Miktar</th>
                                    <th className="px-3 py-3">Birim</th>
                                    <th className="px-3 py-3 text-right">Birim fiyat</th>
                                    <th className="px-3 py-3 text-right">Toplam</th>
                                    <th className="px-3 py-3">Not</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {requestItems.map((item, itemIndex) => {
                                    const quantity = readItemField(item, ["talepEdilenAdet", "quantity", "qty", "estimated_quantity"], 0);
                                    const currency = readItemField(item, ["paraBirimi", "currency"], "TRY");
                                    return (
                                      <tr key={`${readItemField(item, ["urunKodu", "product_code", "code"], "kod-yok")}-${itemIndex}`} className="align-top">
                                        <td className="px-3 py-3 font-semibold text-slate-500">{itemIndex + 1}</td>
                                        <td className="px-3 py-3 font-bold text-slate-900">
                                          {readItemField(item, ["urunKodu", "product_code", "code"], "-")}
                                        </td>
                                        <td className="max-w-[420px] px-3 py-3 font-semibold text-slate-800">
                                          {readItemField(item, ["urunAciklamasi", "product_name", "description", "name"], "Ürün açıklaması yok")}
                                        </td>
                                        <td className="px-3 py-3 text-right font-bold text-blue-700">
                                          {Number(quantity || 0).toLocaleString("tr-TR")}
                                        </td>
                                        <td className="px-3 py-3 font-semibold text-slate-600">
                                          {readItemField(item, ["birim", "unit"], "adet")}
                                        </td>
                                        <td className="px-3 py-3 text-right font-semibold text-slate-700">
                                          {formatRequestMoney(readItemField(item, ["birimFiyat", "unit_price", "estimated_unit_price"], 0), currency)}
                                        </td>
                                        <td className="px-3 py-3 text-right font-bold text-slate-900">
                                          {formatRequestMoney(readItemField(item, ["toplam", "total", "estimated_total"], 0), currency)}
                                        </td>
                                        <td className="max-w-[260px] px-3 py-3 text-xs font-medium text-slate-500">
                                          {cleanRequestNote(readItemField(item, ["not", "note"], "")) || "-"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}     
<div className="flex justify-center pt-2">
  <button
    onClick={() => setShowAllRequests(!showAllRequests)}
    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100"
  >
    {showAllRequests ? "Daha az göster" : "Tüm talepleri göster"}
  </button>
</div>      
            </div>
          )}
        </div>

          {selectedRequests.length > 0 && <MergedPurchasePreview rows={mergedPurchasePreview} />}

          {rows.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 p-5">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">
                    İcmal Önizleme
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Backend tarafından oluşturulan talep icmal listesi.
                  </p>
                </div>

                <span className="rounded-full bg-green-100 px-4 py-2 text-sm font-bold text-green-700">
                  {rows.length} kalem
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="p-4">Sıra</th>
                      <th className="p-4">Kod</th>
                      <th className="p-4">Açıklama</th>
                      <th className="p-4">Adet</th>
                      <th className="p-4">Birim</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-4 font-medium text-slate-600">{i + 1}</td>
                        <td className="p-4 font-bold text-slate-800">{r.urunKodu || "-"}</td>
                        <td className="p-4 text-slate-700">{r.urunAciklamasi || "-"}</td>
                        <td className="p-4 font-bold text-slate-800">{r.talepEdilenAdet || 0}</td>
                        <td className="p-4 text-slate-600">{r.birim || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-bold text-blue-700">Nasıl Çalışır?</h3>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <Step no="1" title="Dosya Yükleyin" text="Excel, PDF veya görsel talep dosyalarınızı seçin." />
                <Step no="2" title="İcmal Oluşturun" text="Sistem ürünleri birleştirip talep listesini çıkarır." />
                <Step no="3" title="Tekliflere Aktarın" text="Oluşan listeyi teklif karşılaştırmada kullanın." />
              </div>
            </div>

            <div className="rounded-2xl border border-green-200 bg-green-50 p-6 shadow-sm">
              <h3 className="text-lg font-bold text-green-800">İpuçları</h3>

              <div className="mt-4 space-y-3 text-sm text-green-900">
                <p>✅ Ürün kodu varsa sistem eşleştirmeyi daha güçlü yapar.</p>
                <p>✅ Kod yoksa açıklama benzerliğiyle icmal oluşturulur.</p>
                <p>✅ Oluşturulan talep listesi teklif analizinde ana referans olur.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
