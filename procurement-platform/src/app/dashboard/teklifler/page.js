"use client";

import { useEffect, useMemo, useState } from "react";

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

function Sidebar() {
  const menu = [
    { name: "Dashboard", icon: "🏠", href: "/dashboard" },
    { name: "Talepler", icon: "📚", href: "/dashboard/talepler" },
    { name: "Teklifler", icon: "📊", href: "/dashboard/teklifler", active: true },
    { name: "Raporlar", icon: "📄", href: "/dashboard/raporlar" },
    { name: "Siparişler", icon: "🛒", href: "/dashboard/siparisler" },
    { name: "Tedarikçiler", icon: "🏢", href: "/dashboard/tedarikciler" },
    { name: "Ayarlar", icon: "⚙️", href: "/dashboard/ayarlar" },
  ];

  return (
    <aside className="hidden min-h-screen w-72 shrink-0 border-r border-slate-200 bg-white p-5 lg:block">
      <div className="rounded-2xl bg-slate-900 p-5 text-white">
        <div className="text-xl font-bold">Procurement AI</div>
        <div className="mt-1 text-sm text-slate-300">Satınalma analiz paneli</div>
      </div>

      <nav className="mt-6 space-y-2">
        {menu.map((item) => (
          <button
            key={item.name}
            onClick={() => {
              window.location.href = item.href;
            }}
            className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-all hover:scale-[1.01] ${
              item.active
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            {item.name}
          </button>
        ))}
      </nav>

      <div className="mt-8 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="font-bold">Akıllı Mukayese</div>
        <p className="mt-1">
          Teklifleri fiyat, vade, termin ve adet uygunluğuna göre karşılaştırın.
        </p>
      </div>
    </aside>
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
  const [reportPath, setReportPath] = useState("");
  const [requestLists, setRequestLists] = useState([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [minVadeDays, setMinVadeDays] = useState("");
  const [maxTerminDays, setMaxTerminDays] = useState("");
  const [allowMissingQty, setAllowMissingQty] = useState(false);
  const [createdReportId, setCreatedReportId] = useState(null);
  const [analysisMode, setAnalysisMode] = useState("withRequest");
  const [annualInterestRate, setAnnualInterestRate] = useState(45);
  const [creditUsage, setCreditUsage] = useState("sometimes");
  const [cashFlowImportance, setCashFlowImportance] = useState("medium");
  const [paymentTermImportance, setPaymentTermImportance] = useState("high");
  const [paymentHabit, setPaymentHabit] = useState("60_90");
  const [criticalLevel, setCriticalLevel] = useState("medium");
  const [delayImpact, setDelayImpact] = useState("medium");
  const [alternativeStock, setAlternativeStock] = useState("partial");
  const [shippingIncluded, setShippingIncluded] = useState("included");
  const [shippingCost, setShippingCost] = useState("");
  const [supplierTrust, setSupplierTrust] = useState("medium");
  const [qualityHistory, setQualityHistory] = useState("unknown");
  const [currencyRisk, setCurrencyRisk] = useState("medium");

  const [exchangeRates, setExchangeRates] = useState({
    TRY: 1,
    USD: 39.2,
    EUR: 42.8,
    GBP: 41.2,
  });

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("talepListeleri") || "[]");
    setRequestLists(stored);

    if (stored.length > 0) {
      setSelectedRequestId(String(stored[0].id));
    }
  }, []);

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

  const selectedRequest = useMemo(() => {
    return requestLists.find((item) => String(item.id) === String(selectedRequestId));
  }, [requestLists, selectedRequestId]);

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
    setReportReady(false);
    e.target.value = "";
  };

  const calculateAnnualInterestRate = () => {
  let score = 0;

  if (creditUsage === "none") score += 5;
  if (creditUsage === "sometimes") score += 15;
  if (creditUsage === "often") score += 25;

  if (cashFlowImportance === "low") score += 5;
  if (cashFlowImportance === "medium") score += 15;
  if (cashFlowImportance === "high") score += 25;

  if (paymentTermImportance === "low") score += 5;
  if (paymentTermImportance === "medium") score += 15;
  if (paymentTermImportance === "high") score += 25;

  if (paymentHabit === "cash") score += 5;
  if (paymentHabit === "30_60") score += 10;
  if (paymentHabit === "60_90") score += 15;
  if (paymentHabit === "long") score += 20;

  if (score <= 25) return 25;
  if (score <= 45) return 35;
  if (score <= 65) return 45;
  return 60;
  };

  const handleAnalyze = async () => {
    if (analysisMode === "withRequest" && !selectedRequest) {
      setMessage("Lütfen önce bir talep listesi seçin veya talep olmadan karşılaştırma modunu seçin.");
      return;
    }

    if (files.length === 0) {
      setMessage("Lütfen önce teklif dosyası yükleyin.");
      return;
    }

    setIsAnalyzing(true);
    setReportReady(false);
    setMessage("");

    try {
      const formData = new FormData();

      if (analysisMode === "withRequest" && selectedRequest) {
        formData.append("request_report_path", selectedRequest.reportPath);
        formData.append("request_file_name", selectedRequest.fileName);
      } else {
        formData.append("request_report_path", "");
        formData.append("request_file_name", "Talep Olmadan Teklif Karşılaştırma");
      }

      files.forEach((file) => {
        formData.append("files", file);
      });

      formData.append("firma_adlari_text", "A Firması,B Firması,C Firması");
      formData.append("max_budget", maxBudget);
      formData.append("min_vade_days", minVadeDays);
      formData.append("max_termin_days", maxTerminDays);
      formData.append("allow_missing_qty", allowMissingQty ? "true" : "false");
      formData.append("annual_interest_rate", calculateAnnualInterestRate());

      formData.append("critical_level", criticalLevel);
      formData.append("delay_impact", delayImpact);
      formData.append("alternative_stock", alternativeStock);

      formData.append("shipping_included", shippingIncluded);
      formData.append("shipping_cost", shippingCost);

      formData.append("supplier_trust", supplierTrust);
      formData.append("quality_history", qualityHistory);

      formData.append("currency_risk", currencyRisk);
      const response = await fetch("http://127.0.0.1:8000/analyze-offers", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      console.log("ANALİZ CEVABI:", data);

      if (data.success) {
        setReportReady(true);
        setReportPath(`http://127.0.0.1:8000${data.reportPath}`);
        setCreatedReportId(data.reportId || null);
        setLastReportTime(new Date().toLocaleString("tr-TR"));
        setMessage("Mukayese raporu oluşturuldu ve Raporlar sayfasına aktarıldı.");
      } else {
        setMessage(data.warnings?.join(" | ") || "Rapor oluşturulamadı.");
      }
    } catch (error) {
      console.error(error);
      setMessage("Teklif analizi sırasında hata oluştu.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDownloadReport = () => {
    if (!reportReady || !reportPath) {
      setMessage("İndirilecek rapor bulunamadı.");
      return;
    }

    const link = document.createElement("a");
    link.href = reportPath;
    link.download = "mukayese_raporu.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
  <div className="flex min-h-screen bg-slate-100">
    <Sidebar />

    <main className="flex-1 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
              Teklif Yönetimi
            </div>

            <h1 className="mt-3 text-4xl font-bold text-slate-900">
              Teklif Karşılaştırma
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Excel, PDF veya görsel teklif dosyalarını yükleyin. Sistem teklifleri talep listesine göre analiz ederek mukayese raporu oluşturur.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm text-slate-500">Rapor Durumu</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {reportReady ? "Hazır ✅" : "Bekliyor"}
            </div>
            <div className="text-xs text-slate-500">
              {lastReportTime || "Henüz analiz yapılmadı"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard icon="📎" title="Yüklenen Teklif" value={files.length} text="Dosya seçildi" />

          <StatCard
            icon="📚"
            title="Talep Listesi"
            value={analysisMode === "withRequest" ? (selectedRequest ? "Seçildi" : "Yok") : "Yok"}
            text={analysisMode === "withRequest" ? "Talebe göre analiz" : "Manuel analiz"}
          />

          <StatCard
            icon="💱"
            title="Kur Kontrolü"
            value={hasForeignCurrency ? "Gerekli" : "Standart"}
            text="TRY / USD / EUR / GBP"
          />

          <StatCard
            icon="📄"
            title="Rapor"
            value={reportReady ? "Oluştu" : "Bekliyor"}
            text="Mukayese çıktısı"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Talep Kullanımı</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Teklifleri mevcut talep listesine göre veya talep olmadan kendi içinde karşılaştırabilirsiniz.
                  </p>
                </div>

                <span className="rounded-full bg-purple-100 px-4 py-2 text-xs font-bold text-purple-700">
                  Analiz Modu
                </span>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setAnalysisMode("withRequest")}
                  className={`rounded-2xl border px-5 py-4 text-left text-sm font-bold transition-all hover:scale-[1.01] ${
                    analysisMode === "withRequest"
                      ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="text-lg">📚 Talep Listesiyle Analiz</div>
                  <div className={`mt-1 text-xs ${analysisMode === "withRequest" ? "text-blue-100" : "text-slate-500"}`}>
                    Teklifleri seçilen talep listesine göre karşılaştırır.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAnalysisMode("withoutRequest");
                    setSelectedRequestId("");
                  }}
                  className={`rounded-2xl border px-5 py-4 text-left text-sm font-bold transition-all hover:scale-[1.01] ${
                    analysisMode === "withoutRequest"
                      ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <div className="text-lg">⚡ Talep Olmadan Analiz</div>
                  <div className={`mt-1 text-xs ${analysisMode === "withoutRequest" ? "text-slate-300" : "text-slate-500"}`}>
                    Teklifleri ürün kodu ve açıklama benzerliğine göre gruplar.
                  </div>
                </button>
              </div>

              {analysisMode === "withRequest" ? (
                <>
                  <select
                    value={selectedRequestId}
                    onChange={(e) => setSelectedRequestId(e.target.value)}
                    className="mt-5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
                  >
                    <option value="">Talep listesi seçin</option>
                    {requestLists.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.createdAt} - {item.fileName}
                      </option>
                    ))}
                  </select>

                  {selectedRequestId && (
                    <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                      Talep listesi seçildi ✅ Bu liste teklif analizinde referans alınacak.
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
                  Talep listesi seçilmeden analiz yapılacak. Sistem teklifleri kendi içinde ürün kodu ve açıklama benzerliğine göre gruplandıracaktır.
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-800">Teklif Dosyalarını Yükle</h2>
              <p className="mt-2 text-sm text-slate-600">
                En fazla 15 teklif dosyası yükleyebilirsiniz.
              </p>

              <div className="mt-5 rounded-3xl border border-dashed border-blue-300 bg-blue-50/40 p-8 text-center">
                <div className="text-4xl">📎</div>
                <div className="mt-2 text-lg font-bold text-slate-800">
                  Dosyaları seçin veya sürükleyin
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Excel, PDF, PNG, JPG ve JPEG desteklenir.
                </p>

                <input
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg"
                  onChange={handleFileUpload}
                  className="mx-auto mt-5 block w-full max-w-xl rounded-xl border border-slate-300 bg-white p-3"
                />
              </div>

              {files.length > 0 && (
                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {files.map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div>
                        <div className="font-bold text-slate-800">📄 {file.name}</div>
                        <div className="text-xs text-slate-500">
                          {(file.size / 1024).toFixed(1)} KB
                        </div>
                      </div>

                      <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
                        Hazır
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {isUploading && (
                <p className="mt-3 text-sm text-blue-600">Dosyalar işleniyor...</p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-800">Satınalma Kriterleri</h2>
              <p className="mt-2 text-sm text-slate-600">
                Rapor karar notlarında kullanılacak bütçe, vade ve termin sınırlarını girin.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">
                    Maksimum Bütçe
                  </label>
                  <input
                    type="number"
                    placeholder="Örn: 50000"
                    value={maxBudget}
                    onChange={(e) => setMaxBudget(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">
                    Minimum Vade
                  </label>
                  <input
                    type="number"
                    placeholder="Örn: 60 gün"
                    value={minVadeDays}
                    onChange={(e) => setMinVadeDays(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">
                    Maksimum Termin
                  </label>
                  <input
                    type="number"
                    placeholder="Örn: 6 gün"
                    value={maxTerminDays}
                    onChange={(e) => setMaxTerminDays(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm"
                  />
                </div>
              </div>

              <label className="mt-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={allowMissingQty}
                  onChange={(e) => setAllowMissingQty(e.target.checked)}
                />
                Eksik adet kabul et
              </label>

              <div className="mt-8 border-t border-slate-200 pt-6">
                <h3 className="text-xl font-bold text-slate-800">
                  Finansman Profili
                </h3>

                <p className="mt-2 text-sm text-slate-500">
                  Sistem, şirketinizin ödeme ve nakit yapısına göre yıllık finansman oranını otomatik hesaplar.
                </p>

                <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-bold text-slate-700">
                        Şirket kredi / finansman kullanıyor mu?
                      </label>
                      <select
                        value={creditUsage}
                        onChange={(e) => setCreditUsage(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 p-3"
                      >
                        <option value="none">Hayır</option>
                        <option value="sometimes">Ara sıra</option>
                        <option value="often">Sık kullanıyoruz</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-bold text-slate-700">
                        Nakit akışı sizin için ne kadar kritik?
                      </label>
                      <select
                        value={cashFlowImportance}
                        onChange={(e) => setCashFlowImportance(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 p-3"
                      >
                        <option value="low">Çok kritik değil</option>
                        <option value="medium">Orta önemli</option>
                        <option value="high">Kritik</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-bold text-slate-700">
                        Uzun ödeme vadeleri sizin için önemli mi?
                      </label>
                      <select
                        value={paymentTermImportance}
                        onChange={(e) => setPaymentTermImportance(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 p-3"
                      >
                        <option value="low">Çok önemli değil</option>
                        <option value="medium">Dengeli önemli</option>
                        <option value="high">Çok önemli</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-bold text-slate-700">
                        Ödemelerinizi genelde nasıl yapıyorsunuz?
                      </label>
                      <select
                        value={paymentHabit}
                        onChange={(e) => setPaymentHabit(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 p-3"
                      >
                        <option value="cash">Peşin / kısa vade</option>
                        <option value="30_60">30 - 60 gün</option>
                        <option value="60_90">60 - 90 gün</option>
                        <option value="long">Mümkün olduğunca uzun vade</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-5 rounded-xl border border-blue-200 bg-white p-4 text-sm font-bold text-blue-900">
                    Hesaplanan yıllık finansman oranı: %{calculateAnnualInterestRate()}
                  </div>
                </div>
              </div>

              <div className="mt-8 border-t border-slate-200 pt-6">
                <h3 className="text-xl font-bold text-slate-800">
                  TCO Risk Analizi
                </h3>

                <p className="mt-2 text-sm text-slate-500">
                  Sistem TCO, risk maliyeti ve değerlendirilmiş maliyet hesaplarını bu bilgilerle oluşturur.
                </p>

                <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Ürün Kritiklik Seviyesi
                    </label>
                    <select
                      value={criticalLevel}
                      onChange={(e) => setCriticalLevel(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 p-3"
                    >
                      <option value="low">Kritik değil</option>
                      <option value="medium">Orta kritik</option>
                      <option value="high">Üretimi etkiler</option>
                      <option value="critical">Operasyonu durdurabilir</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Geç Teslim Etkisi
                    </label>
                    <select
                      value={delayImpact}
                      onChange={(e) => setDelayImpact(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 p-3"
                    >
                      <option value="none">Etkilemez</option>
                      <option value="low">Küçük gecikme</option>
                      <option value="medium">İş kaybı olabilir</option>
                      <option value="high">Operasyon durabilir</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Alternatif Stok Durumu
                    </label>
                    <select
                      value={alternativeStock}
                      onChange={(e) => setAlternativeStock(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 p-3"
                    >
                      <option value="full">Yeterli stok var</option>
                      <option value="partial">Kısmen var</option>
                      <option value="none">Stok yok</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Nakliye Durumu
                    </label>
                    <select
                      value={shippingIncluded}
                      onChange={(e) => setShippingIncluded(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 p-3"
                    >
                      <option value="included">Nakliye dahil</option>
                      <option value="excluded">Nakliye hariç</option>
                      <option value="unknown">Emin değilim</option>
                    </select>
                  </div>

                  {shippingIncluded === "excluded" && (
                    <div>
                      <label className="mb-2 block text-sm font-bold text-slate-700">
                        Tahmini Nakliye Maliyeti
                      </label>
                      <input
                        type="number"
                        value={shippingCost}
                        onChange={(e) => setShippingCost(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 p-3"
                      />
                    </div>
                  )}

                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Tedarikçi Güven Seviyesi
                    </label>
                    <select
                      value={supplierTrust}
                      onChange={(e) => setSupplierTrust(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 p-3"
                    >
                      <option value="low">İlk kez çalışıyoruz</option>
                      <option value="medium">Birkaç kez çalıştık</option>
                      <option value="high">Uzun süredir çalışıyoruz</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Kalite Geçmişi
                    </label>
                    <select
                      value={qualityHistory}
                      onChange={(e) => setQualityHistory(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 p-3"
                    >
                      <option value="unknown">Bilinmiyor</option>
                      <option value="good">Problem yaşanmadı</option>
                      <option value="medium">Ara sıra yaşandı</option>
                      <option value="bad">Sık yaşandı</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      Kur Riski
                    </label>
                    <select
                      value={currencyRisk}
                      onChange={(e) => setCurrencyRisk(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 p-3"
                    >
                      <option value="none">Kur riski yok</option>
                      <option value="low">Düşük</option>
                      <option value="medium">Orta</option>
                      <option value="high">Yüksek</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-800">Kur Bilgileri</h2>
              <p className="mt-2 text-sm text-slate-600">
                Dövizli teklifler varsa kur bilgilerini kontrol edin.
              </p>

              <div className="mt-5 space-y-4">
                {["USD", "EUR", "GBP"].map((currency) => (
                  <div key={currency}>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      {currency} Kuru
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
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-800">Analiz Durumu</h2>

              <div className="mt-5 rounded-2xl bg-slate-50 p-5">
                <div className="text-2xl font-bold text-slate-900">
                  {reportReady ? "Analiz Tamamlandı" : "Rapor Bekleniyor"}
                </div>

                <p className="mt-2 text-sm text-slate-600">
                  {reportReady
                    ? "Teklifler analiz edildi ve mukayese raporu oluşturuldu."
                    : "Dosyaları yükleyip analiz başlattığınızda rapor hazır olacaktır."}
                </p>

                {lastReportTime && (
                  <div className="mt-3 text-sm text-slate-500">
                    Rapor tarihi: {lastReportTime}
                  </div>
                )}
              </div>

              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  className="w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white transition-all hover:scale-[1.01] hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isAnalyzing ? "Analiz Yapılıyor..." : "Teklifleri Analiz Et"}
                </button>

                <button
                  type="button"
                  onClick={handleDownloadReport}
                  disabled={!reportReady}
                  className={`w-full rounded-xl px-5 py-3 text-sm font-bold transition-all ${
                    reportReady
                      ? "bg-green-600 text-white hover:scale-[1.01] hover:bg-green-700"
                      : "cursor-not-allowed bg-slate-200 text-slate-500"
                  }`}
                >
                  Raporu İndir
                </button>
              </div>
            </section>

            {message && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700 shadow-sm">
                {message}
              </div>
            )}
          </div>
        </div>

        {createdReportId && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-sm text-green-900 shadow-sm">
            <div className="text-lg font-bold">
              Mukayese raporu Raporlar sayfasına aktarıldı ✅
            </div>

            <p className="mt-2">
              Raporu incelemek, indirmek veya siparişe çevirmek için devam edebilirsiniz.
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  window.location.href = `/dashboard/raporlar/${createdReportId}`;
                }}
                className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700"
              >
                Rapor Detayına Git
              </button>

              <button
                type="button"
                onClick={() => {
                  window.location.href = "/dashboard/raporlar";
                }}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
              >
                Tüm Raporları Gör
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  </div>
);
}
