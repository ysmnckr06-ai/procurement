"use client";

import { useMemo, useState } from "react";

function InfoBox({ title, text, tone = "blue" }) {
  const toneClasses = {
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    yellow: "border-yellow-200 bg-yellow-50 text-yellow-900",
    green: "border-green-200 bg-green-50 text-green-900",
  };

  return (
    <div className={`rounded-2xl border p-4 ${toneClasses[tone]}`}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-sm">{text}</div>
    </div>
  );
}

export default function TekliflerPage() {
  const [files, setFiles] = useState([]);
  const [parsedSources, setParsedSources] = useState([]);
  const [message, setMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [lastReportTime, setLastReportTime] = useState("");

  const [exchangeRates, setExchangeRates] = useState({
    TRY: 1,
    USD: 39.2,
    EUR: 42.8,
    GBP: 41.2,
  });

  const allParsedRows = useMemo(() => {
    return parsedSources.flatMap((item) => item.rows || []);
  }, [parsedSources]);

  const detectedCurrencies = useMemo(() => {
    const currencies = new Set();

    allParsedRows.forEach((row) => {
      const raw = String(row?.paraBirimi || "").trim().toUpperCase();

      if (!raw) return;

      if (raw === "₺" || raw === "TL") {
        currencies.add("TRY");
      } else {
        currencies.add(raw);
      }
    });

    return Array.from(currencies);
  }, [allParsedRows]);

  const hasForeignCurrency = useMemo(() => {
    return detectedCurrencies.some((currency) => currency !== "TRY");
  }, [detectedCurrencies]);

  const handleFileUpload = async (e) => {
    const uploadedFiles = Array.from(e.target.files || []);
    if (uploadedFiles.length === 0) return;

    const currentCount = files.length;
    const remaining = Math.max(0, 15 - currentCount);
    const allowedNewFiles = uploadedFiles.slice(0, remaining);

    if (allowedNewFiles.length === 0) {
      setMessage("En fazla 15 dosya yükleyebilirsiniz.");
      return;
    }

    setFiles((prev) => [...prev, ...allowedNewFiles]);
    setMessage("");
    setIsUploading(true);
    setReportReady(false);

    try {
      const results = [];

      for (const file of allowedNewFiles) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("http://127.0.0.1:8000/parse-offer-file", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        results.push({
          id: data.id || `${file.name}-${Date.now()}`,
          fileName: data.fileName || file.name,
          sourceType: data.sourceType || "unknown",
          rows: data.rows || [],
          error: data.error || "",
        });
      }

      setParsedSources((prev) => [...prev, ...results]);

      const totalRows = results.reduce((sum, item) => sum + (item.rows?.length || 0), 0);

      if (totalRows > 0) {
        setMessage(`Dosyalar yüklendi. ${allowedNewFiles.length} yeni dosya işlendi.`);
      } else {
        setMessage("Dosyalar yüklendi ama analiz edilebilir satır bulunamadı.");
      }
    } catch (error) {
      console.error(error);
      setMessage("Dosyalar işlenirken hata oluştu.");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleAnalyze = async () => {
    if (files.length === 0) {
      setMessage("Lütfen önce teklif dosyası yükleyin.");
      return;
    }

    if (allParsedRows.length === 0) {
      setMessage("Yüklenen dosyalardan analiz edilebilir veri çıkarılamadı.");
      return;
    }

    setIsAnalyzing(true);
    setReportReady(false);

    try {
      const response = await fetch("http://127.0.0.1:8000/compare-offers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rows: allParsedRows,
          exchangeRates,
        }),
      });

      const data = await response.json();

      if (data.comparisonRows?.length || data.recommendedRows?.length) {
        setReportReady(true);
        setLastReportTime(new Date().toLocaleString("tr-TR"));
        setMessage("Teklifler analiz edildi ve karşılaştırma raporu oluşturuldu.");
      } else {
        setMessage("Rapor oluşturulamadı.");
      }
    } catch (error) {
      console.error(error);
      setMessage("Teklif analizi sırasında hata oluştu.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDownloadReport = async () => {
  if (!reportReady || allParsedRows.length === 0) return;

  try {
    const response = await fetch("http://127.0.0.1:8000/export-comparison-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rows: allParsedRows,
        exchangeRates,
      }),
    });

    if (!response.ok) {
      throw new Error("Rapor indirilemedi.");
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "teklif_karsilastirma_raporu.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error(error);
    setMessage("Rapor indirilirken hata oluştu.");
  }
};



  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold text-slate-800">Teklif Karşılaştırma</h1>
          <p className="mt-2 text-sm text-slate-600">
            Excel, PDF veya görsel teklif dosyalarını yükleyin. Sistem analiz ederek karşılaştırma raporu oluşturacaktır.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800">Dosya Yükleme</h2>
          <p className="mt-2 text-sm text-slate-600">
            En fazla 15 teklif dosyası yükleyebilirsiniz.
          </p>

          <div className="mt-4 rounded-2xl border border-dashed border-blue-300 bg-slate-50 p-8 text-center">
            <input
              type="file"
              multiple
              accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg"
              onChange={handleFileUpload}
              className="mx-auto block w-full max-w-xl rounded-xl border border-slate-300 bg-white p-3"
            />
            <p className="mt-3 text-sm text-slate-500">
              Desteklenen formatlar: .xlsx, .xls, .pdf, .png, .jpg, .jpeg
            </p>
          </div>

          {isUploading && (
            <p className="mt-3 text-sm text-blue-600">Dosyalar işleniyor...</p>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800">Yüklenen Dosyalar</h2>

          <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
              <div className="text-sm text-slate-500">Dosya Yüklendi</div>
              <div className="mt-1 text-4xl font-bold text-blue-700">{files.length}</div>
              <div className="text-sm text-slate-500">
                Toplam {files.length} dosya başarıyla yüklendi.
              </div>
            </div>

            {files.length > 0 && (
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700"
                onClick={() => {
                  const names = files.map((f) => f.name).join("\n");
                  alert(names);
                }}
              >
                Dosya Listesini Gör
              </button>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800">Kur Bilgileri</h2>
          <p className="mt-2 text-sm text-slate-600">
            Dövizli teklifler varsa kur bilgilerini giriniz. Boş bırakılan kurlar için mevcut değerler kullanılacaktır.
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            {["USD", "EUR", "GBP"].map((currency) => (
              <div key={currency}>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  {currency} Kuru (TRY)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={exchangeRates[currency]}
                  onChange={(e) =>
                    setExchangeRates((prev) => ({
                      ...prev,
                      [currency]: Number(e.target.value),
                    }))
                  }
                  className="w-full rounded-xl border border-slate-300 p-3"
                />
              </div>
            ))}
          </div>

          {hasForeignCurrency && (
            <div className="mt-4">
              <InfoBox
                title="Bilgilendirme"
                text="Yüklenen teklifler arasında dövizli kalemler tespit edildi. Lütfen kur bilgilerini kontrol ediniz."
                tone="yellow"
              />
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-800">Rapor Oluşturma</h2>

          <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-2xl font-bold text-slate-800">
                {reportReady ? "Analiz Tamamlandı" : "Rapor Bekleniyor"}
              </div>
              <div className="mt-2 text-sm text-slate-600">
                {reportReady
                  ? "Teklifler analiz edildi ve karşılaştırma raporu oluşturuldu."
                  : "Dosyaları yükleyip analiz başlattığınızda rapor hazır olacaktır."}
              </div>
              {lastReportTime && (
                <div className="mt-2 text-sm text-slate-500">
                  Rapor tarihi: {lastReportTime}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 md:w-80">
              <button
                type="button"
                onClick={handleAnalyze}
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800"
              >
                {isAnalyzing ? "Analiz Yapılıyor..." : "Teklifleri Analiz Et"}
              </button>

              <button
                type="button"
                onClick={handleDownloadReport}
                disabled={!reportReady}
                className={`rounded-xl px-5 py-3 text-sm font-medium ${
                  reportReady
                    ? "bg-green-600 text-white hover:bg-green-700"
                    : "cursor-not-allowed bg-slate-200 text-slate-500"
                }`}
              >
                Raporu İndir
              </button>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-500">
            Rapor içeriğinde ürün karşılaştırmaları, en avantajlı firma önerileri ve icmal bilgileri yer alacaktır.
          </p>
        </div>

        {message && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            {message}
          </div>
        )}
      </div>
    </div>
  );
}