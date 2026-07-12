"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  backfillProjectCustomerPartners,
  deduplicateBusinessPartners,
  duplicateTaxNumberMessage,
  findPartnerByTaxNumber,
  findOrCreateBusinessPartner,
  findPartnerMatches,
  normalizePartnerName,
  normalizePartnerRecord,
  normalizeTaxNumber,
  partnerTypes,
} from "@/lib/businessPartners";
import { supabase } from "@/lib/supabase";

const emptyForm = {
  name: "",
  partner_type: "Tedarikçi",
  contact_person: "",
  phone: "",
  email: "",
  tax_number: "",
  city: "",
  address: "",
  notes: "",
  status: "Aktif",
};

const statusOptions = ["Tümü", "Aktif", "Pasif", "Onay Bekliyor", "Riskli"];

function formatMoney(value, currency = "TRY") {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} ${currency}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("tr-TR");
}

function addMoney(map, currency, amount) {
  const key = currency || "TRY";
  map.set(key, Number(map.get(key) || 0) + Number(amount || 0));
}

function moneyRows(map) {
  return Array.from(map.entries())
    .map(([currency, amount]) => ({ currency, amount }))
    .filter((row) => Math.abs(row.amount) > 0.0001)
    .sort((a, b) => a.currency.localeCompare(b.currency, "tr-TR"));
}

function projectContractCurrency(project) {
  return project?.contract_currency || project?.currency || "TRY";
}

function projectBudgetCurrency(project) {
  return project?.estimated_budget_currency || project?.contract_currency || project?.currency || "TRY";
}

function projectTitle(project) {
  return [project?.project_code, project?.project_name].filter(Boolean).join(" · ") || "Proje";
}

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreTone(score) {
  if (score >= 80) return "bg-emerald-100 text-emerald-800";
  if (score >= 65) return "bg-blue-100 text-blue-800";
  if (score >= 50) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

function scoreLabel(score) {
  if (score >= 80) return "Güçlü";
  if (score >= 65) return "İyi";
  if (score >= 50) return "İzlenmeli";
  return "Riskli";
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function collectObjectsDeep(value, predicate, output = [], depth = 0) {
  if (!value || depth > 8) return output;
  const parsed = parseMaybeJson(value) || value;
  if (Array.isArray(parsed)) {
    parsed.forEach((item) => {
      collectObjectsDeep(item, predicate, output, depth + 1);
    });
    return output;
  }
  if (typeof parsed !== "object") return output;
  if (predicate(parsed)) output.push(parsed);
  Object.values(parsed).forEach((item) => {
    collectObjectsDeep(item, predicate, output, depth + 1);
  });
  return output;
}

function offerSupplierName(row) {
  return (
    row?.firma ||
    row?.firmaAdi ||
    row?.firma_adi ||
    row?.supplier ||
    row?.supplier_name ||
    row?.partner_name ||
    row?.company ||
    ""
  );
}

function offerAmount(row) {
  return safeNumber(
    row?.tcoTRY ||
      row?.netToplamTRY ||
      row?.netToplam ||
      row?.toplam_tutar ||
      row?.total_amount ||
      row?.total ||
      row?.line_total,
  );
}

function offerTermDays(row) {
  return safeNumber(row?.terminDays || row?.termin_days || row?.termin || row?.teslim || row?.delivery_days);
}

function offerPaymentDays(row) {
  return safeNumber(row?.vadeDays || row?.vade_days || row?.vade || row?.payment_days);
}

function isOfferEligible(row) {
  if (row?.uygunMu === false || row?.eligible === false || row?.isEligible === false) return false;
  const notes = [
    ...(Array.isArray(row?.eliminationReasons) ? row.eliminationReasons : []),
    ...(Array.isArray(row?.kararNotlari) ? row.kararNotlari : []),
    row?.reason,
    row?.kararNedeni,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("tr-TR");
  return !["kriter dışı", "uygun değil", "eksik", "elendi"].some((text) => notes.includes(text));
}

function extractOfferRowsFromRecord(record) {
  const roots = [
    record,
    record?.analysis,
    record?.analiz,
    record?.analysis_json,
    record?.analysisJson,
    record?.result,
    record?.data,
    record?.rows,
    record?.report_data,
  ].map(parseMaybeJson);

  const rows = [];
  roots.forEach((root) => {
    collectObjectsDeep(
      root,
      (item) =>
        Boolean(offerSupplierName(item)) &&
        (offerAmount(item) > 0 ||
          offerTermDays(item) > 0 ||
          offerPaymentDays(item) > 0 ||
          item?.score !== undefined ||
          item?.uygunMu !== undefined),
      rows,
    );
  });

  if (offerSupplierName(record)) rows.push(record);
  return rows;
}

function calculatePartnerScore({ partner, projects, orders, projectPayments, orderPayments, movements, reports, offers }) {
  let score = 100;
  const reasons = [];
  const strengths = [];
  const key = normalizePartnerName(partner.name);
  const isSupplier = partner.partner_type === "Tedarikçi";
  const isCustomer = partner.partner_type === "Müşteri";
  const today = new Date();

  const allOfferRows = [...reports, ...offers].flatMap(extractOfferRowsFromRecord);
  const supplierOffers = allOfferRows.filter((row) => normalizePartnerName(offerSupplierName(row)) === key);
  const recommendedCount = reports.filter((report) => normalizePartnerName(offerSupplierName(report) || report.recommended_firm || report.onerilenFirma || report.onerilenfirma) === key).length;
  const eligibleOffers = supplierOffers.filter(isOfferEligible);
  const shortPaymentTerms = supplierOffers.filter((row) => offerPaymentDays(row) > 0 && offerPaymentDays(row) < 30).length;
  const longTerms = supplierOffers.filter((row) => offerTermDays(row) > 0 && offerTermDays(row) > 30).length;
  const rejectedOffers = supplierOffers.length - eligibleOffers.length;

  const overdueOrders = orders.filter((order) => {
    const due = order.termin_date || order.delivery_date || order.due_date;
    if (!due) return false;
    const status = String(order.status || order.durum || "").toLocaleLowerCase("tr-TR");
    return new Date(due) < today && !["teslim", "tamam", "kapandı", "closed", "completed"].some((text) => status.includes(text));
  });
  const damageSignals = movements.filter((movement) =>
    ["hasar", "iade", "eksik", "red", "kusur"].some((text) =>
      String([movement.source, movement.note, movement.description, movement.movement_type].filter(Boolean).join(" ")).toLocaleLowerCase("tr-TR").includes(text),
    ),
  );

  if (isSupplier || supplierOffers.length || orders.length) {
    if (supplierOffers.length >= 3 && recommendedCount === 0) {
      score -= 10;
      reasons.push(`${supplierOffers.length} teklif içinde önerilen tedarikçi olmamış.`);
    }
    if (supplierOffers.length > 0 && rejectedOffers / supplierOffers.length > 0.35) {
      score -= 12;
      reasons.push(`Tekliflerin %${Math.round((rejectedOffers / supplierOffers.length) * 100)} kadarı kriter dışı veya zayıf görünüyor.`);
    }
    if (shortPaymentTerms > 0) {
      score -= Math.min(12, shortPaymentTerms * 3);
      reasons.push(`${shortPaymentTerms} teklifte kısa ödeme vadesi tespit edildi.`);
    }
    if (longTerms > 0) {
      score -= Math.min(15, longTerms * 3);
      reasons.push(`${longTerms} teklifte uzun/geç termin tespit edildi.`);
    }
    if (overdueOrders.length > 0) {
      score -= Math.min(20, overdueOrders.length * 5);
      reasons.push(`${overdueOrders.length} siparişte termin/tamamlanma riski var.`);
    }
    if (damageSignals.length > 0) {
      score -= Math.min(20, damageSignals.length * 5);
      reasons.push(`${damageSignals.length} stok hareketinde hasar/iade/eksik sinyali var.`);
    }
    if (recommendedCount > 0) strengths.push(`${recommendedCount} analizde avantajlı/önerilen tedarikçi olmuş.`);
    if (orders.length > 0 && overdueOrders.length === 0) strengths.push("Bağlı siparişlerde açık gecikme sinyali yok.");
    if (supplierOffers.length > 0 && rejectedOffers === 0) strengths.push("Analiz edilen tekliflerde kriter dışı sinyal yok.");
  }

  if (isCustomer || projects.length) {
    const activeProjects = projects.filter((project) => ["Onaylandı", "Devam Ediyor", "Tamamlandı"].includes(project.status));
    const draftProjects = projects.filter((project) => ["Taslak", "Teklif", "Bekliyor", "Onay Bekliyor"].includes(project.status));
    const contractTotal = projects.reduce((sum, project) => sum + safeNumber(project.contract_amount), 0);
    const paidTotal = projectPayments.reduce((sum, payment) => sum + safeNumber(payment.amount || payment.base_amount), 0);
    const pendingRatio = contractTotal > 0 ? Math.max(contractTotal - paidTotal, 0) / contractTotal : 0;
    const finishedUnpaid = projects.filter((project) => {
      const end = project.planned_end_date || project.end_date;
      if (!end) return false;
      const projectPaid = projectPayments.filter((payment) => payment.project_id === project.id).reduce((sum, payment) => sum + safeNumber(payment.amount || payment.base_amount), 0);
      return new Date(end) < today && safeNumber(project.contract_amount) > projectPaid;
    }).length;

    if (projects.length >= 3 && activeProjects.length / projects.length < 0.35) {
      score -= 14;
      reasons.push("Çok sayıda proje/talep var ama onaylanan iş oranı düşük.");
    }
    if (draftProjects.length >= 3) {
      score -= Math.min(12, draftProjects.length * 2);
      reasons.push(`${draftProjects.length} proje teklif/taslak aşamasında bekliyor.`);
    }
    if (pendingRatio > 0.4) {
      score -= Math.min(20, Math.round(pendingRatio * 20));
      reasons.push(`Bekleyen tahsilat oranı yüksek: %${Math.round(pendingRatio * 100)}.`);
    }
    if (finishedUnpaid > 0) {
      score -= Math.min(18, finishedUnpaid * 6);
      reasons.push(`${finishedUnpaid} projede planlanan bitiş sonrası tahsilat bekliyor.`);
    }
    if (activeProjects.length > 0) strengths.push(`${activeProjects.length} proje onaylı/devam eden/tamamlanan statüde.`);
    if (contractTotal > 0 && pendingRatio <= 0.25) strengths.push("Tahsilat disiplini sağlıklı görünüyor.");
  }

  if (reasons.length === 0) reasons.push("Kritik risk sinyali görülmedi; skor mevcut kayıtlara göre hesaplandı.");
  if (strengths.length === 0) strengths.push("Daha sağlıklı skor için teklif, ödeme, teslimat ve kalite geçmişi biriktikçe değerlendirme güçlenir.");

  return {
    value: clampScore(score),
    label: scoreLabel(clampScore(score)),
    reasons,
    strengths,
    supplierOffers,
    recommendedCount,
    rejectedOffers,
    shortPaymentTerms,
    longTerms,
    overdueOrders,
    damageSignals,
  };
}

function statusClass(status) {
  const classes = {
    Aktif: "bg-green-100 text-green-700",
    Pasif: "bg-slate-100 text-slate-600",
    "Onay Bekliyor": "bg-yellow-100 text-yellow-700",
    Riskli: "bg-red-100 text-red-700",
  };

  return classes[status] || "bg-slate-100 text-slate-600";
}

function typeClass(type) {
  const classes = {
    Müşteri: "bg-blue-100 text-blue-700",
    Tedarikçi: "bg-emerald-100 text-emerald-700",
    Taşeron: "bg-purple-100 text-purple-700",
    Nakliye: "bg-orange-100 text-orange-700",
    "Hizmet Sağlayıcı": "bg-cyan-100 text-cyan-700",
    Diğer: "bg-slate-100 text-slate-700",
  };

  return classes[type] || classes.Diğer;
}

function StatCard({ title, value, text }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{text}</div>
    </div>
  );
}

export default function BusinessPartnersPage() {
  const router = useRouter();
  const [partners, setPartners] = useState([]);
  const [projects, setProjects] = useState([]);
  const [orders, setOrders] = useState([]);
  const [projectPayments, setProjectPayments] = useState([]);
  const [orderPayments, setOrderPayments] = useState([]);
  const [movements, setMovements] = useState([]);
  const [reports, setReports] = useState([]);
  const [offers, setOffers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [typeFilter, setTypeFilter] = useState("Tümü");
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [partnerChoice, setPartnerChoice] = useState(null);

  async function loadData() {
    setLoading(true);
    setMessage("");
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    try {
    const partnerRes = await supabase
        .from("suppliers")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true });

    if (partnerRes.error) {
      console.error("İş ortakları listelenemedi:", partnerRes.error);
      setMessage(`İş ortakları listelenemedi: ${partnerRes.error.message || "Bilinmeyen sorgu hatası"}`);
      setPartners([]);
      return;
    }

    const basePartners = (partnerRes.data || [])
      .map(normalizePartnerRecord)
      .filter((partner) => partner.status !== "Silindi");
    setPartners(basePartners);

    const relatedResults = await Promise.allSettled([
      supabase
        .from("projects")
        .select("*")
        .eq("user_id", user.id),
      supabase
        .from("orders")
        .select("*")
        .eq("user_id", user.id),
      supabase
        .from("project_payments")
        .select("*")
        .eq("user_id", user.id),
      supabase
        .from("order_payments")
        .select("*")
        .eq("user_id", user.id),
      supabase
        .from("stock_movements")
        .select("*")
        .eq("user_id", user.id)
        .limit(500),
      supabase
        .from("reports")
        .select("*")
        .eq("user_id", user.id)
        .limit(500),
      supabase
        .from("offers")
        .select("*")
        .eq("user_id", user.id)
        .limit(500),
    ]);
    const [projectRes, orderRes, projectPaymentRes, orderPaymentRes, movementRes, reportRes, offerRes] = relatedResults.map((result) =>
      result.status === "fulfilled" ? result.value : { data: [], error: result.reason },
    );

      let backfillSummary = { createdCustomers: 0, linkedProjects: 0, existingCustomers: 0 };
      let dedupeSummary = { duplicateCount: 0 };
      let partnersAfterBackfill = partnerRes.data || [];
      try {
        backfillSummary = await backfillProjectCustomerPartners(
          supabase,
          user.id,
          projectRes.data || [],
          partnerRes.data || [],
        );
        const { data: partnerRowsAfterBackfill } = await supabase
        .from("suppliers")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true });
        partnersAfterBackfill = partnerRowsAfterBackfill || partnerRes.data || [];
        dedupeSummary = await deduplicateBusinessPartners(
          supabase,
          user.id,
          partnersAfterBackfill || partnerRes.data || [],
        );
      } catch (cleanupError) {
        console.error("İş ortağı otomatik eşleştirme atlandı:", cleanupError);
      }
      const shouldReloadPartners =
        backfillSummary.createdCustomers > 0 ||
        backfillSummary.linkedProjects > 0 ||
        backfillSummary.existingCustomers > 0 ||
        dedupeSummary.duplicateCount > 0;
      const { data: refreshedPartnerData } = shouldReloadPartners
        ? await supabase
            .from("suppliers")
            .select("*")
            .eq("user_id", user.id)
            .order("name", { ascending: true })
        : { data: partnerRes.data || [] };
      const { data: refreshedProjectData } = shouldReloadPartners
        ? await supabase
            .from("projects")
            .select("*")
            .eq("user_id", user.id)
        : { data: projectRes.data || [] };
      const rows = (refreshedPartnerData || [])
        .map(normalizePartnerRecord)
        .filter((partner) => partner.status !== "Silindi");
      setPartners(rows);
      setProjects(refreshedProjectData || []);

    const relatedErrors = [projectRes, orderRes, projectPaymentRes, orderPaymentRes, movementRes, reportRes, offerRes]
      .map((result) => result?.error)
      .filter(Boolean);
    if (relatedErrors.length > 0) {
      console.error("İş ortakları yardımcı verileri eksik yüklendi:", relatedErrors);
      setMessage("İş ortakları yüklendi; bazı bağlantılı bilgiler okunamadı.");
    }

    if (!projectRes.error) setProjects(projectRes.data || []);
    setOrders(orderRes.data || []);
    setProjectPayments(projectPaymentRes.data || []);
    setOrderPayments(orderPaymentRes.data || []);
    setMovements(movementRes.data || []);
    setReports(reportRes.data || []);
    setOffers(offerRes.data || []);
    } catch (error) {
      console.error(error);
      setMessage(error?.message || "İş ortakları yüklenemedi.");
      setPartners([]);
    } finally {
      setLoading(false);
    }
  }

  const partnerStats = useMemo(() => {
    return {
      total: partners.length,
      customers: partners.filter(
        (partner) => partner.partner_type === "Müşteri",
      ).length,
      suppliers: partners.filter(
        (partner) => partner.partner_type === "Tedarikçi",
      ).length,
      risk: partners.filter((partner) =>
        ["Riskli", "Pasif", "Onay Bekliyor"].includes(partner.status),
      ).length,
    };
  }, [partners]);

  // Initial page hydration only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadData reads current auth state on mount.
  useEffect(() => {
    loadData();
  }, []);

  const metricsFor = useCallback(
    (partner) => {
      const key = normalizePartnerName(partner.name);
      const partnerOrders = orders.filter((order) => {
        if (order.partner_id && order.partner_id === partner.id) return true;
        return (
          normalizePartnerName(order.partner_name || order.supplier_name) ===
          key
        );
      });
      const partnerProjects = projects.filter((project) => {
        if (
          project.customer_partner_id &&
          project.customer_partner_id === partner.id
        )
          return true;
        return (
          normalizePartnerName(
            project.customer_partner_name || project.customer_name,
          ) === key
        );
      });
      const partnerProjectIds = new Set(partnerProjects.map((project) => project.id));
      const projectOrders = orders.filter((order) => order.project_id && partnerProjectIds.has(order.project_id));
      const allRelatedOrders = [...new Map([...partnerOrders, ...projectOrders].map((order) => [order.id, order])).values()];
      const relatedOrderIds = new Set(allRelatedOrders.map((order) => order.id));
      const partnerProjectPayments = projectPayments.filter((payment) => partnerProjectIds.has(payment.project_id));
      const partnerOrderPayments = orderPayments.filter((payment) => relatedOrderIds.has(payment.order_id));
      const partnerMovements = movements.filter((movement) => {
        if (movement.partner_id && movement.partner_id === partner.id)
          return true;
        return (
          normalizePartnerName(
            movement.partner_name || movement.supplier_name,
          ) === key
        );
      });
      const performance = calculatePartnerScore({
        partner,
        projects: partnerProjects,
        orders: allRelatedOrders,
        projectPayments: partnerProjectPayments,
        orderPayments: partnerOrderPayments,
        movements: partnerMovements,
        reports,
        offers,
      });

      const contractTotals = new Map();
      const estimatedTotals = new Map();
      const receivedPaymentTotals = new Map();
      const pendingPaymentTotals = new Map();
      const projectOrderTotals = new Map();
      const orderPaymentTotals = new Map();
      const supplierDebtTotals = new Map();
      const profitTotals = new Map();

      partnerProjects.forEach((project) => {
        const contractCurrency = projectContractCurrency(project);
        const budgetCurrency = projectBudgetCurrency(project);
        const contractAmount = Number(project.contract_amount || 0);
        const estimatedBudget = Number(project.estimated_budget || project.actual_cost || 0);
        const projectPaymentsTotal = partnerProjectPayments
          .filter((payment) => payment.project_id === project.id)
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const orderTotal = orders
          .filter((order) => order.project_id === project.id)
          .reduce((sum, order) => sum + Number(order.total_amount || order.order_total || order.total || 0), 0);

        addMoney(contractTotals, contractCurrency, contractAmount);
        addMoney(estimatedTotals, budgetCurrency, estimatedBudget);
        addMoney(receivedPaymentTotals, contractCurrency, projectPaymentsTotal);
        addMoney(pendingPaymentTotals, contractCurrency, Math.max(contractAmount - projectPaymentsTotal, 0));
        addMoney(projectOrderTotals, budgetCurrency, orderTotal);
        addMoney(profitTotals, contractCurrency, contractAmount - orderTotal);
      });

      allRelatedOrders.forEach((order) => {
        const currency = order.currency || order.para_birimi || "TRY";
        const orderAmount = Number(order.total_amount || order.order_total || order.total || 0);
        const paidAmount = partnerOrderPayments
          .filter((payment) => payment.order_id === order.id)
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0) || Number(order.paid_amount || 0);

        addMoney(orderPaymentTotals, currency, paidAmount);
        addMoney(supplierDebtTotals, currency, Math.max(orderAmount - paidAmount, 0));
      });

      const projectRows = partnerProjects.map((project) => {
        const contractCurrency = projectContractCurrency(project);
        const budgetCurrency = projectBudgetCurrency(project);
        const projectPaymentRows = partnerProjectPayments.filter((payment) => payment.project_id === project.id);
        const projectOrderRows = orders.filter((order) => order.project_id === project.id);
        const paid = projectPaymentRows.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const contract = Number(project.contract_amount || 0);
        const orderTotal = projectOrderRows.reduce((sum, order) => sum + Number(order.total_amount || order.order_total || order.total || 0), 0);

        return {
          ...project,
          contractCurrency,
          budgetCurrency,
          paid,
          pending: Math.max(contract - paid, 0),
          orderTotal,
          profitLoss: contract - orderTotal,
          paymentRows: projectPaymentRows,
          orderRows: projectOrderRows,
        };
      });

      return {
        orders: partnerOrders,
        relatedOrders: allRelatedOrders,
        projectOrders,
        projects: partnerProjects,
        projectRows,
        projectPayments: partnerProjectPayments,
        orderPayments: partnerOrderPayments,
        movements: partnerMovements,
        totalOrderAmount: partnerOrders.reduce(
          (sum, order) => sum + Number(order.total_amount || 0),
          0,
        ),
        contractTotals: moneyRows(contractTotals),
        estimatedTotals: moneyRows(estimatedTotals),
        receivedPaymentTotals: moneyRows(receivedPaymentTotals),
        pendingPaymentTotals: moneyRows(pendingPaymentTotals),
        projectOrderTotals: moneyRows(projectOrderTotals),
        orderPaymentTotals: moneyRows(orderPaymentTotals),
        supplierDebtTotals: moneyRows(supplierDebtTotals),
        profitTotals: moneyRows(profitTotals),
        performance,
      };
    },
    [orders, projects, projectPayments, orderPayments, movements, reports, offers],
  );

  const enrichedPartners = useMemo(
    () =>
      partners.map((partner) => ({
        ...partner,
        metrics: metricsFor(partner),
      })),
    [partners, metricsFor],
  );

  const filteredPartners = useMemo(() => {
    const needle = normalizePartnerName(search);
    return enrichedPartners.filter((partner) => {
      const typeMatch =
        typeFilter === "Tümü" || partner.partner_type === typeFilter;
      const statusMatch =
        statusFilter === "Tümü" || partner.status === statusFilter;
      const searchMatch = needle
        ? normalizePartnerName(
            [
              partner.name,
              partner.partner_type,
              partner.contact_person,
              partner.phone,
              partner.email,
              partner.city,
              partner.tax_number,
            ].join(" "),
          ).includes(needle)
        : true;

      return typeMatch && statusMatch && searchMatch;
    });
  }, [enrichedPartners, search, typeFilter, statusFilter]);

  const selectedPartner =
    enrichedPartners.find((partner) => partner.id === selectedId) ||
    null;
  const duplicateTaxPartner = useMemo(
    () => findPartnerByTaxNumber(partners, form.tax_number, { excludeId: editingId || "" }),
    [editingId, form.tax_number, partners],
  );

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === "name" || field === "tax_number") setPartnerChoice(null);
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
    setDetailOpen(false);
    setMessage("");
    setPartnerChoice(null);
  }

  function startEdit(partner) {
    setEditingId(partner.id);
    setSelectedId(partner.id);
    setFormOpen(true);
    setDetailOpen(true);
    setForm({
      name: partner.name || "",
      partner_type: partner.partner_type || "Tedarikçi",
      contact_person: partner.contact_person || "",
      phone: partner.phone || "",
      email: partner.email || "",
      tax_number: partner.tax_number || "",
      city: partner.city || "",
      address: partner.address || "",
      notes: partner.notes || "",
      status: partner.status || "Aktif",
    });
    setMessage("");
    setPartnerChoice({ mode: "existing", partnerId: partner.id });
  }

  async function savePartner(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const cleanName = form.name.trim().replace(/\s+/g, " ");
    if (!cleanName) {
      setMessage("İş ortağı adı zorunlu.");
      setSaving(false);
      return;
    }

    const payload = {
      user_id: user.id,
      name: cleanName,
      partner_type: form.partner_type || "Diğer",
      category: form.partner_type || "Diğer",
      normalized_name: normalizePartnerName(cleanName),
      contact_person: form.contact_person || "",
      contact_name: form.contact_person || "",
      phone: form.phone || "",
      email: form.email || "",
      tax_number: normalizeTaxNumber(form.tax_number),
      tax_no: normalizeTaxNumber(form.tax_number),
      city: form.city || "",
      address: form.address || "",
      notes: form.notes || "",
      status: form.status || "Aktif",
      updated_at: new Date().toISOString(),
    };
    const duplicateTaxPartner = findPartnerByTaxNumber(partners, payload.tax_number, { excludeId: editingId || "" });
    if (duplicateTaxPartner) {
      setSaving(false);
      setMessage(duplicateTaxNumberMessage(duplicateTaxPartner));
      return;
    }

    if (!editingId) {
      const matches = findPartnerMatches(partners, {
        name: payload.name,
        taxNumber: payload.tax_number,
        email: payload.email,
        phone: payload.phone,
      });
      let partner = partnerChoice?.mode === "existing"
        ? partners.find((item) => item.id === partnerChoice.partnerId)
        : matches.find((match) => match.type === "exact")?.partner;

      try {
        if (!partner) {
          partner = await findOrCreateBusinessPartner(supabase, user.id, {
            name: payload.name,
            partnerType: payload.partner_type,
            taxNumber: payload.tax_number,
            email: payload.email,
            phone: payload.phone,
            contactPerson: payload.contact_person,
            city: payload.city,
            address: payload.address,
            notes: payload.notes,
            allowCreate: false,
          });
        }

        if (!partner && (partnerChoice?.mode === "new" || matches.length === 0)) {
          partner = await findOrCreateBusinessPartner(supabase, user.id, {
            name: payload.name,
            partnerType: payload.partner_type,
            taxNumber: payload.tax_number,
            email: payload.email,
            phone: payload.phone,
            contactPerson: payload.contact_person,
            city: payload.city,
            address: payload.address,
            notes: payload.notes,
            forceCreate: true,
            rejectDuplicateTax: true,
          });
        }
      } catch (error) {
        setSaving(false);
        setMessage(error.code === "DUPLICATE_TAX_NUMBER"
          ? error.message
          : error.message || "İş ortağı kaydedilemedi.");
        return;
      }

      setSaving(false);

      if (!partner?.id) {
        setMessage(
          matches.length > 0
            ? "Benzer firma bulundu. Mevcut firmayı kullanın veya yeni firma oluşturmayı açıkça seçin."
            : "Yeni firma kartı oluşturmak için aşağıdaki onay seçeneğini kullanın.",
        );
        return;
      }

      setEditingId(partner.id);
      setSelectedId(partner.id);
      setFormOpen(false);
      setDetailOpen(true);
      setMessage(
        "İş ortağı kaydedildi. Benzer kayıt varsa mevcut karta bağlandı.",
      );
      await loadData();
      return;
    }

    const request = supabase
      .from("suppliers")
      .update(payload)
      .eq("id", editingId)
      .eq("user_id", user.id)
      .select("*")
      .single();

    const { data, error } = await request;
    setSaving(false);

    if (error) {
      console.error(error);
      const isDuplicateTax = error.code === "23505" && String(error.message || "").includes("suppliers_user_tax_number_unique_idx");
      setMessage(isDuplicateTax ? "Bu vergi numarasıyla kayıtlı bir firma var. Aynı vergi numarasıyla ikinci firma kaydedilemez." : error.message || "İş ortağı kaydedilemedi.");
      return;
    }

    setEditingId(data.id);
    setSelectedId(data.id);
    setFormOpen(false);
    setDetailOpen(true);
    setMessage("İş ortağı kaydedildi.");
    await loadData();
  }

  async function deletePartner(partner) {
    if (!partner?.id) return;

    if (
      !window.confirm(
        "Bu iş ortağı silinsin mi? Bağlı kayıt varsa geçmiş bozulmasın diye kayıt listeden kaldırılır.",
      )
    ) {
      return;
    }

    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const currentMetrics = metricsFor(partner);
    const [paymentRes, receiptRes, reportRes] = await Promise.all([
      supabase
        .from("order_payments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("partner_id", partner.id),
      supabase
        .from("order_receipts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("partner_id", partner.id),
      supabase
        .from("reports")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("partner_id", partner.id),
    ]);

    const relationError =
      paymentRes.error || receiptRes.error || reportRes.error;
    if (relationError) {
      console.error("İş ortağı bağlantı kontrol hatası:", relationError);
      setMessage(relationError.message || "Bağlı kayıt kontrolü yapılamadı.");
      return;
    }

    const linkedCount =
      currentMetrics.orders.length +
      currentMetrics.projects.length +
      currentMetrics.movements.length +
      Number(paymentRes.count || 0) +
      Number(receiptRes.count || 0) +
      Number(reportRes.count || 0);


    if (linkedCount > 0) {
      const { error } = await supabase
        .from("suppliers")
        .update({
          status: "Silindi",
          updated_at: new Date().toISOString(),
        })
        .eq("id", partner.id)
        .eq("user_id", user.id)
        .select("id,status")
        .single();


      if (error) {
        console.error("İş ortağı pasife alınamadı:", error);
        setMessage(error.message || "İş ortağı pasife alınamadı.");
        return;
      }

      setMessage(
        "Bu iş ortağı bağlı kayıtları olduğu için geçmişten koparılmadı, aktif listeden kaldırıldı.",
      );
      setSelectedId(null);
      setEditingId((current) => (current === partner.id ? null : current));
      await loadData();
      return;
    }

    const { error } = await supabase
      .from("suppliers")
      .delete()
      .eq("id", partner.id)
      .eq("user_id", user.id)
      .select("id");


    if (error) {
      console.error("İş ortağı silinemedi:", error);
      setMessage(error.message || "İş ortağı silinemedi.");
      return;
    }

    setMessage("İş ortağı silindi.");
    setSelectedId(null);
    setEditingId(null);
    setDetailOpen(false);
    await loadData();
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
            Ticari taraf merkezi
          </div>
          <h1 className="mt-3 text-4xl font-black text-slate-950">
            İş Ortakları
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Müşteri, tedarikçi, taşeron, nakliye firması ve hizmet sağlayıcıları
            tek merkezden yönetin.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700"
        >
          + Yeni İş Ortağı
        </button>
      </div>

      {message && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard
          title="Toplam İş Ortağı"
          value={partnerStats.total}
          text="Tüm ticari taraflar"
        />
        <StatCard
          title="Müşteri"
          value={partnerStats.customers}
          text="Proje bağlantılı"
        />
        <StatCard
          title="Tedarikçi"
          value={partnerStats.suppliers}
          text="Teklif ve sipariş tarafı"
        />
        <StatCard
          title="Risk / Pasif"
          value={partnerStats.risk}
          text="İzlenmesi gereken kayıt"
        />
      </div>

      {formOpen && (
        <form
          onSubmit={savePartner}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-slate-950">
                {editingId ? "İş Ortağını Düzenle" : "Yeni İş Ortağı"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Firma kimliği, iletişim ve ticari durum bilgilerini düzenleyin.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Kapat
            </button>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-12">
            <label className="text-sm font-bold text-slate-700 md:col-span-12">
              İş ortağı adı
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.name}
                onChange={(event) => updateForm("name", event.target.value)}
              />
              {!editingId && String(form.name || "").trim().length >= 2 && (() => {
                const matches = findPartnerMatches(partners, {
                  name: form.name,
                  taxNumber: form.tax_number,
                  email: form.email,
                  phone: form.phone,
                }, { threshold: 0.65, limit: 3 });
                return (
                  <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <div className="text-xs font-black text-blue-900">Benzer firma önerileri</div>
                    <div className="mt-2 space-y-2">
                      {matches.map((match) => (
                        <button
                          key={match.partner.id}
                          type="button"
                          onClick={() => {
                            setForm((current) => ({ ...current, name: match.partner.name }));
                            setPartnerChoice({ mode: "existing", partnerId: match.partner.id });
                          }}
                          className={`flex w-full justify-between rounded-lg border bg-white px-3 py-2 text-left text-xs font-bold ${partnerChoice?.partnerId === match.partner.id ? "border-blue-500 text-blue-900" : "border-blue-100 text-slate-700"}`}
                        >
                          <span>{match.partner.name}</span>
                          <span>%{Math.round(match.score * 100)} · Mevcut firmayı kullan</span>
                        </button>
                      ))}
                      {matches.length === 0 && <div className="text-xs text-slate-600">Benzer firma bulunamadı.</div>}
                      <button
                        type="button"
                        onClick={() => setPartnerChoice({ mode: "new" })}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-xs font-black ${partnerChoice?.mode === "new" ? "border-amber-500 bg-amber-100 text-amber-900" : "border-amber-200 bg-white text-amber-800"}`}
                      >
                        Yeni firma oluştur
                      </button>
                    </div>
                  </div>
                );
              })()}
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-6">
              Tür
              <select
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.partner_type}
                onChange={(event) =>
                  updateForm("partner_type", event.target.value)
                }
              >
                {partnerTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-6">
              Durum
              <select
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.status}
                onChange={(event) => updateForm("status", event.target.value)}
              >
                {statusOptions
                  .filter((status) => status !== "Tümü")
                  .map((status) => (
                    <option key={status}>{status}</option>
                  ))}
              </select>
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-6">
              Yetkili
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.contact_person}
                onChange={(event) =>
                  updateForm("contact_person", event.target.value)
                }
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-6">
              Telefon
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.phone}
                onChange={(event) => updateForm("phone", event.target.value)}
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-7">
              E-posta
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.email}
                onChange={(event) => updateForm("email", event.target.value)}
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-5">
              Vergi no
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.tax_number}
                onChange={(event) =>
                  updateForm("tax_number", event.target.value)
                }
              />
              {duplicateTaxPartner && (
                <span className="mt-2 block rounded-lg bg-red-50 p-2 text-xs font-black text-red-700">
                  {duplicateTaxNumberMessage(duplicateTaxPartner)}
                </span>
              )}
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-12">
              Şehir
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.city}
                onChange={(event) => updateForm("city", event.target.value)}
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-12">
              Adres
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.address}
                onChange={(event) => updateForm("address", event.target.value)}
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-12">
              Notlar
              <textarea
                rows={4}
                className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.notes}
                onChange={(event) => updateForm("notes", event.target.value)}
              />
            </label>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving || Boolean(duplicateTaxPartner)}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300"
            >
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={startCreate}
                className="rounded-xl border border-slate-300 px-6 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Yeni kayıt
              </button>
            )}
          </div>
        </form>
      )}

      <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px_180px]">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="İş ortağı adı, telefon, e-posta veya şehir ara..."
                className="rounded-xl border border-slate-300 p-3 text-sm"
              />
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm font-bold"
              >
                <option>Tümü</option>
                {partnerTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm font-bold"
              >
                {statusOptions.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-xl font-bold text-slate-900">
                İş Ortağı Listesi
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {loading
                  ? "Yükleniyor..."
                  : `${filteredPartners.length} kayıt gösteriliyor.`}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-4">İş ortağı</th>
                    <th className="p-4">Tür</th>
                    <th className="p-4">Yetkili</th>
                    <th className="p-4">İletişim</th>
                    <th className="p-4">Şehir</th>
                    <th className="p-4">Sipariş</th>
                    <th className="p-4">Toplam alış</th>
                    <th className="p-4">Projeler</th>
                    <th className="p-4">Puan</th>
                    <th className="p-4">Durum</th>
                    <th className="p-4 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPartners.map((partner) => (
                    <tr
                      key={partner.id}
                      onClick={() => setSelectedId(partner.id)}
                      className={`cursor-pointer border-t border-slate-100 hover:bg-blue-50 ${selectedPartner?.id === partner.id ? "bg-blue-50" : ""}`}
                    >
                      <td className="p-4 font-black text-slate-900">
                        {partner.name}
                      </td>
                      <td className="p-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${typeClass(partner.partner_type)}`}
                        >
                          {partner.partner_type}
                        </span>
                      </td>
                      <td className="p-4">{partner.contact_person || "-"}</td>
                      <td className="p-4">
                        <div>{partner.phone || "-"}</div>
                        <div className="text-xs text-slate-500">
                          {partner.email || "-"}
                        </div>
                      </td>
                      <td className="p-4">{partner.city || "-"}</td>
                      <td className="p-4 font-bold">
                        {partner.metrics.orders.length}
                      </td>
                      <td className="p-4 font-bold">
                        {formatMoney(partner.metrics.totalOrderAmount)}
                      </td>
                      <td className="p-4 font-bold">
                        {partner.metrics.projects.length}
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex min-w-16 justify-center rounded-full px-3 py-1 text-xs font-black ${scoreTone(partner.metrics.performance.value)}`}>
                          {partner.metrics.performance.value} · {partner.metrics.performance.label}
                        </span>
                      </td>
                      <td className="p-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(partner.status)}`}
                        >
                          {partner.status || "Aktif"}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedId(partner.id);
                              setFormOpen(false);
                              setDetailOpen(true);
                            }}
                            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
                          >
                            Detay
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              startEdit(partner);
                            }}
                            className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              deletePartner(partner);
                            }}
                            className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                          >
                            Sil
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && filteredPartners.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-500">
                Kayıt bulunamadı.
              </div>
            )}
          </div>

          {detailOpen && selectedPartner && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-blue-600">
                    İş ortağı detayı
                  </div>
                  <h2 className="mt-1 text-2xl font-black text-slate-900">
                    {selectedPartner.name}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${typeClass(selectedPartner.partner_type)}`}
                    >
                      {selectedPartner.partner_type}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(selectedPartner.status)}`}
                    >
                      {selectedPartner.status || "Aktif"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(selectedPartner)}
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
                  >
                    Düzenle
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePartner(selectedPartner)}
                    className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700 hover:bg-red-100"
                  >
                    Sil
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailOpen(false)}
                    className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Kapat
                  </button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <Info label="Yetkili" value={selectedPartner.contact_person} />
                <Info label="Telefon" value={selectedPartner.phone} />
                <Info label="E-posta" value={selectedPartner.email} />
                <Info label="Vergi No" value={selectedPartner.tax_number} />
                <Info label="Şehir" value={selectedPartner.city} />
                <Info label="Adres" value={selectedPartner.address} />
              </div>

              <PerformancePanel partner={selectedPartner} />

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MoneySummary title="Sözleşme Bedeli" rows={selectedPartner.metrics.contractTotals} empty="0,00" />
                <MoneySummary title="Alınan Ödemeler" rows={selectedPartner.metrics.receivedPaymentTotals} empty="0,00" tone="green" />
                <MoneySummary title="Bekleyen Tahsilat" rows={selectedPartner.metrics.pendingPaymentTotals} empty="0,00" tone="orange" />
                <MoneySummary title="Proje Siparişleri" rows={selectedPartner.metrics.projectOrderTotals} empty="0,00" />
                <MoneySummary title="Sipariş Ödemeleri" rows={selectedPartner.metrics.orderPaymentTotals} empty="0,00" tone="green" />
                <MoneySummary title="Kalan İş Ortağı Borcu" rows={selectedPartner.metrics.supplierDebtTotals} empty="0,00" tone="red" />
                <MoneySummary title="Tahmini / Maliyet" rows={selectedPartner.metrics.estimatedTotals} empty="0,00" />
                <MoneySummary title="Kâr / Zarar" rows={selectedPartner.metrics.profitTotals} empty="0,00" tone="blue" />
              </div>

              <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
                <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-black text-slate-950">Bağlı Projeler ve Finans</div>
                    <div className="text-xs font-semibold text-slate-500">
                      {selectedPartner.metrics.projectRows.length} proje · sözleşme, tahsilat, bekleyen ödeme ve sipariş maliyeti
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push(`/dashboard/finans?is_ortagi=${encodeURIComponent(selectedPartner.name)}`)}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                  >
                    Finans ekranına git
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(`/dashboard/projeler?musteri=${encodeURIComponent(selectedPartner.name)}`)}
                    className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50"
                  >
                    Projeler sayfasında göster
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-white text-xs uppercase text-slate-500">
                      <tr>
                        <th className="p-4">Proje</th>
                        <th className="p-4">Sözleşme</th>
                        <th className="p-4">Tahsilat</th>
                        <th className="p-4">Bekleyen</th>
                        <th className="p-4">Sipariş</th>
                        <th className="p-4">Kâr / Zarar</th>
                        <th className="p-4 text-right">İşlem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPartner.metrics.projectRows.map((project) => (
                        <tr key={project.id} className="border-t border-slate-100">
                          <td className="p-4">
                            <div className="font-black text-slate-950">{projectTitle(project)}</div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">{project.status || "-"}</div>
                          </td>
                          <td className="p-4 font-bold">{formatMoney(project.contract_amount, project.contractCurrency)}</td>
                          <td className="p-4 font-bold text-emerald-700">{formatMoney(project.paid, project.contractCurrency)}</td>
                          <td className="p-4 font-bold text-orange-700">{formatMoney(project.pending, project.contractCurrency)}</td>
                          <td className="p-4 font-bold">{formatMoney(project.orderTotal, project.budgetCurrency)}</td>
                          <td className={`p-4 font-black ${project.profitLoss < 0 ? "text-red-700" : "text-emerald-700"}`}>
                            {formatMoney(project.profitLoss, project.contractCurrency)}
                          </td>
                          <td className="p-4 text-right">
                            <button
                              type="button"
                              onClick={() => router.push(`/dashboard/projeler/${project.id}`)}
                              className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                            >
                              Projeyi Aç
                            </button>
                          </td>
                        </tr>
                      ))}
                      {selectedPartner.metrics.projectRows.length === 0 && (
                        <tr>
                          <td colSpan="7" className="p-8 text-center text-slate-500">
                            Bu iş ortağına bağlı proje yok.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50 p-4">
                  <div className="text-sm font-black text-slate-950">Sipariş ve Tedarik Finansmanı</div>
                  <div className="text-xs font-semibold text-slate-500">
                    {selectedPartner.metrics.relatedOrders.length} sipariş · geçilen sipariş, ödeme, kalan borç ve termin takibi
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-white text-xs uppercase text-slate-500">
                      <tr>
                        <th className="p-4">Sipariş / Proje</th>
                        <th className="p-4">Tutar</th>
                        <th className="p-4">Ödenen</th>
                        <th className="p-4">Kalan</th>
                        <th className="p-4">Termin</th>
                        <th className="p-4">Durum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPartner.metrics.relatedOrders.map((order) => {
                        const currency = order.currency || order.para_birimi || "TRY";
                        const amount = safeNumber(order.total_amount || order.order_total || order.total);
                        const paid =
                          selectedPartner.metrics.orderPayments
                            .filter((payment) => payment.order_id === order.id)
                            .reduce((sum, payment) => sum + safeNumber(payment.amount || payment.base_amount), 0) ||
                          safeNumber(order.paid_amount || order.paid_amount_base);
                        const project = selectedPartner.metrics.projectRows.find((row) => row.id === order.project_id);
                        return (
                          <tr key={order.id} className="border-t border-slate-100">
                            <td className="p-4">
                              <div className="font-black text-slate-950">{order.order_no || order.order_number || order.id}</div>
                              <div className="mt-1 text-xs font-semibold text-slate-500">{project ? projectTitle(project) : order.project_name || "-"}</div>
                            </td>
                            <td className="p-4 font-bold">{formatMoney(amount, currency)}</td>
                            <td className="p-4 font-bold text-emerald-700">{formatMoney(paid, currency)}</td>
                            <td className="p-4 font-bold text-red-700">{formatMoney(Math.max(amount - paid, 0), currency)}</td>
                            <td className="p-4">{formatDate(order.termin_date || order.delivery_date || order.due_date)}</td>
                            <td className="p-4">
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                                {order.status || order.durum || "Bekliyor"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {selectedPartner.metrics.relatedOrders.length === 0 && (
                        <tr>
                          <td colSpan="6" className="p-8 text-center text-slate-500">
                            Bu iş ortağına bağlı sipariş yok.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <PaymentTimeline
                  title="Proje Ödeme / Tahsilat Hareketleri"
                  rows={selectedPartner.metrics.projectPayments}
                  projectRows={selectedPartner.metrics.projectRows}
                />
                <PaymentTimeline
                  title="Sipariş Ödeme Hareketleri"
                  rows={selectedPartner.metrics.orderPayments}
                  orders={selectedPartner.metrics.relatedOrders}
                />
              </div>

              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                <div className="font-bold text-slate-900">Notlar</div>
                <div className="mt-1">
                  {selectedPartner.notes || "Not bulunmuyor."}
                </div>
              </div>
            </div>
          )}
        </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-slate-900">
        {value || "-"}
      </div>
    </div>
  );
}

function PerformancePanel({ partner }) {
  const performance = partner.metrics.performance;
  const isSupplier = partner.partner_type === "Tedarikçi";

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">
            Ticari performans puanı
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className={`rounded-2xl px-4 py-2 text-2xl font-black ${scoreTone(performance.value)}`}>
              {performance.value}
            </span>
            <div>
              <div className="text-lg font-black text-slate-950">{performance.label}</div>
              <div className="text-sm font-semibold text-slate-500">
                {isSupplier
                  ? "Teklif, vade, termin, sipariş ve teslimat sinyallerinden hesaplandı."
                  : "Proje kazanımı, tahsilat ve bekleyen ödeme sinyallerinden hesaplandı."}
              </div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <MiniMetric label="Teklif" value={performance.supplierOffers.length} />
          <MiniMetric label="Önerilen" value={performance.recommendedCount} />
          <MiniMetric label="Geciken sipariş" value={performance.overdueOrders.length} tone={performance.overdueOrders.length > 0 ? "red" : "green"} />
          <MiniMetric label="Kalite sinyali" value={performance.damageSignals.length} tone={performance.damageSignals.length > 0 ? "red" : "green"} />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl bg-white p-4">
          <div className="text-sm font-black text-slate-950">Puanı etkileyen noktalar</div>
          <ul className="mt-3 space-y-2 text-sm font-semibold text-slate-700">
            {performance.reasons.map((reason) => (
              <li key={reason} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-white p-4">
          <div className="text-sm font-black text-slate-950">Güçlü taraflar</div>
          <ul className="mt-3 space-y-2 text-sm font-semibold text-slate-700">
            {performance.strengths.map((reason) => (
              <li key={reason} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-white text-slate-950",
    green: "bg-emerald-50 text-emerald-800",
    red: "bg-red-50 text-red-800",
  };

  return (
    <div className={`rounded-xl p-3 ${tones[tone] || tones.slate}`}>
      <div className="text-xs font-bold opacity-70">{label}</div>
      <div className="mt-1 text-lg font-black">{value}</div>
    </div>
  );
}

function MoneySummary({ title, rows, empty = "0,00", tone = "slate" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-950",
    green: "bg-emerald-50 text-emerald-800",
    orange: "bg-orange-50 text-orange-800",
    red: "bg-red-50 text-red-800",
    blue: "bg-blue-50 text-blue-800",
  };

  return (
    <div className={`rounded-xl p-4 ${tones[tone] || tones.slate}`}>
      <div className="text-xs font-black uppercase tracking-wide opacity-70">{title}</div>
      <div className="mt-2 space-y-1">
        {rows?.length > 0 ? (
          rows.map((row) => (
            <div key={`${title}-${row.currency}`} className="break-words text-lg font-black leading-tight">
              {formatMoney(row.amount, row.currency)}
            </div>
          ))
        ) : (
          <div className="text-lg font-black leading-tight">{empty}</div>
        )}
      </div>
    </div>
  );
}

function PaymentTimeline({ title, rows, projectRows = [], orders = [] }) {
  const projectById = new Map(projectRows.map((project) => [project.id, project]));
  const orderById = new Map(orders.map((order) => [order.id, order]));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="font-black text-slate-950">{title}</div>
      <div className="mt-3 space-y-2">
        {rows?.length > 0 ? (
          rows.slice(0, 12).map((row) => {
            const project = projectById.get(row.project_id);
            const order = orderById.get(row.order_id);
            const label = project ? projectTitle(project) : order?.order_no || order?.product_name || "Bağlı kayıt";
            const amount = Number(row.amount || row.base_amount || 0);
            const currency = row.currency || row.base_currency || order?.currency || project?.contractCurrency || "TRY";

            return (
              <div key={row.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate font-black text-slate-900" title={label}>{label}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {formatDate(row.payment_date || row.date || row.created_at)} · {row.payment_type || row.type || row.method || "Ödeme"} · {row.description || row.note || "-"}
                    </div>
                  </div>
                  <div className="whitespace-nowrap font-black text-slate-950">{formatMoney(amount, currency)}</div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            Kayıt yok.
          </div>
        )}
      </div>
    </div>
  );
}

function DetailList({ title, rows }) {
  return (
    <div className="rounded-xl border border-slate-100 p-4">
      <div className="font-bold text-slate-900">{title}</div>
      <div className="mt-3 space-y-2">
        {rows.length > 0
          ? rows.map((row) => (
              <div
                key={`${title}-${row}`}
                className="rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-600"
              >
                {row}
              </div>
            ))
          : <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              Kayıt yok.
            </div>}
      </div>
    </div>
  );
}
