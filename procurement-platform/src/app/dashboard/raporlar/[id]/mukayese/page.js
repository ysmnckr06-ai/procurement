"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { findOrCreateBusinessPartner } from "@/lib/businessPartners";

function num(value) { return Number(value || 0) || 0; }
function normalize(value) { return String(value || "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " "); }
function cleanSupplierName(value) {
  return String(value || "")
    .replace(/\.(pdf|xlsx?|xls|png|jpe?g)$/gi, "")
    .replace(/\bpdf+f*\b/gi, "")
    .replace(/\b(kopya|copy)\b/gi, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+-\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function supplierName(offer) { return cleanSupplierName(offer?.firmaAdi || offer?.firma) || "Bilinmeyen tedarikçi"; }
function taxNumber(value) { return String(value || "").replace(/\D/g, ""); }
function hasValidTaxNumber(value) { return [10, 11].includes(taxNumber(value).length); }
function hasFileNameArtifact(value) { return /\.(pdf|xlsx?|xls|png|jpe?g)|\bpdf+f*\b|\b(kopya|copy)\b/i.test(String(value || "")); }
function partnerNeedsCompletion(partner) {
  return !partner || !hasValidTaxNumber(partner.tax_number) || hasFileNameArtifact(partner.name);
}
const emptyPartnerForm = { name: "", taxNumber: "", contactPerson: "", email: "", phone: "", city: "", address: "" };
function money(value, currency = "TRY") {
  return `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(value))} ${currency}`;
}
function groupKey(index) { return `group-${index}`; }
function normalizedCurrency(value) { return String(value || "").trim().toUpperCase(); }
function projectSummary(group) {
  const rows = Array.isArray(group?.allocations) ? group.allocations : [];
  const totals = new Map();
  rows.forEach((row) => {
    const key = row.projectCode || row.projectName || row.projectId;
    if (key) totals.set(key, (totals.get(key) || 0) + num(row.quantity));
  });
  return Array.from(totals.entries()).map(([key, quantity]) => `${key}: ${quantity}`).join(" · ") || "Proje bağı yok";
}
function comparisonOrderKey(name, currency, exchangeRate) {
  return `${normalize(name)}|${normalizedCurrency(currency)}|${num(exchangeRate).toFixed(6)}`;
}
function offerOriginalTotal(group, offer) {
  return num(offer?.netToplam) || num(offer?.netBirimFiyat) * num(group?.purchaseQuantity || group?.talepEdilenAdet || offer?.firmaAdedi);
}
function offerTryTotal(group, offer) {
  const explicitTryTotal = num(offer?.netToplamTRY);
  if (explicitTryTotal > 0) return explicitTryTotal;
  const currency = normalizedCurrency(offer?.paraBirimi) || "TRY";
  const rate = currency === "TRY" ? 1 : num(offer?.kur);
  return offerOriginalTotal(group, offer) * (rate || 1);
}

function evaluatedOfferCost(group, offer) {
  const evaluated = num(offer?.evaluatedCostTRY);
  if (evaluated > 0) return evaluated;
  const tco = num(offer?.tcoTRY) || offerTryTotal(group, offer);
  return Math.max(tco - num(offer?.financeAdvantageTRY), 0);
}

function isPaymentAfterDelivery(offer) {
  const raw = normalize(offer?.vade);
  return offer?.vadeCalculationSource === "delivery_following" || (
    raw.includes("teslim") && ["müteakip", "sonra", "takiben"].some((word) => raw.includes(word))
  );
}

function paymentDayCount(offer) {
  const recordedDays = num(offer?.vadeDays);
  if (recordedDays > 0) return recordedDays;
  if (isPaymentAfterDelivery(offer)) return num(offer?.terminDays) + 1;
  return 0;
}

function paymentTiming(offer) {
  const days = paymentDayCount(offer);
  if (isPaymentAfterDelivery(offer)) {
    return `Teslimden sonraki gün (yaklaşık ${days}. gün)`;
  }
  if (days > 0) return `${days} gün`;
  return String(offer?.vade || "Belirtilmemiş");
}

function deliveryTiming(offer) {
  if (num(offer?.terminDays) > 0) return `${num(offer.terminDays)} gün`;
  return String(offer?.termin || "Belirtilmemiş");
}

function resolveAnnualInterestRate(offers) {
  const recorded = offers.map((offer) => num(offer?.annualInterestRate)).find((rate) => rate > 0);
  if (recorded) return recorded;

  for (const offer of offers) {
    const days = paymentDayCount(offer);
    const nominalTry = num(offer?.netToplamTRY);
    const financeAdvantage = num(offer?.financeAdvantageTRY);
    const presentTry = nominalTry - financeAdvantage;
    if (days > 0 && nominalTry > 0 && financeAdvantage > 0 && presentTry > 0) {
      return (Math.pow(nominalTry / presentTry, 365 / days) - 1) * 100;
    }
  }
  return 0;
}

function presentValueDetail(group, offer, annualRate) {
  const currency = normalizedCurrency(offer?.paraBirimi) || "TRY";
  const originalTotal = offerOriginalTotal(group, offer);
  const days = paymentDayCount(offer);
  const factor = annualRate > 0 && days > 0
    ? Math.pow(1 + annualRate / 100, days / 365)
    : 1;
  const presentValue = originalTotal / factor;
  return {
    currency,
    days,
    originalTotal,
    presentValue,
    financeAdvantage: Math.max(originalTotal - presentValue, 0),
  };
}

function buildDecisionInsight(group) {
  const offers = Array.isArray(group?.offers) ? group.offers : [];
  const winner = group?.bestOffer;
  if (!winner) return null;

  const winnerName = supplierName(winner);
  const alternatives = offers
    .filter((offer) => normalize(supplierName(offer)) !== normalize(winnerName))
    .filter((offer) => offer?.uygunMu !== false)
    .sort((left, right) => evaluatedOfferCost(group, left) - evaluatedOfferCost(group, right));
  const alternative = alternatives[0] || null;
  const alternativeName = alternative ? supplierName(alternative) : "";
  const winnerCost = evaluatedOfferCost(group, winner);
  const alternativeCost = alternative ? evaluatedOfferCost(group, alternative) : 0;
  const costGap = alternative ? Math.max(alternativeCost - winnerCost, 0) : 0;
  const gapRate = alternativeCost > 0 ? (costGap / alternativeCost) * 100 : 0;
  const annualRate = resolveAnnualInterestRate(offers);
  const bullets = [];
  const narrative = [];
  const cautions = [
    ...(Array.isArray(group?.decisionWarnings) ? group.decisionWarnings : []),
    ...(Array.isArray(group?.decisionNotes) ? group.decisionNotes : []),
  ].filter(Boolean);

  if (alternative) {
    const winnerCurrency = normalizedCurrency(winner.paraBirimi) || "TRY";
    const alternativeCurrency = normalizedCurrency(alternative.paraBirimi) || "TRY";
    const winnerValue = presentValueDetail(group, winner, annualRate);
    const alternativeValue = presentValueDetail(group, alternative, annualRate);
    const sameCurrency = winnerCurrency === alternativeCurrency;
    const nominalGap = alternativeValue.originalTotal - winnerValue.originalTotal;
    const presentGap = alternativeValue.presentValue - winnerValue.presentValue;

    if (winnerCurrency === alternativeCurrency) {
      narrative.push(
        `${winnerName} teklifinin nominal toplamı ${money(winnerValue.originalTotal, winnerCurrency)}, ${alternativeName} teklifinin toplamı ${money(alternativeValue.originalTotal, alternativeCurrency)}. ${nominalGap > 0 ? `${winnerName} başlangıçta ${money(nominalGap, winnerCurrency)} daha ucuz.` : "Nominal fiyat avantajı diğer teklifte."}`,
      );
    } else {
      narrative.push(
        `Teklifler farklı para biriminde olduğu için kayıtlı analiz kuruyla karşılaştırıldı: ${winnerName} ${money(offerTryTotal(group, winner), "TRY")}, ${alternativeName} ${money(offerTryTotal(group, alternative), "TRY")}.`,
      );
    }

    if (sameCurrency && (winnerValue.financeAdvantage > 0 || alternativeValue.financeAdvantage > 0)) {
      if (alternativeValue.days > winnerValue.days) {
        narrative.push(
          `${alternativeName} daha uzun ödeme süresi sayesinde ${money(alternativeValue.financeAdvantage, winnerCurrency)} finansman avantajı sağlıyor. Ancak bu avantaj ${nominalGap > 0 ? "başlangıçtaki fiyat farkını kapatmaya yetmiyor" : "diğer maliyet etkileriyle birlikte tek başına kararı belirlemiyor"}.`,
        );
      } else {
        narrative.push(
          `${winnerName} daha uzun ödeme süresi sayesinde ${money(winnerValue.financeAdvantage, winnerCurrency)} finansman avantajı sağlıyor; bu vade etkisi ${nominalGap > 0 ? "mevcut fiyat avantajını daha da güçlendiriyor" : "nominal fiyat dezavantajının bir bölümünü karşılıyor"}.`,
        );
      }
    }

    if (sameCurrency) {
      narrative.push(
        `Paranın zaman değeri uygulandığında ${winnerName} teklifinin bugünkü maliyeti ${money(winnerValue.presentValue, winnerCurrency)}, ${alternativeName} teklifinin bugünkü maliyeti ${money(alternativeValue.presentValue, alternativeCurrency)} oluyor. Sonuçta ${winnerName} yaklaşık ${money(Math.max(presentGap, 0), winnerCurrency)} daha avantajlı kalıyor.`,
      );
    }

    const winnerRisk = num(winner.advancedRiskCostTRY) + num(winner.supplierRiskCostTRY);
    const alternativeRisk = num(alternative.advancedRiskCostTRY) + num(alternative.supplierRiskCostTRY);
    if (winnerRisk > 0 || alternativeRisk > 0) {
      narrative.push(
        `Kayıtlı tedarikçi ve kur riskleri de hesaba katıldı. Tüm etkiler sonrasında değerlendirilmiş maliyet ${winnerName} için ${money(winnerCost, "TRY")}, ${alternativeName} için ${money(alternativeCost, "TRY")}.`,
      );
    }

    bullets.push(`${winnerName} bugünkü maliyeti: ${money(sameCurrency ? winnerValue.presentValue : winnerCost, sameCurrency ? winnerCurrency : "TRY")}`);
    bullets.push(`${alternativeName} bugünkü maliyeti: ${money(sameCurrency ? alternativeValue.presentValue : alternativeCost, sameCurrency ? alternativeCurrency : "TRY")}`);
    bullets.push(`${winnerName} ekonomik avantajı: ${money(Math.max(sameCurrency ? presentGap : costGap, 0), sameCurrency ? winnerCurrency : "TRY")}`);
    if (annualRate > 0) bullets.push(`Kullanılan yıllık finansman oranı: %${annualRate.toFixed(1)}`);
    bullets.push(`${winnerName} tahmini ödeme zamanı: ${paymentTiming(winner)}`);
    bullets.push(`${alternativeName} ödeme zamanı: ${paymentTiming(alternative)}`);
    bullets.push(`Teslim koşulları: ${winnerName} ${deliveryTiming(winner)}, ${alternativeName} ${deliveryTiming(alternative)}`);
  }

  cautions.push("Bu sonuç otomatik ekonomik öneridir; sipariş öncesinde fiyat kapsamı, teslim ve ödeme koşulları yazılı olarak doğrulanmalıdır.");

  return {
    winner,
    winnerName,
    alternative,
    alternativeName,
    winnerCost,
    alternativeCost,
    costGap,
    gapRate,
    narrative,
    bullets,
    cautions: Array.from(new Set(cautions)),
  };
}

function proportionalAllocations(allocations, targetQuantity) {
  const source = Array.isArray(allocations) ? allocations.filter((row) => num(row.quantity) > 0) : [];
  const total = source.reduce((sum, row) => sum + num(row.quantity), 0);
  if (!source.length || total <= 0) return [];
  let used = 0;
  return source.map((row, index) => {
    const quantity = index === source.length - 1
      ? Math.max(targetQuantity - used, 0)
      : Math.min(Number((targetQuantity * num(row.quantity) / total).toFixed(6)), Math.max(targetQuantity - used, 0));
    used += quantity;
    return { ...row, quantity };
  }).filter((row) => row.quantity > 0);
}

export default function ComparisonPage() {
  const { id } = useParams();
  const router = useRouter();
  const creatingRef = useRef(false);
  const partnerOverridesRef = useRef(new Map());
  const pendingPartnersRef = useRef([]);
  const [report, setReport] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [selectedOffers, setSelectedOffers] = useState({});
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [existingOrders, setExistingOrders] = useState([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [partnerPrompt, setPartnerPrompt] = useState(null);
  const [partnerForm, setPartnerForm] = useState(emptyPartnerForm);
  const [savingPartner, setSavingPartner] = useState(false);
  const [decisionGroupIndex, setDecisionGroupIndex] = useState(null);
  const [downloading, setDownloading] = useState("");

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const [reportResult, supplierResult, orderResult] = await Promise.all([
        supabase.from("reports").select("*").eq("id", id).eq("user_id", user.id).single(),
        supabase.from("suppliers").select("id,name,score,status,partner_type,tax_number,contact_person,email,phone,city,address,notes").eq("user_id", user.id),
        supabase.from("orders").select("id,order_no").eq("report_id", id).eq("user_id", user.id),
      ]);
      if (reportResult.error || !reportResult.data) {
        setMessage("Mukayese raporu bulunamadı veya erişim yetkiniz yok.");
        return;
      }
      setReport(reportResult.data);
      setSuppliers(supplierResult.data || []);
      if (orderResult.error) {
        setMessage("Bu raporun sipariş durumu kontrol edilemedi. Yeni sipariş oluşturma güvenlik amacıyla kapatıldı.");
        return;
      }
      setExistingOrders(orderResult.data || []);
      setOrdersLoaded(true);
      const defaults = {};
      (Array.isArray(reportResult.data.analysis) ? reportResult.data.analysis : []).forEach((group, index) => {
        const offers = Array.isArray(group.offers) ? group.offers : [];
        const bestIndex = offers.findIndex((offer) => normalize(supplierName(offer)) === normalize(supplierName(group.bestOffer)));
        if (bestIndex >= 0) defaults[groupKey(index)] = bestIndex;
      });
      setSelectedOffers(defaults);
    }
    load();
  }, [id, router]);

  const groups = useMemo(() => Array.isArray(report?.analysis) ? report.analysis : [], [report]);
  const decisionInsight = decisionGroupIndex === null
    ? null
    : buildDecisionInsight(groups[decisionGroupIndex]);
  const supplierMap = useMemo(() => new Map(suppliers.map((supplier) => [normalize(cleanSupplierName(supplier.name)), supplier])), [suppliers]);
  const selectedSummary = useMemo(() => {
    const selectedRows = groups
      .map((group, index) => ({ group, offer: group.offers?.[selectedOffers[groupKey(index)]] }))
      .filter((row) => row.offer);
    const totalTry = selectedRows.reduce((sum, row) => sum + offerTryTotal(row.group, row.offer), 0);
    const foreignCurrencies = Array.from(new Set(selectedRows
      .map((row) => normalizedCurrency(row.offer?.paraBirimi))
      .filter((currency) => currency && currency !== "TRY")));
    return { selectedCount: selectedRows.length, totalTry, foreignCurrencies };
  }, [groups, selectedOffers]);

  async function downloadReportFile(type) {
    if (!report || downloading) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      setMessage("API adresi bulunamadı. Rapor indirilemedi.");
      return;
    }

    const path = type === "pdf"
      ? `/download-comparison-pdf/${report.id}`
      : report.reportpath || report.report_path || report.reportPath;
    if (!path) {
      setMessage(type === "pdf" ? "PDF rapor yolu oluşturulamadı." : "Excel detay dosyası bulunamadı.");
      return;
    }

    setDownloading(type);
    setMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
      const url = /^https?:\/\//i.test(path) ? path : `${apiUrl}${path}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "Rapor indirilemedi.");
      }

      const blob = await response.blob();
      const requestNumber = report.source_request_number || report.items?.[0]?.sourceRequestNumber || "mukayese";
      const extension = type === "pdf" ? "pdf" : "xlsx";
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${requestNumber}-mukayese.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setMessage(error?.message || "Rapor indirilemedi.");
    } finally {
      setDownloading("");
    }
  }

  async function createOrders() {
    if (!report || creatingRef.current || !ordersLoaded) return;
    if (existingOrders.length > 0) {
      setMessage(`Bu mukayeseden sipariş zaten oluşturulmuş: ${existingOrders.map((order) => order.order_no).join(", ")}`);
      return;
    }
    const selections = groups
      .map((group, index) => ({ group, offer: group.offers?.[selectedOffers[groupKey(index)]] }))
      .filter((row) => row.offer);
    if (!selections.length) { setMessage("Siparişe dönüştürmek için en az bir teklif seçin."); return; }

    const validationErrors = [];
    selections.forEach(({ group, offer }) => {
      const currency = normalizedCurrency(offer.paraBirimi);
      const submittedRate = num(offer.kur);
      const exchangeRate = currency === "TRY" && submittedRate <= 0 ? 1 : submittedRate;
      const itemLabel = `${group.urunKodu || "Kodsuz"} · ${group.urunAciklamasi || "Ürün"}`;
      if (!currency) validationErrors.push(`${itemLabel}: para birimi eksik`);
      if (!currency || exchangeRate <= 0) validationErrors.push(`${itemLabel}: geçerli kur eksik`);
      if (num(offer.firmaAdedi) < num(group.purchaseQuantity || group.talepEdilenAdet)) {
        validationErrors.push(`${itemLabel}: teklif miktarı talep miktarını tam karşılamıyor`);
      }
      const allocationProjectIds = (group.allocations || []).map((allocation) => allocation.projectId).filter(Boolean);
      if (allocationProjectIds.length === 0 && !report.project_id) {
        validationErrors.push(`${itemLabel}: proje bağı yok`);
      }
    });
    if (validationErrors.length > 0) {
      setMessage(`Sipariş oluşturulmadı. ${validationErrors.join(" | ")}`);
      return;
    }

    creatingRef.current = true; setCreating(true); setMessage("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { creatingRef.current = false; setCreating(false); router.push("/login"); return; }

    const bySupplier = new Map();
    selections.forEach(({ group, offer }) => {
      const name = supplierName(offer);
      const currency = normalizedCurrency(offer.paraBirimi);
      const exchangeRate = currency === "TRY" && num(offer.kur) <= 0 ? 1 : num(offer.kur);
      const supplierLookupKey = normalize(name);
      const key = comparisonOrderKey(name, currency, exchangeRate);
      if (!bySupplier.has(key)) {
        bySupplier.set(key, {
          key,
          name,
          partner: partnerOverridesRef.current.get(supplierLookupKey) || supplierMap.get(supplierLookupKey),
          currency,
          exchangeRate,
          items: [],
        });
      }
      const quantity = num(group.purchaseQuantity || group.talepEdilenAdet);
      bySupplier.get(key).items.push({
        rowId: `report-${report.id}-${group.urunKodu || group.normalizedProductCode || bySupplier.get(key).items.length}`,
        productId: group.productId || null,
        productCode: group.urunKodu || group.normalizedProductCode || "",
        productName: group.urunAciklamasi || "",
        unit: group.birim || "adet",
        quantity,
        deliveredQuantity: 0,
        unitPrice: num(offer.birimFiyat),
        discount: num(offer.iskonto),
        netUnitPrice: num(offer.netBirimFiyat),
        total: num(offer.netToplam) || num(offer.netBirimFiyat) * quantity,
        currency,
        paymentTerm: offer.vade || "",
        deliveryTerm: offer.termin || "",
        allocations: proportionalAllocations(group.allocations, quantity),
        sourceReportId: report.id,
      });
    });

    const { data: existing, error: existingError } = await supabase
      .from("orders")
      .select("id,order_no,partner_name,supplier_name,currency,exchange_rate")
      .eq("user_id", user.id)
      .eq("report_id", report.id);
    if (existingError) {
      setMessage(`Mükerrer sipariş kontrolü yapılamadı: ${existingError.message}`);
      creatingRef.current = false; setCreating(false); return;
    }
    if ((existing || []).length > 0) {
      setExistingOrders(existing || []);
      setMessage(`Bu mukayeseden sipariş zaten oluşturulmuş: ${existing.map((order) => order.order_no).join(", ")}`);
      creatingRef.current = false; setCreating(false); return;
    }

    const partnersToComplete = [];
    const queuedNames = new Set();
    for (const entry of bySupplier.values()) {
      const key = normalize(entry.name);
      if (partnerNeedsCompletion(entry.partner) && !queuedNames.has(key)) {
        queuedNames.add(key);
        partnersToComplete.push({ key, name: entry.name, partner: entry.partner || null });
      }
    }
    if (partnersToComplete.length > 0) {
      pendingPartnersRef.current = partnersToComplete;
      const first = partnersToComplete[0];
      setPartnerForm({
        ...emptyPartnerForm,
        name: cleanSupplierName(first.partner?.name || first.name),
        taxNumber: first.partner?.tax_number || "",
        contactPerson: first.partner?.contact_person || "",
        email: first.partner?.email || "",
        phone: first.partner?.phone || "",
        city: first.partner?.city || "",
        address: first.partner?.address || "",
      });
      setPartnerPrompt({ index: 0, total: partnersToComplete.length, entry: first });
      setMessage("Sipariş henüz oluşturulmadı. Önce tedarikçi firma bilgilerini tamamlayın.");
      creatingRef.current = false; setCreating(false); return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const suffix = String(report.id).replaceAll("-", "").slice(0, 6).toUpperCase();
    const payloads = Array.from(bySupplier.values()).map((entry, index) => {
      const currency = entry.currency;
      const rate = entry.exchangeRate;
      const total = entry.items.reduce((sum, item) => sum + num(item.total), 0);
      const projectIds = Array.from(new Set(entry.items.flatMap((item) => item.allocations.map((allocation) => allocation.projectId)).filter(Boolean)));
      return {
        user_id: user.id,
        order_no: `SIP-${new Date().getFullYear()}-${suffix}-${String(index + 1).padStart(2, "0")}`,
        supplier_name: entry.name,
        partner_id: entry.partner?.id || null,
        partner_name: entry.partner?.name || entry.name,
        partner_type: entry.partner?.partner_type || "Tedarikçi",
        product_name: `${entry.items.length} kalem · Mukayese siparişi`,
        quantity: entry.items.reduce((sum, item) => sum + num(item.quantity), 0),
        order_date: today,
        status: "Taslak",
        project_id: projectIds.length === 1 ? projectIds[0] : projectIds.length === 0 ? report.project_id : null,
        report_id: report.id,
        items: entry.items,
        total_amount: total,
        original_amount: total,
        order_total: total,
        currency,
        exchange_rate: rate,
        exchange_rate_date: today,
        base_currency: "TRY",
        base_amount: total * rate,
        order_total_base: total * rate,
        remaining_amount: total,
        remaining_amount_base: total * rate,
        note: `${report.ad || "Talep mukayesesi"} üzerinden oluşturuldu. Rapor: ${report.id}`,
      };
    });
    const { data: orders, error } = await supabase.from("orders").insert(payloads).select("id,order_no");
    if (error) {
      const duplicateMessage = error.code === "23505" || /orders_comparison_group_unique_idx/i.test(error.message || "")
        ? "Bu mukayese grubundan sipariş zaten oluşturulmuş. İkinci kayıt engellendi."
        : `Siparişler oluşturulamadı; işlem geri alındı: ${error.message}`;
      setMessage(duplicateMessage);
      creatingRef.current = false; setCreating(false); return;
    }
    await supabase.from("reports").update({ durum: "Tamamlandı" }).eq("id", report.id).eq("user_id", user.id);
    setExistingOrders(orders || []);
    localStorage.setItem("lastCreatedComparisonOrders", JSON.stringify(orders || []));
    setMessage(`${orders?.length || 0} tedarikçi siparişi oluşturuldu. Proje allocation bilgileri sipariş kalemlerinde korundu.`);
    creatingRef.current = false; setCreating(false);
  }

  async function savePartnerAndContinue(event) {
    event.preventDefault();
    if (!partnerPrompt || savingPartner) return;
    const cleanName = cleanSupplierName(partnerForm.name);
    if (!cleanName || !hasValidTaxNumber(partnerForm.taxNumber)) {
      setMessage("Firma adı ile 10 haneli VKN veya 11 haneli TCKN zorunludur.");
      return;
    }
    setSavingPartner(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingPartner(false); router.push("/login"); return; }
    const values = {
      name: cleanName,
      partner_type: "Tedarikçi",
      tax_number: taxNumber(partnerForm.taxNumber),
      contact_person: partnerForm.contactPerson.trim() || null,
      email: partnerForm.email.trim() || null,
      phone: partnerForm.phone.trim() || null,
      city: partnerForm.city.trim() || null,
      address: partnerForm.address.trim() || null,
      notes: "Mukayese siparişi öncesinde kullanıcı tarafından doğrulandı.",
      status: "Aktif",
    };
    let saved = null;
    let error = null;
    if (partnerPrompt.entry.partner?.id) {
      const result = await supabase.from("suppliers").update(values).eq("id", partnerPrompt.entry.partner.id).eq("user_id", user.id).select("*").single();
      saved = result.data; error = result.error;
    } else {
      try {
        saved = await findOrCreateBusinessPartner(supabase, user.id, {
          name: cleanName,
          partnerType: "Tedarikçi",
          taxNumber: values.tax_number,
          contactPerson: values.contact_person,
          email: values.email,
          phone: values.phone,
          city: values.city,
          address: values.address,
          notes: values.notes,
          allowCreate: true,
          forceCreate: true,
          rejectDuplicateTax: true,
        });
      } catch (caught) {
        error = caught;
      }
    }
    if (error || !saved) {
      setMessage(`Tedarikçi kartı kaydedilemedi: ${error?.message || "Bilinmeyen hata"}`);
      setSavingPartner(false);
      return;
    }
    partnerOverridesRef.current.set(partnerPrompt.entry.key, saved);
    setSuppliers((current) => [...current.filter((item) => item.id !== saved.id), saved]);
    const nextIndex = partnerPrompt.index + 1;
    const next = pendingPartnersRef.current[nextIndex];
    if (next) {
      setPartnerForm({
        ...emptyPartnerForm,
        name: cleanSupplierName(next.partner?.name || next.name),
        taxNumber: next.partner?.tax_number || "",
        contactPerson: next.partner?.contact_person || "",
        email: next.partner?.email || "",
        phone: next.partner?.phone || "",
        city: next.partner?.city || "",
        address: next.partner?.address || "",
      });
      setPartnerPrompt({ index: nextIndex, total: pendingPartnersRef.current.length, entry: next });
      setMessage(`${cleanName} kaydedildi. Sıradaki tedarikçi bilgilerini tamamlayın.`);
      setSavingPartner(false);
      return;
    }
    setPartnerPrompt(null);
    setPartnerForm(emptyPartnerForm);
    setSavingPartner(false);
    setMessage("Tedarikçi kartları doğrulandı. Siparişler oluşturuluyor...");
    setTimeout(() => createOrders(), 0);
  }

  if (!report) return <div className="min-h-screen bg-slate-100 p-8"><div className="mx-auto max-w-5xl rounded-2xl bg-white p-6">{message || "Mukayese yükleniyor..."}</div></div>;

  return <div className="min-h-screen bg-slate-100 p-4 sm:p-8"><main className="mx-auto max-w-7xl space-y-5">
    {decisionInsight && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="decision-explanation-title" className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b bg-white p-6">
          <div>
            <div className="text-xs font-black uppercase tracking-wider text-emerald-700">Karar motoru açıklaması</div>
            <h2 id="decision-explanation-title" className="mt-1 text-2xl font-black text-slate-950">Neden {decisionInsight.winnerName} önerildi?</h2>
          </div>
          <button type="button" onClick={() => setDecisionGroupIndex(null)} className="rounded-xl border px-4 py-2 text-sm font-black text-slate-700">Kapat</button>
        </div>

        <div className="space-y-5 p-6">
          {decisionInsight.alternative ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="text-sm font-black text-emerald-800">Kısa cevap</div>
            <div className="mt-3 space-y-3 text-base font-semibold leading-7 text-emerald-950">
              {decisionInsight.narrative.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              <p className="font-black">Bu nedenle {decisionInsight.winnerName}, yalnızca fiyatı düşük olduğu için değil; fiyat, vade, teslim ve kayıtlı riskler birlikte değerlendirildiğinde ekonomik olarak öneriliyor.</p>
            </div>
          </div> : <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 font-bold text-amber-950">Bu kalemde karşılaştırılabilir başka uygun teklif bulunmadığı için mevcut teklif önerildi.</div>}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200 p-5">
              <div className="text-xs font-black uppercase text-emerald-700">Önerilen · {decisionInsight.winnerName}</div>
              <div className="mt-2 text-2xl font-black text-slate-950">{money(decisionInsight.winnerCost, "TRY")}</div>
              <div className="mt-1 text-sm text-slate-600">Finansman ve risk etkileri sonrası değerlendirilmiş maliyet</div>
            </div>
            {decisionInsight.alternative && <div className="rounded-2xl border border-slate-200 p-5">
              <div className="text-xs font-black uppercase text-slate-600">En yakın alternatif · {decisionInsight.alternativeName}</div>
              <div className="mt-2 text-2xl font-black text-slate-950">{money(decisionInsight.alternativeCost, "TRY")}</div>
              <div className="mt-1 text-sm text-slate-600">Finansman ve risk etkileri sonrası değerlendirilmiş maliyet</div>
            </div>}
          </div>

          <div>
            <h3 className="text-lg font-black text-slate-950">Hesabın özeti</h3>
            <ul className="mt-3 space-y-2">
              {decisionInsight.bullets.map((bullet) => <li key={bullet} className="flex gap-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-800"><span className="text-emerald-600">✓</span><span>{bullet}</span></li>)}
            </ul>
          </div>

          {decisionInsight.cautions.length > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h3 className="font-black text-amber-950">Kontrol edilmesi gerekenler</h3>
            <ul className="mt-2 space-y-2 text-sm font-semibold text-amber-950">
              {decisionInsight.cautions.map((warning) => <li key={warning}>• {warning}</li>)}
            </ul>
          </div>}
        </div>
      </div>
    </div>}
    {partnerPrompt && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <form onSubmit={savePartnerAndContinue} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><div className="text-xs font-black uppercase tracking-wider text-blue-700">Tedarikçi bilgisi · {partnerPrompt.index + 1}/{partnerPrompt.total}</div><h2 className="mt-1 text-2xl font-black text-slate-950">Firma bilgilerini tamamlayın</h2><p className="mt-2 text-sm text-slate-600">Teklif dosyasının adı firma kartı olarak kaydedilmez. Sipariş oluşmadan önce gerçek firma bilgileri doğrulanır.</p></div>
          <button type="button" onClick={() => { setPartnerPrompt(null); pendingPartnersRef.current = []; setMessage("Sipariş oluşturma iptal edildi; hiçbir sipariş kaydedilmedi."); }} className="rounded-xl border px-3 py-2 text-sm font-bold">Vazgeç</button>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-bold">Firma adı *<input value={partnerForm.name} onChange={(e) => setPartnerForm((current) => ({ ...current, name: e.target.value }))} className="mt-1 w-full rounded-xl border p-3" /></label>
          <label className="text-sm font-bold">VKN / TCKN *<input value={partnerForm.taxNumber} onChange={(e) => setPartnerForm((current) => ({ ...current, taxNumber: e.target.value }))} inputMode="numeric" className="mt-1 w-full rounded-xl border p-3" placeholder="10 haneli VKN veya 11 haneli TCKN" /></label>
          <label className="text-sm font-bold">Yetkili<input value={partnerForm.contactPerson} onChange={(e) => setPartnerForm((current) => ({ ...current, contactPerson: e.target.value }))} className="mt-1 w-full rounded-xl border p-3" /></label>
          <label className="text-sm font-bold">E-posta<input type="email" value={partnerForm.email} onChange={(e) => setPartnerForm((current) => ({ ...current, email: e.target.value }))} className="mt-1 w-full rounded-xl border p-3" /></label>
          <label className="text-sm font-bold">Telefon<input value={partnerForm.phone} onChange={(e) => setPartnerForm((current) => ({ ...current, phone: e.target.value }))} className="mt-1 w-full rounded-xl border p-3" /></label>
          <label className="text-sm font-bold">Şehir<input value={partnerForm.city} onChange={(e) => setPartnerForm((current) => ({ ...current, city: e.target.value }))} className="mt-1 w-full rounded-xl border p-3" /></label>
          <label className="text-sm font-bold md:col-span-2">Adres<textarea value={partnerForm.address} onChange={(e) => setPartnerForm((current) => ({ ...current, address: e.target.value }))} className="mt-1 min-h-20 w-full rounded-xl border p-3" /></label>
        </div>
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Bu bilgiler İş Ortakları kartına kaydedilir ve sonraki siparişlerde tekrar sorulmaz.</div>
        <button type="submit" disabled={savingPartner} className="mt-5 w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white disabled:bg-slate-400">{savingPartner ? "Kaydediliyor..." : "Firma Bilgilerini Kaydet ve Devam Et"}</button>
      </form>
    </div>}
    <section className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl">
      <Link href={`/dashboard/raporlar/${report.id}`} className="text-sm font-bold text-blue-200">← Rapor özetine dön</Link>
      <div className="mt-4 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-sm font-bold text-blue-200">{report.source_request_number || report.items?.[0]?.sourceRequestNumber || "Talep Mukayesesi"}</div>
          <h1 className="mt-1 text-3xl font-black">Kalem Bazlı Mukayese</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">Bu ekran ana mukayese raporudur. Fiyat, vade, termin ve risk etkilerini inceleyebilir; yönetici PDF'sini veya teknik Excel detayını indirebilirsiniz.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => downloadReportFile("pdf")} disabled={Boolean(downloading)} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white hover:bg-blue-500 disabled:bg-slate-600">
            {downloading === "pdf" ? "PDF hazırlanıyor..." : "PDF Raporu İndir"}
          </button>
          <button type="button" onClick={() => downloadReportFile("excel")} disabled={Boolean(downloading)} className="rounded-xl border border-slate-500 bg-white/5 px-4 py-3 text-sm font-black text-white hover:bg-white/10 disabled:text-slate-500">
            {downloading === "excel" ? "Excel indiriliyor..." : "Excel Detayını İndir"}
          </button>
          <button type="button" onClick={createOrders} disabled={creating || !ordersLoaded || existingOrders.length > 0} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-600">
            {creating
              ? "Siparişler oluşturuluyor..."
              : !ordersLoaded
                ? "Sipariş durumu kontrol ediliyor..."
                : existingOrders.length > 0
                  ? `Sipariş Oluşturuldu (${existingOrders.length})`
                  : "Seçilenlerden Sipariş Oluştur"}
          </button>
        </div>
      </div>
    </section>
    {message && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 font-semibold text-blue-900">{message} {message.includes("oluşturuldu") && <Link href="/dashboard/siparisler" className="ml-2 underline">Siparişlere git</Link>}</div>}
    <section className="rounded-2xl border border-blue-100 bg-blue-50 p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-black text-blue-950">Seçili teklif TL dip toplamı</h2>
          <p className="mt-1 text-sm font-semibold text-blue-800">
            Dövizli teklifler analizde kaydedilen kurla TL karşılığına çevrilir.
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black text-blue-950">{money(selectedSummary.totalTry, "TRY")}</div>
          <div className="mt-1 text-xs font-bold text-blue-700">
            {selectedSummary.selectedCount} seçili kalem
            {selectedSummary.foreignCurrencies.length > 0 ? ` · Döviz: ${selectedSummary.foreignCurrencies.join(", ")}` : ""}
          </div>
        </div>
      </div>
    </section>
    {groups.map((group, groupIndex) => {
      const offers = Array.isArray(group.offers) ? group.offers : [];
      const bestName = normalize(supplierName(group.bestOffer));
      return <section key={groupKey(groupIndex)} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b bg-slate-50 p-4"><div className="font-black text-blue-900">{group.urunKodu || "Kodsuz"} · {group.urunAciklamasi}</div><div className="mt-1 flex flex-wrap gap-3 text-xs font-bold text-slate-600"><span>Talep edilen: {group.talepEdilenAdet} {group.birim}</span><span>Teklif sayısı: {offers.length}</span><span>Projeler: {projectSummary(group)}</span></div></div>
        <div className="overflow-x-auto"><table className="min-w-[1450px] w-full text-left text-xs"><thead className="bg-white text-slate-500"><tr><th className="p-3">Seç</th><th className="p-3">Tedarikçi / Puan</th><th className="p-3">Miktar</th><th className="p-3">Birim fiyat</th><th className="p-3">İskonto</th><th className="p-3">Net fiyat</th><th className="p-3">Toplam</th><th className="p-3">Para birimi</th><th className="p-3">Kur</th><th className="p-3">TL karşılığı</th><th className="p-3">Vade</th><th className="p-3">Termin</th><th className="p-3">Sonuç</th></tr></thead><tbody>
          {offers.map((offer, offerIndex) => { const name = supplierName(offer); const isBest = normalize(name) === bestName; const supplier = supplierMap.get(normalize(name)); return <tr key={`${name}-${offerIndex}`} className={`border-t ${isBest ? "bg-emerald-50" : ""}`}><td className="p-3"><input type="radio" name={groupKey(groupIndex)} checked={selectedOffers[groupKey(groupIndex)] === offerIndex} onChange={() => setSelectedOffers((current) => ({ ...current, [groupKey(groupIndex)]: offerIndex }))} /></td><td className="p-3"><div className="font-black text-slate-900">{name}</div><div className="text-blue-700">Puan: {supplier?.score ?? 80}/100</div></td><td className="p-3">{offer.firmaAdedi || group.purchaseQuantity || group.talepEdilenAdet}</td><td className="p-3">{money(offer.birimFiyat, offer.paraBirimi)}</td><td className="p-3">%{num(offer.iskonto)}</td><td className="p-3">{money(offer.netBirimFiyat, offer.paraBirimi)}</td><td className="p-3">{money(offer.netToplam || num(offer.netBirimFiyat) * num(group.purchaseQuantity || group.talepEdilenAdet), offer.paraBirimi)}</td><td className="p-3">{offer.paraBirimi || "TRY"}</td><td className="p-3">{num(offer.kur) || 1}</td><td className="p-3 font-black">{money(offerTryTotal(group, offer), "TRY")}</td><td className="p-3">{offer.vade || `${offer.vadeDays || 0} gün`}</td><td className="p-3">{offer.termin || `${offer.terminDays || 0} gün`}</td><td className="p-3">{isBest ? <button type="button" onClick={() => setDecisionGroupIndex(groupIndex)} className="rounded-xl bg-emerald-600 px-3 py-2 text-left font-black text-white shadow-sm transition hover:bg-emerald-700"><span className="block">En iyi teklif</span><span className="block text-[10px] font-bold text-emerald-100">Neden önerildi?</span></button> : <span className="rounded-full bg-slate-200 px-3 py-1 font-bold text-slate-700">Alternatif</span>}</td></tr>; })}
        </tbody></table></div>
      </section>;
    })}
  </main></div>;
}
