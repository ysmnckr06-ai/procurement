"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { findOrCreateBusinessPartner } from "@/lib/businessPartners";
import { formatMoney } from "@/lib/currency";
import { fetchLiveTryRates, liveCurrencyOptions, liveRateFor } from "@/lib/liveCurrency";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const defaultCompanySettings = {
  default_currency: "TRY",
  base_currency: "TRY",
  usd_rate: 39.2,
  eur_rate: 42.8,
  gbp_rate: 41.2,
  annual_interest_rate: 45,
  accepted_termin_days: 15,
  daily_delay_cost_try: 0,
  missing_data_policy: "manual_review",
  critical_level: "medium",
  delay_impact: "medium",
  alternative_stock: "partial",
  shipping_included: "included",
  supplier_trust: "medium",
  quality_history: "unknown",
  currency_risk: "medium",
  max_file_size_mb: 10,
  max_offer_files: 15,
  default_payment_term: "60 gün",
  risk_level: "Orta",
  approval_required: true,
};

const OFFER_FILE_EXTENSIONS = [".xlsx", ".xls", ".pdf", ".png", ".jpg", ".jpeg", ".webp"];
const OFFER_FILE_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const OFFER_POOL_STATUSES = [
  "İşleme alındı",
  "İşlemde",
  "Teklif Toplanıyor",
  "Teklifler Geldi",
  "Rapor Oluşturuldu",
];

function getOfferRequestItems(request) {
  if (Array.isArray(request?.items)) return request.items;
  if (typeof request?.items === "string" && request.items.trim()) {
    try {
      const parsed = JSON.parse(request.items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getOfferRequestMeta(request) {
  return getOfferRequestItems(request).find((item) => item?.request_meta)?.request_meta || {};
}

function requestSequenceLabel(index, total) {
  return `TLB-${String(Math.max(total - index, 1)).padStart(5, "0")}`;
}

function offerPoolStatusLabel(status) {
  if (["İşleme alındı", "İşlemde"].includes(status)) return "İşlemde";
  return status || "İşlemde";
}

function offerFileExtension(fileName = "") {
  const normalized = String(fileName || "").toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex >= 0 ? normalized.slice(dotIndex) : "";
}

function isOfferSpreadsheet(file) {
  return [".xlsx", ".xls"].includes(offerFileExtension(file?.name));
}

async function validateOfferWorkbook(file) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const visibleSheets = (workbook.SheetNames || []).filter((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) return false;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    return rows.some((row) =>
      Array.isArray(row) &&
      row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "")
    );
  });

  return visibleSheets.length > 0;
}

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

function collectPartnerNames(value, found = new Set()) {
  if (!value) return found;

  if (Array.isArray(value)) {
    value.forEach((item) => {
      collectPartnerNames(item, found);
    });
    return found;
  }

  if (typeof value !== "object") return found;

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = String(key || "").toLocaleLowerCase("tr-TR");
    const looksLikeCompanyKey =
      normalizedKey.includes("firma") ||
      normalizedKey.includes("supplier") ||
      normalizedKey.includes("company") ||
      normalizedKey.includes("tedarik");

    if (looksLikeCompanyKey && typeof item === "string" && item.trim().length > 1) {
      found.add(item.trim());
    }

    if (typeof item === "object") collectPartnerNames(item, found);
  }

  return found;
}


export default function TekliflerPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Yükleniyor...</div>}>
      <TekliflerPageContent />
    </Suspense>
  );
}

function TekliflerPageContent() {
  const searchParams = useSearchParams();
  const requestIdFromUrl = searchParams.get("requestId");
  const projectIdFromUrl = searchParams.get("projectId");
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
  const [companySettings, setCompanySettings] = useState(defaultCompanySettings);
  const [liveRates, setLiveRates] = useState(null);
  const [liveRateWarning, setLiveRateWarning] = useState("");

  const [exchangeRates, setExchangeRates] = useState({
    TRY: 1,
    USD: 39.2,
    EUR: 42.8,
    GBP: 41.2,
  });

  useEffect(() => {
    loadRequests();
    loadCompanySettings();
  }, []);

  const maxOfferFiles = Number(companySettings.max_offer_files || 15);
  const maxFileSizeMb = Number(companySettings.max_file_size_mb || 10);

const loadRequests = async () => {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.href = "/login";
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

    const allRequests = data || [];
    // Talepler ekranı birleşik işlem kayıtlarını sıra numarasına dahil etmez.
    // Aynı listeyi baz alarak iki ekranda da TLB numarasını sabit tutuyoruz.
    const numberedRequests = allRequests.filter(
      (request) => getOfferRequestMeta(request).source !== "merged-process",
    );
    const requestNumberById = new Map(
      numberedRequests.map((request, index) => [
        String(request.id),
        requestSequenceLabel(index, numberedRequests.length),
      ]),
    );

    const offerPoolRequests = allRequests
      .filter((request) => OFFER_POOL_STATUSES.includes(request.durum))
      .filter((request) => !getOfferRequestMeta(request).mergedIntoRequestId)
      .map((request) => {
        const meta = getOfferRequestMeta(request);
        const sourceNumbers = (Array.isArray(meta.sourceRequestIds) ? meta.sourceRequestIds : [])
          .map((id) => requestNumberById.get(String(id)))
          .filter(Boolean);
        return {
          ...request,
          requestNumberLabel: requestNumberById.get(String(request.id)) || sourceNumbers.join(" + ") || "Birleşik Talep",
        };
      });
    setRequestLists(offerPoolRequests);

    if (requestIdFromUrl && offerPoolRequests.some((request) => String(request.id) === String(requestIdFromUrl))) {
      setSelectedRequestId(String(requestIdFromUrl));
    } else if (offerPoolRequests.length > 0) {
      setSelectedRequestId(String(offerPoolRequests[0].id));
    } else {
      setSelectedRequestId("");
    }
  } catch (err) {
    console.error(err);
  }
};

const loadCompanySettings = async () => {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { data, error } = await supabase
      .from("company_settings")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    if (error || !data?.[0]) return;

    const nextSettings = {
      ...defaultCompanySettings,
      ...data[0],
    };

    setCompanySettings(nextSettings);
    setAnnualInterestRate(Number(nextSettings.annual_interest_rate || 45));
    setMaxTerminDays(String(nextSettings.accepted_termin_days ?? 15));
    setCriticalLevel(nextSettings.critical_level || "medium");
    setDelayImpact(nextSettings.delay_impact || "medium");
    setAlternativeStock(nextSettings.alternative_stock || "partial");
    setShippingIncluded(nextSettings.shipping_included || "included");
    setSupplierTrust(nextSettings.supplier_trust || "medium");
    setQualityHistory(nextSettings.quality_history || "unknown");
    setCurrencyRisk(nextSettings.currency_risk || "medium");
    setExchangeRates({
      TRY: 1,
      USD: Number(nextSettings.usd_rate || 39.2),
      EUR: Number(nextSettings.eur_rate || 42.8),
      GBP: Number(nextSettings.gbp_rate || 41.2),
    });
  } catch (err) {
    console.error(err);
  } finally {
    await loadLiveExchangeRates();
  }
};

  const loadLiveExchangeRates = async () => {
    try {
      const live = await fetchLiveTryRates();
      setLiveRates(live);
      setLiveRateWarning("");
      setExchangeRates((prev) => ({
        ...prev,
        TRY: 1,
        ...Object.fromEntries(
          liveCurrencyOptions.map((currency) => [
            currency,
            liveRateFor(currency, live) || Number(prev[currency] || defaultCompanySettings[`${currency.toLowerCase()}_rate`]),
          ]),
        ),
      }));
    } catch (error) {
      console.error(error);
      setLiveRates(null);
      setLiveRateWarning("Canlı kur alınamadı. Kayıtlı kur veya manuel değer kullanılacak.");
    }
  };

  const allParsedRows = useMemo(() => {
    return parsedSources.flatMap((item) => item.rows || []);
  }, [parsedSources]);

  const detectedCurrencies = useMemo(() => {
    const currencies = new Set();

    allParsedRows.forEach((row) => {
      const raw = String(row?.paraBirimi || "").trim().toUpperCase();
      if (raw) {
        if (raw === "₺" || raw === "TL") {
          currencies.add("TRY");
        } else {
          currencies.add(raw);
        }
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
    await addOfferFiles(uploadedFiles, () => {
      e.target.value = "";
    });
  };

  const handleDropFiles = async (event) => {
    event.preventDefault();
    const uploadedFiles = Array.from(event.dataTransfer?.files || []);
    await addOfferFiles(uploadedFiles);
  };

  const addOfferFiles = async (uploadedFiles, resetInput = () => {}) => {
    if (uploadedFiles.length === 0) return;

    const invalidTypeFile = uploadedFiles.find((file) => {
      const extension = offerFileExtension(file.name);
      const mimeType = String(file.type || "").trim();
      return !OFFER_FILE_EXTENSIONS.includes(extension) || (mimeType && !OFFER_FILE_MIME_TYPES.has(mimeType));
    });

    if (invalidTypeFile) {
      setMessage(`${invalidTypeFile.name} desteklenmiyor. Excel, PDF veya görsel teklif dosyası yükleyin.`);
      resetInput();
      return;
    }

    const emptyFile = uploadedFiles.find((file) => file.size <= 0);

    if (emptyFile) {
      setMessage(`${emptyFile.name} boş görünüyor. İçinde veri olan bir teklif dosyası yükleyin.`);
      resetInput();
      return;
    }

    const oversizedFile = uploadedFiles.find((file) => file.size > maxFileSizeMb * 1024 * 1024);

    if (oversizedFile) {
      setMessage(`${oversizedFile.name} dosyası ${maxFileSizeMb} MB sınırını aşıyor.`);
      resetInput();
      return;
    }

    try {
      for (const file of uploadedFiles) {
        if (!isOfferSpreadsheet(file)) continue;
        const hasRows = await validateOfferWorkbook(file);
        if (!hasRows) {
          setMessage(`${file.name} içinde okunabilir teklif satırı bulunamadı.`);
          resetInput();
          return;
        }
      }
    } catch (error) {
      console.error(error);
      setMessage("Dosya okunamadı. Lütfen geçerli bir Excel, PDF veya görsel teklif dosyası yükleyin.");
      resetInput();
      return;
    }

    const currentCount = files.length;
    const remaining = Math.max(0, maxOfferFiles - currentCount);
    const allowedNewFiles = uploadedFiles.slice(0, remaining);

    if (allowedNewFiles.length === 0) {
      setMessage(`En fazla ${maxOfferFiles} dosya yükleyebilirsiniz.`);
      return;
    }

    setFiles((prev) => [...prev, ...allowedNewFiles]);
    setMessage("");
    setReportReady(false);
    resetInput();
  };

  const calculateAnnualInterestRate = () => annualInterestRate;

  const handleAnalyze = async () => {
    if (files.length === 0) {
      setMessage("Lütfen önce teklif dosyası yükleyin.");
      return;
    };

    setIsAnalyzing(true);
    setReportReady(false);
    setMessage("");

    let timeoutId;

    try {
      const formData = new FormData();

      if (analysisMode === "withRequest" && selectedRequest) {
        const selectedRequestItems = (() => {
          if (Array.isArray(selectedRequest.items)) return selectedRequest.items;
          if (typeof selectedRequest.items === "string" && selectedRequest.items.trim()) {
            try {
              const parsed = JSON.parse(selectedRequest.items);
              return Array.isArray(parsed) ? parsed : [];
            } catch (error) {
              console.warn("Seçili talep kalemleri okunamadı:", error);
            }
          }
          return [];
        })();

        formData.append(
          "request_report_path",
          selectedRequest.filepath ||
            selectedRequest.fileName ||
            selectedRequest.reportPath ||
            ""
        );
        formData.append(
          "request_file_name",
          selectedRequest.fileName ||
            selectedRequest.filepath ||
            selectedRequest.ad ||
            "Talep Listesi"
        );
        formData.append("request_items_json", JSON.stringify(selectedRequestItems));
      } else {
        formData.append("request_report_path", "");
        formData.append("request_file_name", "Talep Olmadan Teklif Karşılaştırma");
        formData.append("request_items_json", "[]");
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
      formData.append("daily_delay_cost", Number(companySettings.daily_delay_cost_try || 0));
      formData.append("missing_data_policy", companySettings.missing_data_policy || "manual_review");

      formData.append("critical_level", criticalLevel);
      formData.append("delay_impact", delayImpact);
      formData.append("alternative_stock", alternativeStock);

      formData.append("shipping_included", shippingIncluded);
      formData.append("shipping_cost", shippingCost);

      formData.append("supplier_trust", supplierTrust);
      formData.append("quality_history", qualityHistory);

      formData.append("currency_risk", currencyRisk);
      const analysisExchangeRates = {
        TRY: 1,
        ...Object.fromEntries(liveCurrencyOptions.map((currency) => [currency, Number(exchangeRates[currency])])),
      };
      const invalidRate = liveCurrencyOptions.find((currency) => !Number.isFinite(analysisExchangeRates[currency]) || analysisExchangeRates[currency] <= 0);
      if (invalidRate) {
        setMessage(`${invalidRate} analiz kuru 0'dan büyük olmalıdır.`);
        setIsAnalyzing(false);
        return;
      }
      formData.append("exchange_rates_json", JSON.stringify(analysisExchangeRates));
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const token = session?.access_token;

      if (!token) {
        setMessage("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        return;
      }
      if (!API_URL) {
        setMessage("API adresi bulunamadı. NEXT_PUBLIC_API_URL kontrol edilmeli.");
        return;
      }
      
      formData.append("request_id", selectedRequestId);
      formData.append("project_id", selectedRequest?.project_id || projectIdFromUrl || "");

      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), 120000);

      const response = await fetch(
        API_URL + "/analyze-offers",
        {
           method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
          signal: controller.signal,
        }
      );;
      window.clearTimeout(timeoutId);

      const data = await response.json();

      if (data.success) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const partnerNames = Array.from(collectPartnerNames(data));
        if (user && partnerNames.length > 0) {
          await Promise.all(
            partnerNames.map((name) =>
              findOrCreateBusinessPartner(supabase, user.id, {
                name,
                partnerType: "Tedarikçi",
                allowCreate: false,
              }),
            ),
          );
        }
        setReportReady(true);
        setReportPath(
          API_URL + data.reportPath
        );
        setCreatedReportId(data.reportId || null);
        setLastReportTime(new Date().toLocaleString("tr-TR"));
        setMessage("Mukayese raporu oluşturuldu ve Raporlar sayfasına aktarıldı.");
      } else {
        setMessage(data.warnings?.join(" | ") || "Rapor oluşturulamadı.");
      }
    } catch (error) {
      console.error(error);
      setMessage(
        error?.name === "AbortError"
          ? "Analiz çok uzun sürdü ve durduruldu. PDF dosyaları veya backend terminalindeki hata kontrol edilmeli."
          : "Teklif analizi sırasında hata oluştu."
      );
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      setIsAnalyzing(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!reportReady || !reportPath) {
      setMessage("İndirilecek rapor bulunamadı.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const token = session?.access_token;

    if (!token) {
      setMessage("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
      return;
    }

    try {
      const response = await fetch(reportPath, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        setMessage("Rapor indirilemedi.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "mukayese_raporu.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      setMessage("Rapor indirme sırasında hata oluştu.");
    }
  };

  return (
  <div className="bg-slate-100">

    <main className="p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
              Teklif Yönetimi
            </div>

            <h1 className="mt-3 text-4xl font-bold text-slate-900">
              Talep Bazlı Teklif Toplama
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Önce talep listesini seçin, sonra tedarikçilerden gelen teklif dosyalarını yükleyin. Sistem talep kalemlerine göre mukayese raporu oluşturur.
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
                  <h2 className="text-xl font-bold text-slate-800">Hangi talep için teklif topluyorsunuz?</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    ERP akışında önerilen yol: önce Talepler modülünden talep seçin, sonra birden fazla tedarikçi teklifini aynı talebe bağlayın.
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
                  <div className="text-lg">📚 Talebe Bağlı Analiz</div>
                  <div className={`mt-1 text-xs ${analysisMode === "withRequest" ? "text-blue-100" : "text-slate-500"}`}>
                    Teklifleri seçilen talep kalemleriyle eşleştirir.
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
                  <div className="text-lg">⚡ Serbest Teklif Analizi</div>
                  <div className={`mt-1 text-xs ${analysisMode === "withoutRequest" ? "text-slate-300" : "text-slate-500"}`}>
                    Talep kaydı yoksa teklifleri ürün kodu ve açıklama benzerliğine göre gruplar.
                  </div>
                </button>
              </div>

              {analysisMode === "withRequest" ? (
                <>
                  <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <div>
                        <div className="text-sm font-black text-slate-900">Teklif Talep Havuzu</div>
                        <div className="text-xs font-semibold text-slate-500">Yalnızca işleme alınmış talepler gösterilir.</div>
                      </div>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-700">
                        {requestLists.length} talep
                      </span>
                    </div>
                    {requestLists.length === 0 ? (
                      <div className="p-5 text-sm font-semibold text-slate-500">
                        Teklif bekleyen işleme alınmış talep yok. Önce Talepler modülünden talebi işleme alın.
                      </div>
                    ) : (
                      <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                        {requestLists.map((item, index) => {
                          const isSelected = String(item.id) === String(selectedRequestId);
                          const itemCount = Number(item.totalitems || getOfferRequestItems(item).length || 0);
                          return (
                            <label
                              key={item.id}
                              className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${
                                isSelected ? "bg-blue-50" : "hover:bg-slate-50"
                              }`}
                            >
                              <input
                                type="radio"
                                name="offer-request-pool"
                                value={item.id}
                                checked={isSelected}
                                onChange={(event) => setSelectedRequestId(event.target.value)}
                                className="h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-2 text-sm font-black text-slate-900">
                                  <span className="shrink-0 rounded-md bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                                    {item.requestNumberLabel}
                                  </span>
                                  <span className="truncate">{item.ad || `Talep #${index + 1}`}</span>
                                </span>
                                <span className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                                  <span>{itemCount} kalem</span>
                                  <span>{item.created_at ? new Date(item.created_at).toLocaleString("tr-TR") : "Tarih yok"}</span>
                                </span>
                              </span>
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-700">
                                {offerPoolStatusLabel(item.durum)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {selectedRequestId && (
                    <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                      Talep seçildi ✅ Yükleyeceğiniz tüm teklif dosyaları bu talep listesine göre analiz edilecek.
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
                  Talep seçilmeden analiz yapılacak. Bu yol hızlı kontrol içindir; proje/talep/sipariş zinciri için talep seçerek ilerlemeniz önerilir.
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-800">Tedarikçi Teklif Dosyalarını Yükle</h2>
              <p className="mt-2 text-sm text-slate-600">
                Aynı talep için birden fazla tedarikçi teklifi yükleyebilirsiniz. Dosyalar analiz edilerek mukayese raporuna aktarılır.
              </p>

              <div
                className="mt-5 rounded-3xl border border-dashed border-blue-300 bg-blue-50/40 p-8 text-center"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDropFiles}
              >
                <div className="text-4xl">📎</div>
                <div className="mt-2 text-lg font-bold text-slate-800">
                  Dosyaları seçin veya sürükleyin
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Excel, PDF ve görsel teklif dosyaları desteklenir.
                </p>

                <input
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/pdf,image/png,image/jpeg,image/webp"
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

              <div className="hidden">
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

              <div className="hidden">
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
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-emerald-700">
                    Şirket genelinde geçerli
                  </div>
                  <h2 className="mt-1 text-xl font-bold text-slate-800">Aktif Satın Alma Politikası</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Ayarlar bölümünde tanımlanan kurallar bu mukayese analizine otomatik uygulanır.
                  </p>
                </div>
                <Link
                  href="/dashboard/ayarlar#satinalma-politikasi"
                  className="shrink-0 rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100"
                >
                  Politikayı Görüntüle
                </Link>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <PolicyValue label="Finansman oranı" value={`%${Number(companySettings.annual_interest_rate || 0)}`} />
                <PolicyValue label="Kabul edilen termin" value={`${Number(companySettings.accepted_termin_days || 0)} gün`} />
                <PolicyValue label="Gecikme maliyeti" value={`${Number(companySettings.daily_delay_cost_try || 0)} TRY/gün`} />
                <PolicyValue
                  label="Eksik bilgi kararı"
                  value={companySettings.missing_data_policy === "warn_only" ? "Uyar ve değerlendir" : "Manuel kontrol"}
                />
              </div>

              <div className="mt-4 rounded-xl border border-emerald-200 bg-white/80 p-3 text-xs font-semibold leading-5 text-emerald-900">
                Aşırı fiyat farkı, eksik vade/termin veya birbirine çok yakın teklifler oluşursa sistem otomatik öneriyi durdurup kontrol ister.
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-800">Kur Bilgileri</h2>
              <p className="mt-2 text-sm text-slate-600">
                Dövizli teklifler analiz edilirken bu kurla TL karşılığı hesaplanır.
              </p>
              <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <div className="text-sm font-black text-blue-900">Canlı kur bilgisi</div>
                <div className="mt-1 text-xs font-semibold text-blue-800">
                  {liveRates?.date ? `${liveRates.date} tarihli canlı kur` : "Canlı kur bekleniyor"}
                  {liveRates?.source ? ` · ${liveRates.source}` : ""}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {liveCurrencyOptions.map((currency) => (
                    <span key={currency} className="rounded-full bg-white px-3 py-2 text-xs font-black text-blue-900">
                      {currency}: {liveRateFor(currency, liveRates) ? formatMoney(liveRateFor(currency, liveRates), "TRY") : "Alınamadı"}
                    </span>
                  ))}
                </div>
                {liveRateWarning && (
                  <div className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-xs font-bold text-yellow-900">
                    {liveRateWarning}
                  </div>
                )}
              </div>

              <div className="mt-5 space-y-4">
                {liveCurrencyOptions.map((currency) => (
                  <div key={currency}>
                    <label className="mb-2 block text-sm font-bold text-slate-700">
                      {currency} analiz kuru
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
                {reportReady && (
                  <div className="rounded-xl border border-green-300 bg-green-50 px-5 py-3 text-sm font-bold text-green-800">
                    Rapor otomatik olarak Raporlar sayfasına aktarıldı.
                  </div>
                )}
              </div>
            </section>

            {message && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700 shadow-sm">
                {message}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  </div>
);
}

function PolicyValue({ label, value }) {
  return (
    <div className="rounded-xl border border-emerald-100 bg-white p-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-slate-900">{value}</div>
    </div>
  );
}
