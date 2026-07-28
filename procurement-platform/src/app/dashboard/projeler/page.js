"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  duplicateTaxNumberMessage,
  findOrCreateBusinessPartner,
  findPartnerByTaxNumber,
  normalizeTaxNumber,
} from "@/lib/businessPartners";
import { calculateBaseAmount, currencyOptions, formatMoney, getBaseCurrency, getExchangeRate } from "@/lib/currency";
import { fetchLiveTryRates, liveCurrencyOptions, liveRateFor } from "@/lib/liveCurrency";
import { hierarchyQuantityFields } from "@/lib/projectHierarchy";

const statusOptions = ["Taslak", "Onaylandı", "Devam Ediyor", "Tamamlandı", "Arşivlendi", "İptal"];

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const UNCATEGORIZED_PREVIEW_CATEGORY = "Kategorisiz Ürünler";

const emptyForm = {
  project_code: "",
  project_name: "",
  customer_name: "",
  description: "",
  contract_amount: "",
  contract_currency: "TRY",
  contract_exchange_rate: 1,
  estimated_budget: "",
  estimated_budget_currency: "TRY",
  estimated_budget_exchange_rate: 1,
  start_date: "",
  planned_end_date: "",
  project_owner: "",
  status: "Taslak",
};

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("tr-TR");
}

function dateValue(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function plannedEndBeforeStart(startDate, plannedEndDate) {
  const start = dateValue(startDate);
  const end = dateValue(plannedEndDate);
  return start !== null && end !== null && end < start;
}

function normalizeProjectFilter(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/\s+/g, " ");
}

function normalizePartnerName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/[.,;:]/g, "")
    .replace(/\s+/g, " ");
}

function findBusinessPartnerByName(partners, name) {
  const normalizedName = normalizePartnerName(name);
  if (!normalizedName) return null;
  return (partners || []).find((partner) => normalizePartnerName(partner.name) === normalizedName) || null;
}

function normalizeGroupName(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, "");
}

function previewRowCategory(row) {
  return row.section_name || row.category || row.parent_name || UNCATEGORIZED_PREVIEW_CATEGORY;
}

function isUncategorizedPreviewCategory(category) {
  return normalizeProjectFilter(category) === normalizeProjectFilter(UNCATEGORIZED_PREVIEW_CATEGORY);
}

function stripPayloadFields(payload, fields) {
  const cleanRow = (row) => Object.fromEntries(
    Object.entries(row || {}).filter(([key]) => !fields.includes(key)),
  );

  return Array.isArray(payload) ? payload.map(cleanRow) : cleanRow(payload);
}

function parsedRowQuantity(row) {
  return Number(row.estimated_quantity ?? row.quantity ?? 0) || 0;
}

function parsedRowTotal(row) {
  return Number(row.estimated_total ?? row.total ?? 0) || 0;
}

function parsedRowUnitPrice(row) {
  const quantity = parsedRowQuantity(row);
  const total = parsedRowTotal(row);
  const directPrice = Number(row.estimated_unit_price ?? row.unit_price ?? 0) || 0;
  if (total > 0 && quantity > 0) return total / quantity;
  return directPrice;
}

function sectionQuoteTotalForRows(name, rows, sections) {
  const target = normalizeGroupName(name);
  const sectionMatch = (sections || []).find((section) =>
    normalizeGroupName(section.section_name) === target && Number(section.section_total || 0) > 0
  );

  if (sectionMatch) return Number(sectionMatch.section_total || 0);
  return (rows || []).reduce((sum, row) => sum + parsedRowTotal(row), 0);
}

function nextProjectCode(projects) {
  const usedNumbers = new Set();
  let width = 5;

  for (const project of projects || []) {
    const match = String(project.project_code || "").match(/^PRJ-(\d+)$/i);
    if (match) {
      usedNumbers.add(Number(match[1]));
      width = Math.max(width, match[1].length);
    }
  }

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return `PRJ-${String(nextNumber).padStart(width, "0")}`;
}

function statusClass(status) {
  const classes = {
    Taslak: "bg-slate-100 text-slate-700",
    Onaylandı: "bg-blue-100 text-blue-700",
    "Devam Ediyor": "bg-emerald-100 text-emerald-700",
    Tamamlandı: "bg-green-100 text-green-700",
    Arşivlendi: "bg-slate-200 text-slate-700",
    İptal: "bg-red-100 text-red-700",
  };

  return classes[status] || "bg-slate-100 text-slate-700";
}

function projectListBadgeClass(tone) {
  const classes = {
    green: "border-emerald-100 bg-emerald-50 text-emerald-700",
    red: "border-red-100 bg-red-50 text-red-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    slate: "border-slate-100 bg-slate-50 text-slate-700",
  };

  return classes[tone] || classes.slate;
}

function quantityFromItem(item, fields) {
  return fields.reduce((value, field) => {
    const numericValue = Number(item?.[field] || 0);
    return numericValue > value ? numericValue : value;
  }, 0);
}

function formatQuantity(value) {
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(Number(value || 0));
}


function StatCard({ title, value, text }) {
  return (
    <div className="min-h-32 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-500">{title}</div>
      <div className="mt-3 text-3xl font-black leading-none text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{text}</div>
    </div>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [businessPartners, setBusinessPartners] = useState([]);
  const [customerFilter, setCustomerFilter] = useState("");
  const [relatedRows, setRelatedRows] = useState({
    items: [],
    requests: [],
    reports: [],
    offers: [],
    orders: [],
    movements: [],
    payments: [],
    revisions: [],
  });
  const [form, setForm] = useState(emptyForm);
  const [projectFiles, setProjectFiles] = useState([]);
  const [projectFileSummary, setProjectFileSummary] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState("");
  const [deleteBlocker, setDeleteBlocker] = useState(null);
  const [settings, setSettings] = useState({ default_currency: "TRY", base_currency: "TRY" });
  const [liveRates, setLiveRates] = useState(null);
  const [liveRateWarning, setLiveRateWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPartner, setSavingPartner] = useState(false);
  const [projectView, setProjectView] = useState("active");
  const [selectedProjectIds, setSelectedProjectIds] = useState([]);
  const [projectCodeEdited, setProjectCodeEdited] = useState(false);
  const [showCustomerPartnerForm, setShowCustomerPartnerForm] = useState(false);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [customerPartnerDraft, setCustomerPartnerDraft] = useState({
    name: "",
    contact_person: "",
    phone: "",
    email: "",
    tax_number: "",
    city: "",
  });

  useEffect(() => {
    loadProjects();
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setCustomerFilter(params.get("musteri") || "");
    }
    fetchLiveTryRates()
      .then((rates) => {
        setLiveRates(rates);
        setLiveRateWarning("");
      })
      .catch(() => {
        setLiveRates(null);
        setLiveRateWarning("Canlı kur alınamadı, manuel giriniz.");
      });
  }, []);

  async function loadProjects() {
    setLoading(true);
    setMessage("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Projeler listelenemedi:", error);
        setMessage(`Projeler listelenemedi: ${error.message || "Bilinmeyen sorgu hatası"}`);
        setProjects([]);
        return;
      }

      setProjects(data || []);
      setForm((prev) => ({
        ...prev,
        project_code: prev.project_code || nextProjectCode(data || []),
      }));

    const { data: partnerData } = await supabase
      .from("suppliers")
      .select("id,name,partner_type,status")
      .eq("user_id", user.id)
      .in("partner_type", ["Müşteri", "Diğer"])
      .order("name", { ascending: true });

    const [itemRes, requestRes, reportRes, offerRes, orderRes, movementRes, paymentRes, revisionRes] = await Promise.all([
      supabase.from("project_items").select("*").eq("user_id", user.id),
      supabase.from("requests").select("id,project_id").eq("user_id", user.id),
      supabase.from("reports").select("id,project_id").eq("user_id", user.id),
      supabase.from("offers").select("id,project_id").eq("user_id", user.id),
      supabase.from("orders").select("*").eq("user_id", user.id),
      supabase.from("stock_movements").select("id,project_id,project_item_id,reserved_quantity,quantity,movement_type,source").eq("user_id", user.id),
      supabase.from("project_payments").select("id,project_id").eq("user_id", user.id),
      supabase.from("project_revisions").select("id,project_id").eq("user_id", user.id),
    ]);

    const { data: settingsData } = await supabase
      .from("company_settings")
      .select("*")
      .eq("user_id", user.id)
      .limit(1);

    if (settingsData?.[0]) setSettings(settingsData[0]);
    setBusinessPartners(partnerData || []);
    setRelatedRows({
      items: itemRes.data || [],
      requests: requestRes.data || [],
      reports: reportRes.data || [],
      offers: offerRes.data || [],
      orders: orderRes.data || [],
      movements: movementRes.data || [],
      payments: paymentRes.data || [],
      revisions: revisionRes.data || [],
    });

    if ([itemRes, requestRes, reportRes, offerRes, orderRes, movementRes, paymentRes, revisionRes].some((result) => result.error)) {
      console.error("Proje yardımcı verileri eksik yüklendi:", [itemRes, requestRes, reportRes, offerRes, orderRes, movementRes, paymentRes, revisionRes].map((result) => result.error).filter(Boolean));
      setMessage("Projeler yüklendi; bazı bağlantılı bilgiler okunamadı.");
    }
    } catch (error) {
      console.error("Projeler yüklenemedi:", error);
      setMessage(`Projeler yüklenemedi: ${error?.message || "Beklenmeyen hata"}`);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  function openCreateForm() {
    setEditingId(null);
    setProjectCodeEdited(false);
    setProjectFiles([]);
    setProjectFileSummary("");
    setShowCustomerPartnerForm(false);
    setCustomerPartnerDraft({ name: "", contact_person: "", phone: "", email: "", tax_number: "", city: "" });
    setForm({
      ...emptyForm,
      project_code: nextProjectCode(projects),
      contract_currency: settings.default_currency || "TRY",
      estimated_budget_currency: settings.default_currency || "TRY",
      contract_exchange_rate: getExchangeRate(settings.default_currency || "TRY", settings),
      estimated_budget_exchange_rate: getExchangeRate(settings.default_currency || "TRY", settings),
    });
    setShowForm(true);
  }

  function openEditForm(project) {
    setEditingId(project.id);
    setProjectCodeEdited(true);
    setProjectFiles([]);
    setProjectFileSummary("");
    setShowCustomerPartnerForm(false);
    setCustomerPartnerDraft({ name: "", contact_person: "", phone: "", email: "", tax_number: "", city: "" });
    setForm({
      ...emptyForm,
      project_code: project.project_code || "",
      project_name: project.project_name || "",
      customer_name: project.customer_name || "",
      description: project.description || "",
      contract_amount: project.contract_amount || "",
      contract_currency: project.contract_currency || settings.default_currency || "TRY",
      contract_exchange_rate: project.contract_exchange_rate || getExchangeRate(project.contract_currency || "TRY", settings),
      estimated_budget: project.estimated_budget || "",
      estimated_budget_currency: project.estimated_budget_currency || settings.default_currency || "TRY",
      estimated_budget_exchange_rate: project.estimated_budget_exchange_rate || getExchangeRate(project.estimated_budget_currency || "TRY", settings),
      start_date: project.start_date || "",
      planned_end_date: project.planned_end_date || "",
      project_owner: project.project_owner || "",
      status: project.status || "Taslak",
    });
    setShowForm(true);
    setMessage("");
  }

  function updateForm(field, value) {
    if (field === "project_code") setProjectCodeEdited(true);
    if (field === "customer_name") {
      setShowCustomerPartnerForm(false);
      setCustomerPartnerDraft((prev) => ({ ...prev, name: value }));
    }
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateCustomerPartnerDraft(field, value) {
    setCustomerPartnerDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function createCustomerPartnerFromProject() {
    const cleanName = String(customerPartnerDraft.name || form.customer_name || "").trim().replace(/\s+/g, " ");
    const cleanPhone = String(customerPartnerDraft.phone || "").trim();
    const cleanEmail = String(customerPartnerDraft.email || "").trim();
    const cleanTaxNumber = normalizeTaxNumber(customerPartnerDraft.tax_number);
    const cleanCity = String(customerPartnerDraft.city || "").trim();
    const phoneDigits = cleanPhone.replace(/\D/g, "");
    const taxDigits = cleanTaxNumber;

    if (!cleanName) {
      setMessage("Firma adi zorunlu.");
      return;
    }
    if (!cleanPhone || phoneDigits.length < 10) {
      setMessage("Telefon numarasi zorunlu ve en az 10 rakam olmali.");
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setMessage("Gecerli bir e-posta adresi zorunlu.");
      return;
    }
    if (!cleanTaxNumber || ![10, 11].includes(taxDigits.length)) {
      setMessage("Vergi no zorunlu ve 10 ya da 11 rakam olmali.");
      return;
    }
    if (!cleanCity) {
      setMessage("Sehir zorunlu.");
      return;
    }

    const duplicateTaxPartner = findPartnerByTaxNumber(businessPartners, cleanTaxNumber);
    if (duplicateTaxPartner) {
      setMessage(duplicateTaxNumberMessage(duplicateTaxPartner));
      return;
    }

    setSavingPartner(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    let partner = null;
    try {
      partner = await findOrCreateBusinessPartner(supabase, user.id, {
        name: cleanName,
        partnerType: "Müşteri",
        contactPerson: customerPartnerDraft.contact_person,
        phone: cleanPhone,
        email: cleanEmail,
        taxNumber: cleanTaxNumber,
        city: cleanCity,
        allowCreate: true,
        allowProbableMatch: true,
        rejectDuplicateTax: true,
      });
    } catch (error) {
      setMessage(error.code === "DUPLICATE_TAX_NUMBER"
        ? error.message
        : error.message || "Firma bilgisi kaydedilemedi.");
      setSavingPartner(false);
      return;
    }

    if (!partner?.id) {
      setMessage("Firma bilgisi kaydedilemedi.");
      setSavingPartner(false);
      return;
    }

    setBusinessPartners((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== partner.id);
      return [...withoutDuplicate, partner].sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "tr"));
    });
    setForm((prev) => ({ ...prev, customer_name: partner.name }));
    setCustomerPartnerDraft({ name: partner.name, contact_person: "", phone: "", email: "", tax_number: "", city: "" });
    setShowCustomerPartnerForm(false);
    setMessage("Firma bilgisi oluşturuldu. Proje formuna devam edebilirsiniz.");
    setSavingPartner(false);
  }

  async function fetchProjectCodes(userId) {
    const { data, error } = await supabase
      .from("projects")
      .select("id,project_code")
      .eq("user_id", userId);

    if (error) throw error;
    return data || [];
  }

  function projectCodeAlreadyExists(projectRows, code, ignoredProjectId = null) {
    const normalizedCode = String(code || "").trim().toUpperCase();
    if (!normalizedCode) return false;
    return (projectRows || []).some((project) =>
      project.id !== ignoredProjectId
        && String(project.project_code || "").trim().toUpperCase() === normalizedCode
    );
  }

  async function resolveProjectCodeForSave(userId) {
    const latestProjects = await fetchProjectCodes(userId);
    const typedCode = String(form.project_code || "").trim();

    if (editingId) {
      if (projectCodeAlreadyExists(latestProjects, typedCode, editingId)) {
        throw new Error("Bu proje kodu başka bir projede kullanılıyor.");
      }
      return typedCode;
    }

    if (projectCodeEdited && typedCode) {
      if (projectCodeAlreadyExists(latestProjects, typedCode)) {
        throw new Error("Bu proje kodu daha önce kullanılmış. Lütfen farklı bir kod girin.");
      }
      return typedCode;
    }

    return nextProjectCode(latestProjects);
  }

  function normalizeRateInput(value) {
    return String(value ?? "").replace(",", ".");
  }

  function rateForProjectCurrency(currency) {
    if (!currency || currency === "TRY") {
      return { rate: 1, liveMissing: false };
    }

    const liveRate = liveRateFor(currency, liveRates);
    if (liveRate > 1) {
      return { rate: Number(liveRate.toFixed(6)), liveMissing: false };
    }

    const fallbackRate = Number(getExchangeRate(currency, settings) || 1);
    return { rate: fallbackRate > 0 ? fallbackRate : 1, liveMissing: true };
  }

  function updateCurrencyWithLiveRate(currencyField, rateField, nextCurrency) {
    const { rate, liveMissing } = rateForProjectCurrency(nextCurrency);
    setForm((prev) => ({
      ...prev,
      [currencyField]: nextCurrency,
      [rateField]: rate,
    }));
    setLiveRateWarning(liveMissing ? "Canlı kur alınamadı, manuel giriniz." : "");
  }

  function syncProjectFormLiveRates(rates = liveRates) {
    setForm((prev) => {
      const contractCurrency = prev.contract_currency || "TRY";
      const budgetCurrency = prev.estimated_budget_currency || "TRY";
      const nextContractRate = contractCurrency === "TRY" ? 1 : liveRateFor(contractCurrency, rates);
      const nextBudgetRate = budgetCurrency === "TRY" ? 1 : liveRateFor(budgetCurrency, rates);

      return {
        ...prev,
        contract_exchange_rate:
          nextContractRate > 1
            ? Number(nextContractRate.toFixed(6))
            : contractCurrency === "TRY"
              ? 1
              : prev.contract_exchange_rate || getExchangeRate(contractCurrency, settings) || 1,
        estimated_budget_exchange_rate:
          nextBudgetRate > 1
            ? Number(nextBudgetRate.toFixed(6))
            : budgetCurrency === "TRY"
              ? 1
              : prev.estimated_budget_exchange_rate || getExchangeRate(budgetCurrency, settings) || 1,
      };
    });
  }

  useEffect(() => {
    if (!showForm || !liveRates) return;
    syncProjectFormLiveRates(liveRates);
  }, [showForm, liveRates]);

  function updateProjectFiles(event) {
    const files = Array.from(event.target.files || []);
    const allowedFiles = files.filter((file) =>
      /\.(xlsx|xls|xlsm|pdf)$/i.test(file.name)
    );
    setProjectFiles(allowedFiles);
    setProjectFileSummary(
      allowedFiles.length > 0
        ? `${allowedFiles.length} dosya seçildi: ${allowedFiles.map((file) => file.name).join(", ")}`
        : "",
    );
  }

  async function insertProjectItemsWithFallback(payload) {
    const firstResult = await supabase
      .from("project_items")
      .insert(payload)
      .select("*");

    if (!firstResult.error) {
      return { data: firstResult.data || [], error: null, usedFallback: false };
    }

    const fallbackFields = [
      "brand",
      "quote_unit_price",
      "quote_total",
      "resolved_unit_price",
      "resolved_total",
      "price_source",
      "price_source_order_id",
      "price_source_date",
      "currency",
      "exchange_rate",
      "estimated_total_base",
      "source_file",
      "source_type",
      "raw_item_id",
      "item_type",
      "product_id",
      "received_quantity",
      "reserved_quantity",
      "parent_name",
      "parent_quantity",
      "child_quantity_total",
      "child_quantity_per_parent",
      "remaining_parent_quantity",
      "produced_parent_quantity",
      "reserved_child_quantity",
      "consumed_child_quantity",
      "issued_to_production_quantity",
      "defective_quantity",
    ];

    console.warn("Project item insert full payload failed, retrying basic payload:", firstResult.error);

    const fallbackResult = await supabase
      .from("project_items")
      .insert(stripPayloadFields(payload, fallbackFields))
      .select("*");

    return {
      data: fallbackResult.data || [],
      error: fallbackResult.error,
      usedFallback: !fallbackResult.error,
      originalError: firstResult.error,
    };
  }

  function projectFileRowPayload(row, userId, projectId, projectPayload, parent = null, itemType = "standalone") {
    const quantity = parsedRowQuantity(row);
    const total = parsedRowTotal(row);
    const unitPrice = parsedRowUnitPrice(row);
    const currency = row.currency || projectPayload.estimated_budget_currency || projectPayload.contract_currency || getBaseCurrency(settings);
    const exchangeRate = Number(row.exchange_rate || getExchangeRate(currency, settings) || 1);

    return {
      user_id: userId,
      project_id: projectId,
      parent_item_id: parent?.id || null,
      product_code: String(row.product_code || "").trim().toUpperCase(),
      brand: row.brand || "",
      product_name: String(row.product_name || row.description || row.item_name || "").trim(),
      unit: row.unit || "adet",
      estimated_quantity: quantity,
      estimated_unit_price: unitPrice,
      quote_unit_price: unitPrice,
      estimated_total: total,
      quote_total: total,
      currency,
      exchange_rate: exchangeRate,
      status: row.status || "Bekliyor",
      note: row.note || row.source_file || previewRowCategory(row),
      source_file: row.source_file || "",
      source_type: row.source_type || "",
      raw_item_id: row.raw_item_id || row.id || "",
      item_type: itemType,
      product_id: row.product_id || null,
      ...(parent ? hierarchyQuantityFields(parent, quantity) : {}),
      updated_at: new Date().toISOString(),
    };
  }

  async function fileSha256(file) {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function isDocumentHashColumnError(error) {
    return /content_sha256|schema cache|column/i.test(error?.message || "");
  }

  async function archiveProjectSourceFiles(files, projectId, userId, projectPayload) {
    const warnings = [];
    const archivedDocuments = [];
    async function linkDocumentToProject(documentId) {
      if (!documentId) return false;

      const { data: existingLink, error: linkLookupError } = await supabase
        .from("document_links")
        .select("id")
        .eq("user_id", userId)
        .eq("document_id", documentId)
        .eq("project_id", projectId)
        .limit(1)
        .maybeSingle();

      if (linkLookupError) return false;
      if (existingLink) return true;

      const { error: linkError } = await supabase
        .from("document_links")
        .insert({
          user_id: userId,
          document_id: documentId,
          project_id: projectId,
        });

      if (!linkError) return true;

      const { data: linkAfterInsert } = await supabase
        .from("document_links")
        .select("id")
        .eq("user_id", userId)
        .eq("document_id", documentId)
        .eq("project_id", projectId)
        .limit(1)
        .maybeSingle();

      return Boolean(linkAfterInsert);
    }

    for (const file of files) {
      try {
        const contentSha256 = await fileSha256(file);
        const { data: existingDocument, error: existingDocumentError } = await supabase
          .from("documents")
          .select("id,storage_path,original_file_name")
          .eq("user_id", userId)
          .eq("content_sha256", contentSha256)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingDocumentError && !isDocumentHashColumnError(existingDocumentError)) {
          warnings.push(`${file.name} belge mükerrer kontrolü yapılamadı.`);
          continue;
        }

        if (existingDocument?.storage_path) {
          const linked = await linkDocumentToProject(existingDocument.id);
          if (linked) {
            archivedDocuments.push(existingDocument);
            continue;
          }
          warnings.push(`${file.name} arsivdeki kayda baglanamadi; proje icin yeni bir kopya olusturuluyor.`);
        }

        const safeFileName = String(file.name || "proje-dosyasi")
          .replace(/[^a-zA-Z0-9._-]/g, "-")
          .replace(/-+/g, "-");
        const fileId = typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const storagePath = `${userId}/projects/${projectId}/${fileId}-${safeFileName}`;
        const { error: uploadError } = await supabase.storage
          .from("order-documents")
          .upload(storagePath, file, {
            cacheControl: "3600",
            contentType: file.type || undefined,
            upsert: false,
          });

        if (uploadError) {
          warnings.push(`${file.name} belge arşivine yüklenemedi.`);
          continue;
        }

        const documentPayload = {
            user_id: userId,
            document_type: "proje",
            original_file_name: file.name,
            storage_bucket: "order-documents",
            storage_path: storagePath,
            mime_type: file.type || null,
            file_size: file.size || null,
            content_sha256: contentSha256,
            supplier_name: projectPayload.customer_partner_name || projectPayload.customer_name || null,
            document_date: projectPayload.start_date || null,
            currency: projectPayload.estimated_budget_currency || projectPayload.contract_currency || getBaseCurrency(settings),
        };
        const documentWriteQuery = supabase
          .from("documents")
          .insert(documentPayload);
        let { data: documentRow, error: documentError } = await documentWriteQuery
          .select("id,storage_path,original_file_name")
          .single();

        if (documentError && isDocumentHashColumnError(documentError)) {
          const { content_sha256: _contentSha256, ...documentPayloadWithoutHash } = documentPayload;
          const fallbackDocumentWriteQuery = supabase
            .from("documents")
            .insert(documentPayloadWithoutHash);
          const fallbackDocumentResult = await fallbackDocumentWriteQuery
            .select("id,storage_path,original_file_name")
            .single();
          documentRow = fallbackDocumentResult.data;
          documentError = fallbackDocumentResult.error;
        }

        if (documentError) {
          warnings.push(`${file.name} dosyasi yuklendi ancak belge bilgisi kaydedilemedi; proje detayinda depodaki dosyadan gosterilecek.`);
          archivedDocuments.push({
            id: `storage-only-${projectId}-${storagePath}`,
            document_type: "proje",
            original_file_name: file.name,
            storage_bucket: "order-documents",
            storage_path: storagePath,
            mime_type: file.type || null,
            file_size: file.size || null,
          });
        } else {
          const linked = await linkDocumentToProject(documentRow?.id);
          if (!linked) warnings.push(`${file.name} belge arsivi projeye baglanamadi.`);
          if (linked) archivedDocuments.push(documentRow);
        }
      } catch (error) {
        warnings.push(`${file.name} belge arşivine alınamadı.`);
      }
    }

    return { warnings, documents: archivedDocuments };
  }

  async function importProjectFilesForProject(files, projectId, userId, projectPayload) {
    if (!files.length) return { imported: 0, parents: 0, children: 0, warnings: [] };

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token || !API_URL) {
      return { imported: 0, parents: 0, children: 0, warnings: ["Dosya okuma için API adresi veya oturum bulunamadı."] };
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append("files", file);
    });

    const response = await fetch(`${API_URL}/parse-project-items`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await response.json();
    const { data: productRows } = await supabase
      .from("products")
      .select("id,product_code,product_name,brand,unit,category")
      .eq("user_id", userId)
      .is("archived_at", null);
    const productByCode = new Map(
      (productRows || [])
        .filter((product) => product.product_code)
        .map((product) => [String(product.product_code).trim().toUpperCase().replace(/\s+/g, ""), product]),
    );
    const missingProductCodes = new Set();
    const rows = (data.rows || []).map((row, index) => {
      const productCode = String(row.product_code || "").trim().toUpperCase();
      const product = productByCode.get(productCode.replace(/\s+/g, ""));
      if (product) {
        return {
          ...row,
          product_id: product.id,
          product_code: product.product_code || productCode,
          product_name: product.product_name || row.product_name,
          brand: product.brand || row.brand || "",
          unit: product.unit || row.unit || "adet",
          category: product.category || row.category || "",
          preview_id: row.preview_id || `new-project-preview-${index}`,
        };
      }
      if (productCode) missingProductCodes.add(productCode);
      return { ...row, preview_id: row.preview_id || `new-project-preview-${index}` };
    });
    const sections = data.sections || [];
    const warnings = data.warnings || [];

    if (!rows.length) {
      return {
        imported: 0,
        parents: 0,
        children: 0,
        warnings: warnings.length ? warnings : [data.detail || "Dosyadan aktarılacak satır okunamadı."],
      };
    }

    const groups = rows.reduce((acc, row) => {
      const category = previewRowCategory(row);
      acc[category] = [...(acc[category] || []), row];
      return acc;
    }, {});

    const parentPayload = [];
    const childGroups = [];
    const standaloneRows = [];

    Object.entries(groups).forEach(([category, groupRows]) => {
      const parentQuantity = Number(groupRows.find((row) => Number(row.section_quantity || 0) > 0)?.section_quantity || 0);
      const canCreateParent = !isUncategorizedPreviewCategory(category) && parentQuantity > 0;

      if (!canCreateParent) {
        standaloneRows.push(...groupRows);
        return;
      }

      const quoteTotal = sectionQuoteTotalForRows(category, groupRows, sections);
      const quoteUnitPrice = parentQuantity > 0 ? quoteTotal / parentQuantity : quoteTotal;
      parentPayload.push({
        user_id: userId,
        project_id: projectId,
        parent_item_id: null,
        product_code: "",
        product_name: category,
        unit: "adet",
        estimated_quantity: parentQuantity,
        estimated_unit_price: quoteUnitPrice,
        quote_unit_price: quoteUnitPrice,
        estimated_total: quoteTotal,
        quote_total: quoteTotal,
        currency: groupRows[0]?.currency || projectPayload.estimated_budget_currency || projectPayload.contract_currency || getBaseCurrency(settings),
        exchange_rate: Number(groupRows[0]?.exchange_rate || projectPayload.estimated_budget_exchange_rate || projectPayload.contract_exchange_rate || 1),
        status: "Bekliyor",
        note: "Yeni proje dosyasından ana kalem grubu",
        source_file: groupRows[0]?.source_file || "",
        source_type: groupRows[0]?.source_type || "",
        item_type: "main",
        updated_at: new Date().toISOString(),
      });
      childGroups.push(groupRows);
    });

    let insertedParents = [];
    let insertedChildren = [];
    if (parentPayload.length > 0) {
      const { data: parents, error } = await insertProjectItemsWithFallback(parentPayload);
      if (error) throw new Error(error.message || "Ana kalemler projeye aktarılamadı.");
      insertedParents = parents || [];
    }

    const childPayload = [];
    childGroups.forEach((groupRows, index) => {
      const parent = insertedParents[index];
      if (!parent) {
        standaloneRows.push(...groupRows);
        return;
      }
      groupRows.forEach((row) => {
        childPayload.push(projectFileRowPayload(row, userId, projectId, projectPayload, parent, "sub"));
      });
    });

    if (childPayload.length > 0) {
      const { data: children, error } = await insertProjectItemsWithFallback(childPayload);
      if (error) throw new Error(error.message || "Alt kalemler projeye aktarılamadı.");
      insertedChildren = children || [];
    }

    let insertedStandalone = [];
    if (standaloneRows.length > 0) {
      const standalonePayload = standaloneRows.map((row) =>
        projectFileRowPayload(row, userId, projectId, projectPayload, null, "standalone")
      );
      const { data: standalone, error } = await insertProjectItemsWithFallback(standalonePayload);
      if (error) throw new Error(error.message || "Bağımsız kalemler projeye aktarılamadı.");
      insertedStandalone = standalone || [];
    }

    const imported = insertedParents.length + insertedChildren.length + insertedStandalone.length;
    return {
      imported,
      parents: insertedParents.length,
      children: insertedChildren.length,
      standalone: insertedStandalone.length,
      warnings: [
        ...warnings,
        ...(missingProductCodes.size > 0
          ? [`${missingProductCodes.size} ürün kodu stok kartlarında bulunamadı; ürün kartı otomatik oluşturulmadı.`]
          : []),
      ],
    };
  }

  async function saveProject(event) {
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

    const customerName = form.customer_name.trim();
    const customerPartner = customerName ? findBusinessPartnerByName(businessPartners, customerName) : null;
    const requiredProjectFields = [
      ["Proje adı", form.project_name],
      ["Müşteri adı", form.customer_name],
      ["Proje sorumlusu", form.project_owner],
      ["Başlangıç tarihi", form.start_date],
      ["Planlanan bitiş", form.planned_end_date],
      ["Durum", form.status],
    ].filter(([, value]) => !String(value || "").trim());

    if (requiredProjectFields.length > 0) {
      setMessage(`Zorunlu proje alanları eksik: ${requiredProjectFields.map(([label]) => label).join(", ")}.`);
      setSaving(false);
      return;
    }

    if (plannedEndBeforeStart(form.start_date, form.planned_end_date)) {
      setMessage("Planlanan bitiş tarihi başlangıç tarihinden önce olamaz.");
      setSaving(false);
      return;
    }

    if (customerName && !customerPartner) {
      setMessage("Bu firma iş ortakları arasında bulunamadı. Lütfen önce firma bilgisi oluşturun veya mevcut bir firmayı seçin.");
      setSaving(false);
      return;
    }

    const contractCurrency = form.contract_currency || getBaseCurrency(settings);
    const budgetCurrency = form.estimated_budget_currency || getBaseCurrency(settings);
    const contractExchangeRate = contractCurrency === "TRY" ? 1 : Number(normalizeRateInput(form.contract_exchange_rate || getExchangeRate(contractCurrency, settings)));
    const budgetExchangeRate = budgetCurrency === "TRY" ? 1 : Number(normalizeRateInput(form.estimated_budget_exchange_rate || getExchangeRate(budgetCurrency, settings)));

    if ((contractCurrency !== "TRY" && (!contractExchangeRate || contractExchangeRate <= 1)) || (budgetCurrency !== "TRY" && (!budgetExchangeRate || budgetExchangeRate <= 1))) {
      setMessage("TRY dışındaki para birimlerinde canlı kur 1 kalmış görünüyor. Lütfen güncel kuru kontrol edip manuel giriniz.");
      setSaving(false);
      return;
    }

    let resolvedProjectCode = "";
    try {
      resolvedProjectCode = await resolveProjectCodeForSave(user.id);
    } catch (codeError) {
      setMessage(codeError.message || "Proje kodu kontrol edilemedi.");
      setSaving(false);
      return;
    }

    const payload = {
      user_id: user.id,
      project_code: resolvedProjectCode,
      project_name: form.project_name.trim(),
      customer_name: customerName,
      customer_partner_id: customerPartner?.id || null,
      customer_partner_name: customerPartner?.name || customerName,
      description: form.description.trim(),
      contract_amount: Number(form.contract_amount || 0),
      contract_currency: contractCurrency,
      contract_exchange_rate: contractExchangeRate,
      contract_base_amount: calculateBaseAmount(form.contract_amount, contractCurrency, settings, contractExchangeRate),
      estimated_budget: Number(form.estimated_budget || 0),
      estimated_budget_currency: budgetCurrency,
      estimated_budget_exchange_rate: budgetExchangeRate,
      estimated_budget_base_amount: calculateBaseAmount(form.estimated_budget, budgetCurrency, settings, budgetExchangeRate),
      start_date: form.start_date || null,
      planned_end_date: form.planned_end_date || null,
      project_owner: form.project_owner.trim(),
      status: form.status,
      updated_at: new Date().toISOString(),
    };
    if (!editingId) payload.actual_cost = 0;

    const request = editingId
      ? supabase
          .from("projects")
          .update(payload)
          .eq("id", editingId)
          .eq("user_id", user.id)
          .select("id")
          .single()
      : supabase
          .from("projects")
          .insert(payload)
          .select("id")
          .single();

    const { data, error } = await request;

    if (error) {
      const duplicateCode = error.code === "23505" || String(error.message || "").toLowerCase().includes("duplicate");
      setMessage(duplicateCode
        ? "Proje kaydedilemedi. Aynı proje kodu az önce kullanılmış olabilir; lütfen formu kapatıp yeniden açın."
        : "Proje kaydedilemedi. Proje kodu daha önce kullanılmış olabilir.");
      setSaving(false);
      return;
    }

    const targetProjectId = editingId || data.id;
    let fileImportMessage = "";
    if (projectFiles.length > 0 && targetProjectId) {
      setMessage("Proje kaydedildi. Seçilen teklif/dosya analiz ediliyor...");
      try {
        const archiveResult = await archiveProjectSourceFiles(projectFiles, targetProjectId, user.id, payload);
        const archiveWarnings = archiveResult.warnings || [];
        const archivedFileCount = (archiveResult.documents || []).filter((document) => document?.storage_path).length;
        if (archivedFileCount < projectFiles.length) {
          archiveWarnings.push("Seçilen dosyalardan bazıları proje belgelerine kaydedilemedi. Belgeler sekmesinde açılabilir dosya oluşması için dosyayı tekrar yükleyin.");
        }
        const importResult = await importProjectFilesForProject(projectFiles, targetProjectId, user.id, payload);
        fileImportMessage = importResult.imported > 0
          ? `Dosyadan ${importResult.imported} kalem aktarıldı (${importResult.parents || 0} ana kalem, ${importResult.children || 0} alt kalem, ${importResult.standalone || 0} bağımsız kalem).`
          : "Proje kaydedildi ancak dosyadan aktarılacak kalem bulunamadı.";
        const combinedWarnings = [...archiveWarnings, ...(importResult.warnings || [])];
        if (combinedWarnings.length) {
          fileImportMessage += ` ${combinedWarnings.slice(0, 2).join(" ")}`;
        }
      } catch (fileError) {
        console.error("Yeni proje dosyası aktarımı başarısız:", fileError);
        fileImportMessage = `Proje kaydedildi, dosya aktarımı tamamlanamadı: ${fileError.message || "Bilinmeyen hata"}. Dosyayı proje detayından tekrar yükleyebilirsiniz.`;
      }
    }

    setSaving(false);
    setShowForm(false);
    setEditingId(null);
    setProjectCodeEdited(false);
    setProjectFiles([]);
    setProjectFileSummary("");
    await loadProjects();
    if (fileImportMessage) setMessage(fileImportMessage);
    if (!editingId) router.push(`/dashboard/projeler/${data.id}`);
  }

  function projectMetrics(projectId) {
    const items = relatedRows.items.filter((item) => item.project_id === projectId);
    const orders = relatedRows.orders.filter((order) => order.project_id === projectId);
    const movements = relatedRows.movements.filter((row) => row.project_id === projectId);
    const materialItems = items.filter((item) => {
      const itemType = String(item.item_type || "").toLowerCase();
      return item.parent_item_id || itemType === "child" || itemType === "standalone" || itemType === "material";
    });
    const trackedItems = materialItems.length > 0 ? materialItems : items;
    const missingStatuses = ["Satınalma gerekli", "Eksik geldi", "Tedarikçiden bekleniyor"];
    const requestedStatuses = ["Talep oluşturuldu"];
    const orderedStatuses = ["Sipariş verildi", "Tedarikçiden bekleniyor", "Kısmi geldi"];
    const completedItems = items.filter((item) =>
      ["Depoda", "Tamamlandı", "Sevk edildi"].includes(item.status),
    ).length;
    const missingMaterials = trackedItems.filter((item) =>
      missingStatuses.includes(item.status),
    ).length;
    const orderedItems = trackedItems.filter((item) =>
      orderedStatuses.includes(item.status),
    ).length;
    const requestedItems = trackedItems.filter((item) =>
      requestedStatuses.includes(item.status),
    ).length;
    const stockCoveredQuantity = trackedItems.reduce((sum, item) => {
      const itemReserved = quantityFromItem(item, ["reserved_quantity", "reserved_child_quantity"]);
      const movementReserved = movements
        .filter((movement) => movement.project_item_id === item.id)
        .reduce((movementSum, movement) => movementSum + quantityFromItem(movement, ["reserved_quantity"]), 0);
      return sum + Math.max(itemReserved, movementReserved);
    }, 0);
    const openOrders = orders.filter((order) =>
      !["Tam Teslim", "Teslim Edildi", "İptal"].includes(order.status),
    ).length;
    const totalOrders = orders.length;
    const productStatus =
      trackedItems.length === 0
        ? { label: "Malzeme yok", tone: "slate" }
        : missingMaterials > 0
          ? { label: `${missingMaterials} eksik`, tone: "red" }
          : requestedItems > 0
            ? { label: `${requestedItems} talepte`, tone: "blue" }
          : stockCoveredQuantity > 0
            ? { label: `${formatQuantity(stockCoveredQuantity)} rezerve`, tone: "green" }
            : completedItems > 0
              ? { label: "Tamamlandı", tone: "green" }
              : { label: "Bekliyor", tone: "slate" };
    const materialStatusParts = [
      stockCoveredQuantity > 0 ? `Stoktan ayrılan ${formatQuantity(stockCoveredQuantity)}` : null,
      requestedItems > 0 ? `Talepte ${requestedItems}` : null,
      missingMaterials > 0 ? `Eksik ${missingMaterials}` : null,
      orderedItems > 0 ? `Siparişte ${orderedItems}` : null,
    ].filter(Boolean);
    const orderStatus =
      openOrders > 0
        ? { label: `${openOrders} açık sipariş`, tone: "blue" }
        : orderedItems > 0
          ? { label: `${orderedItems} kalem siparişte`, tone: "blue" }
          : requestedItems > 0
            ? { label: "Talep aşamasında", tone: "blue" }
          : missingMaterials > 0
            ? { label: "Sipariş bekliyor", tone: "amber" }
            : totalOrders > 0
              ? { label: "Sipariş tamam", tone: "green" }
              : { label: "Sipariş yok", tone: "slate" };
    const dependencyDetails = {
      teklif: relatedRows.offers.filter((row) => row.project_id === projectId).length,
      sipariş: orders.length,
      "stok hareketi": movements.length,
      ödeme: relatedRows.payments.filter((row) => row.project_id === projectId).length,
      revizyon: relatedRows.revisions.filter((row) => row.project_id === projectId).length,
    };
    const dependencyCount =
      Object.values(dependencyDetails).reduce((sum, count) => sum + count, 0);

    return {
      completion: items.length > 0 ? Math.round((completedItems / items.length) * 100) : 0,
      stockCoveredItems: stockCoveredQuantity,
      requestedItems,
      orderedItems,
      openOrders,
      totalOrders,
      missingMaterials,
      materialStatusText: materialStatusParts.length > 0 ? materialStatusParts.join(" · ") : "Alt malzeme işlemi bekliyor",
      productStatus,
      orderStatus,
      dependencyCount,
      dependencyDetails,
    };
  }

  async function archiveProject(project) {
    const { error } = await supabase
      .from("projects")
      .update({
        status: "Arşivlendi",
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .eq("user_id", project.user_id);

    if (error) {
      setMessage("Proje arşivlenemedi. Supabase şemasında archived_at alanı çalıştırılmış olmalı.");
      return;
    }

    setProjectView("archived");
    setMessage("Proje arşivlendi. Arşivlenen Projeler sekmesine taşındı.");
    await loadProjects();
  }

  async function deleteProject(project) {
    const metrics = projectMetrics(project.id);

    if (metrics.dependencyCount > 0) {
      const blockers = Object.entries(metrics.dependencyDetails)
        .filter(([, count]) => count > 0)
        .map(([label, count]) => `${label}: ${count}`)
        .join(", ");
      setDeleteBlocker({
        projectId: project.id,
        projectName: project.project_name,
        stockMovementCount: metrics.dependencyDetails["stok hareketi"] || 0,
        blockers,
      });
      setMessage(`Bu proje silinemez çünkü bağlı kayıtlar var. ${blockers}`);
      return;
    }

    const confirmed = window.confirm(`${project.project_name} kalıcı olarak silinsin mi?`);
    if (!confirmed) return;

    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", project.id)
      .eq("user_id", project.user_id);

    if (error) {
      setMessage("Proje silinemedi.");
      return;
    }

    setDeleteBlocker(null);
    setMessage("Proje silindi.");
    await loadProjects();
  }

  const archivedProjects = useMemo(() => projects.filter((project) => project.status === "Arşivlendi" || project.archived_at), [projects]);
  const activeProjects = useMemo(() => projects.filter((project) => !(project.status === "Arşivlendi" || project.archived_at)), [projects]);
  const displayedProjectsBase = projectView === "archived" ? archivedProjects : activeProjects;
  const displayedProjects = useMemo(() => {
    const needle = normalizeProjectFilter(customerFilter);
    if (!needle) return displayedProjectsBase;
    return displayedProjectsBase.filter((project) =>
      normalizeProjectFilter([
        project.customer_name,
        project.customer_partner_name,
        project.project_name,
        project.project_code,
      ].join(" ")).includes(needle),
    );
  }, [displayedProjectsBase, customerFilter]);
  const displayedProjectOverview = useMemo(() => {
    return displayedProjects.reduce((summary, project) => {
      const metrics = projectMetrics(project.id);
      if (metrics.missingMaterials > 0) summary.projectsWithMissing += 1;
      if (metrics.stockCoveredItems > 0) summary.projectsWithStockCover += 1;
      if (metrics.openOrders > 0 || metrics.orderedItems > 0) summary.projectsWithOrders += 1;
      if (metrics.requestedItems > 0) summary.projectsWithRequests += 1;
      if (metrics.missingMaterials === 0 && metrics.requestedItems === 0 && metrics.openOrders === 0 && metrics.materialTotal > 0) summary.projectsReady += 1;
      summary.missingItems += metrics.missingMaterials;
      summary.stockCoveredItems += metrics.stockCoveredItems;
      summary.requestedItems += metrics.requestedItems;
      summary.openOrders += metrics.openOrders;
      return summary;
    }, {
      projectsWithMissing: 0,
      projectsWithStockCover: 0,
      projectsWithOrders: 0,
      projectsWithRequests: 0,
      projectsReady: 0,
      missingItems: 0,
      stockCoveredItems: 0,
      requestedItems: 0,
      openOrders: 0,
    });
  }, [displayedProjects, relatedRows]);
  const selectedCustomerPartner = useMemo(
    () => findBusinessPartnerByName(businessPartners, form.customer_name),
    [businessPartners, form.customer_name],
  );
  const customerPartnerSuggestions = useMemo(() => {
    const needle = normalizeProjectFilter(form.customer_name);
    if (!needle) return [];
    return businessPartners
      .filter((partner) => normalizeProjectFilter(partner.name).startsWith(needle))
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "tr"))
      .slice(0, 8);
  }, [businessPartners, form.customer_name]);
  const customerPartnerDraftIsValid = useMemo(() => {
    const name = String(customerPartnerDraft.name || form.customer_name || "").trim();
    const phoneDigits = String(customerPartnerDraft.phone || "").replace(/\D/g, "");
    const email = String(customerPartnerDraft.email || "").trim();
    const taxDigits = String(customerPartnerDraft.tax_number || "").replace(/\D/g, "");
    const city = String(customerPartnerDraft.city || "").trim();
    return Boolean(
      name
        && phoneDigits.length >= 10
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        && [10, 11].includes(taxDigits.length)
        && city,
    );
  }, [customerPartnerDraft, form.customer_name]);
  const customerPartnerTaxDuplicate = useMemo(
    () => findPartnerByTaxNumber(businessPartners, customerPartnerDraft.tax_number),
    [businessPartners, customerPartnerDraft.tax_number],
  );
  const projectDateInvalid = plannedEndBeforeStart(form.start_date, form.planned_end_date);
  const customerNameNeedsPartner = Boolean(form.customer_name.trim()) && !selectedCustomerPartner;

  function toggleProjectSelection(projectId) {
    setSelectedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    );
  }

  function toggleVisibleProjects() {
    const visibleIds = displayedProjects
      .filter((project) => project.status !== "Arşivlendi" && !project.archived_at)
      .map((project) => project.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedProjectIds.includes(id));
    setSelectedProjectIds((current) =>
      allSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds])),
    );
  }

  function openProcurementSummary(mode = "missing") {
    const validIds = selectedProjectIds.filter((id) => activeProjects.some((project) => project.id === id));
    if (validIds.length === 0) {
      setMessage("Malzeme listesi hazırlamak için en az bir aktif proje seçin.");
      return;
    }
    localStorage.setItem("procurementSummaryProjectIds", JSON.stringify(validIds));
    router.push(`/dashboard/talepler/icmal?mode=${mode}`);
  }

  function clearProjectSelection() {
    setSelectedProjectIds([]);
    setMessage("Proje seçimi temizlendi.");
  }

  const stats = useMemo(() => {
    const activeStatuses = ["Onaylandı", "Devam Ediyor"];
    const active = projects.filter((project) => activeStatuses.includes(project.status)).length;
    const completed = projects.filter((project) => project.status === "Tamamlandı").length;
    const statusCounts = statusOptions.reduce((acc, status) => {
      if (status === "Arşivlendi") return acc;
      acc[status] = projects.filter((project) => (project.status || "Taslak") === status).length;
      return acc;
    }, {});

    return {
      active,
      completed,
      statusCounts,
    };
  }, [projects]);

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
              Proje Yönetimi
            </div>
            <h1 className="mt-3 text-4xl font-bold text-slate-900">Projeler</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Proje bazlı bütçe, satınalma, stok kullanımı ve tahsilat takibini buradan yönetin.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateForm}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
          >
            Yeni Proje
          </button>
        </div>

        {selectedProjectIds.length > 0 ? (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="font-black text-blue-950">
                  Seçili {selectedProjectIds.length} proje için işlem yap
                </div>
                <div className="mt-1 text-sm font-semibold text-blue-800">
                  Listeler yalnızca seçili projelerden hazırlanır; proje, ana ürün ve alt ürün bağlantıları korunur.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openProcurementSummary("missing")}
                  className="rounded-xl bg-red-700 px-4 py-3 text-sm font-black text-white hover:bg-red-800"
                >
                  Satın Alma Gerekenler
                </button>
                <button
                  type="button"
                  onClick={() => openProcurementSummary("stock")}
                  className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white hover:bg-emerald-800"
                >
                  Stoktan Karşılanacaklar
                </button>
                <button
                  type="button"
                  onClick={() => openProcurementSummary("all")}
                  className="rounded-xl bg-blue-700 px-4 py-3 text-sm font-black text-white hover:bg-blue-800"
                >
                  Tüm Malzeme Listesi
                </button>
                <button
                  type="button"
                  onClick={clearProjectSelection}
                  className="rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-black text-blue-700 hover:bg-blue-100"
                >
                  Seçimi Temizle
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-600 shadow-sm">
            Birden fazla projeyi seçerek stoktan karşılanacakları, satın alma gerekenleri veya tüm malzeme listesini hazırlayabilirsiniz.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {["Taslak", "Onaylandı", "Devam Ediyor", "Tamamlandı", "İptal"].map((status) => (
            <div key={status} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-black uppercase text-slate-500">{status}</div>
              <div className="mt-2 text-2xl font-black text-slate-950">{stats.statusCounts[status] || 0}</div>
            </div>
          ))}
        </div>

        {message && (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div>{message}</div>
                {deleteBlocker && (
                  <div className="mt-1 text-xs font-bold text-yellow-800">
                    Stoktan karşılanan veya rezerve edilen kayıtları proje detayındaki Stok Hareketleri sekmesinden silebilirsiniz.
                  </div>
                )}
              </div>
              {deleteBlocker && (
                <div className="flex flex-wrap gap-2">
                  {deleteBlocker.stockMovementCount > 0 && (
                    <Link
                      href={`/dashboard/projeler/${deleteBlocker.projectId}?tab=${encodeURIComponent("Stok Hareketleri")}`}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-center text-xs font-black text-white hover:bg-slate-800"
                    >
                      Stok hareketlerini aç ({deleteBlocker.stockMovementCount})
                    </Link>
                  )}
                  <Link
                    href={`/dashboard/projeler/${deleteBlocker.projectId}`}
                    className="rounded-lg border border-yellow-300 bg-white px-4 py-2 text-center text-xs font-black text-yellow-900 hover:bg-yellow-100"
                  >
                    Proje detayına git
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        {showForm && (
          <form onSubmit={saveProject} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{editingId ? "Projeyi Düzenle" : "Yeni Proje Oluştur"}</h2>
                <p className="mt-1 text-sm text-slate-500">Proje kodu otomatik hazırlanır, gerekirse elle düzenlenebilir.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setProjectFiles([]);
                  setProjectFileSummary("");
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                Kapat
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="text-sm font-bold text-slate-700">
                Proje Kodu
                <input className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.project_code} onChange={(e) => updateForm("project_code", e.target.value)} />
                <span className="mt-1 block text-xs font-semibold text-slate-500">Elle değiştirmezseniz sistem ilk boş PRJ numarasını verir.</span>
              </label>
              <label className="text-sm font-bold text-slate-700">
                Proje Adı *
                <input required className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.project_name} onChange={(e) => updateForm("project_name", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Müşteri Adı *
                <div className="relative mt-2">
                  <input
                    required
                    className="w-full rounded-xl border border-slate-300 p-3"
                    value={form.customer_name}
                    onFocus={() => setShowCustomerSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 120)}
                    onChange={(e) => {
                      updateForm("customer_name", e.target.value);
                      setShowCustomerSuggestions(true);
                    }}
                  />
                  {showCustomerSuggestions && customerPartnerSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                      {customerPartnerSuggestions.map((partner) => (
                        <button
                          key={partner.id}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            updateForm("customer_name", partner.name);
                            setShowCustomerSuggestions(false);
                          }}
                          className="block w-full px-3 py-2 text-left text-xs font-bold text-slate-900 hover:bg-blue-50"
                        >
                          <span className="block">{partner.name}</span>
                          <span className="mt-0.5 block font-semibold text-slate-500">{partner.partner_type || "İş Ortağı"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {customerNameNeedsPartner && (
                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                    <p>Bu firma iş ortakları arasında bulunamadı. Firma kaydını bu formdan oluşturup projeye devam edebilirsiniz.</p>
                    {!showCustomerPartnerForm ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerPartnerDraft((prev) => ({ ...prev, name: form.customer_name }));
                          setShowCustomerPartnerForm(true);
                        }}
                        className="mt-2 inline-flex rounded-lg bg-amber-100 px-3 py-2 font-black text-amber-900 hover:bg-amber-200"
                      >
                        Firma bilgisi oluştur
                      </button>
                    ) : (
                      <div className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-white p-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <label className="text-xs font-black text-slate-700">
                            Firma adı *
                            <input
                              required
                              className="mt-1 w-full rounded-lg border border-slate-300 p-2"
                              value={customerPartnerDraft.name}
                              onChange={(event) => updateCustomerPartnerDraft("name", event.target.value)}
                            />
                          </label>
                          <label className="text-xs font-black text-slate-700">
                            Yetkili
                            <input
                              className="mt-1 w-full rounded-lg border border-slate-300 p-2"
                              value={customerPartnerDraft.contact_person}
                              onChange={(event) => updateCustomerPartnerDraft("contact_person", event.target.value)}
                            />
                          </label>
                          <label className="text-xs font-black text-slate-700">
                            Telefon *
                            <input
                              required
                              type="tel"
                              inputMode="tel"
                              className="mt-1 w-full rounded-lg border border-slate-300 p-2"
                              value={customerPartnerDraft.phone}
                              onChange={(event) => updateCustomerPartnerDraft("phone", event.target.value)}
                            />
                          </label>
                          <label className="text-xs font-black text-slate-700">
                            E-posta *
                            <input
                              required
                              type="email"
                              className="mt-1 w-full rounded-lg border border-slate-300 p-2"
                              value={customerPartnerDraft.email}
                              onChange={(event) => updateCustomerPartnerDraft("email", event.target.value)}
                            />
                          </label>
                          <label className="text-xs font-black text-slate-700">
                            Vergi no *
                            <input
                              required
                              inputMode="numeric"
                              pattern="[0-9]{10,11}"
                              className="mt-1 w-full rounded-lg border border-slate-300 p-2"
                              value={customerPartnerDraft.tax_number}
                              onChange={(event) => updateCustomerPartnerDraft("tax_number", event.target.value)}
                            />
                            {customerPartnerTaxDuplicate && (
                              <span className="mt-1 block rounded-lg bg-red-50 p-2 text-[11px] font-black text-red-700">
                                {duplicateTaxNumberMessage(customerPartnerTaxDuplicate)}
                              </span>
                            )}
                          </label>
                          <label className="text-xs font-black text-slate-700">
                            Şehir *
                            <input
                              required
                              className="mt-1 w-full rounded-lg border border-slate-300 p-2"
                              value={customerPartnerDraft.city}
                              onChange={(event) => updateCustomerPartnerDraft("city", event.target.value)}
                            />
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={savingPartner || !customerPartnerDraftIsValid || Boolean(customerPartnerTaxDuplicate)}
                            onClick={createCustomerPartnerFromProject}
                            className="rounded-lg bg-amber-500 px-3 py-2 font-black text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {savingPartner ? "Kaydediliyor..." : "Firmayı kaydet"}
                          </button>
                          <button
                            type="button"
                            disabled={savingPartner}
                            onClick={() => setShowCustomerPartnerForm(false)}
                            className="rounded-lg border border-slate-200 px-3 py-2 font-black text-slate-600 hover:bg-slate-50"
                          >
                            Vazgeç
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </label>
              <label className="text-sm font-bold text-slate-700 md:col-span-3">
                Açıklama
                <textarea className="mt-2 w-full rounded-xl border border-slate-300 p-3" rows={3} value={form.description} onChange={(e) => updateForm("description", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Sözleşme Bedeli
                <input type="number" className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.contract_amount} onChange={(e) => updateForm("contract_amount", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Sözleşme Para Birimi
                <select className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.contract_currency} onChange={(e) => {
                  const nextCurrency = e.target.value;
                  updateCurrencyWithLiveRate("contract_currency", "contract_exchange_rate", nextCurrency);
                }}>
                  {currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-slate-700">
                Sözleşme Kuru
                <input type="number" step="0.000001" className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.contract_exchange_rate} onChange={(e) => updateForm("contract_exchange_rate", normalizeRateInput(e.target.value))} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Tahmini Bütçe / Maliyet
                <input type="number" className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.estimated_budget} onChange={(e) => updateForm("estimated_budget", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Bütçe Para Birimi
                <select className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.estimated_budget_currency} onChange={(e) => {
                  const nextCurrency = e.target.value;
                  updateCurrencyWithLiveRate("estimated_budget_currency", "estimated_budget_exchange_rate", nextCurrency);
                }}>
                  {currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-slate-700">
                Bütçe Kuru
                <input type="number" step="0.000001" className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.estimated_budget_exchange_rate} onChange={(e) => updateForm("estimated_budget_exchange_rate", normalizeRateInput(e.target.value))} />
              </label>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm md:col-span-3">
                <div className="font-black text-blue-900">Canlı kur takibi</div>
                {liveRateWarning && (
                  <div className="mt-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs font-black text-yellow-800">
                    {liveRateWarning}
                  </div>
                )}
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {[
                    ["Sözleşme", form.contract_currency, form.contract_exchange_rate],
                    ["Bütçe", form.estimated_budget_currency, form.estimated_budget_exchange_rate],
                  ].map(([label, currency, savedRate]) => {
                    const liveRate = liveRateFor(currency, liveRates);
                    return (
                      <div key={label} className="rounded-xl bg-white p-3">
                        <div className="text-xs font-black uppercase text-slate-500">{label} para birimi: {currency}</div>
                        <div className="mt-1 text-sm font-bold text-slate-900">
                          {currency === "TRY" ? "TRY için kur 1 kabul edilir." : liveRate ? `Canlı kur: ${formatMoney(liveRate, "TRY")}` : "Canlı kur alınamadı."}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">Kayıt kuru: {savedRate || 1}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <label className="text-sm font-bold text-slate-700">
                Proje Sorumlusu *
                <input required className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.project_owner} onChange={(e) => updateForm("project_owner", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Başlangıç Tarihi *
                <input required type="date" max={form.planned_end_date || undefined} className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.start_date} onChange={(e) => updateForm("start_date", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Planlanan Bitiş *
                <input required type="date" min={form.start_date || undefined} className={`mt-2 w-full rounded-xl border p-3 ${projectDateInvalid ? "border-red-400 bg-red-50" : "border-slate-300"}`} value={form.planned_end_date} onChange={(e) => updateForm("planned_end_date", e.target.value)} />
                {projectDateInvalid && (
                  <span className="mt-2 block rounded-lg bg-red-50 p-2 text-xs font-black text-red-700">
                    Planlanan bitiş tarihi başlangıç tarihinden önce olamaz.
                  </span>
                )}
              </label>
              <label className="text-sm font-bold text-slate-700">
                Durum *
                <select required className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.status} onChange={(e) => updateForm("status", e.target.value)}>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">Proje teklif/dosya yükleme</div>
                  <p className="mt-1 text-sm font-semibold text-slate-600">
                    Excel veya PDF dosyası seçebilirsiniz. Dosya eklenmezse proje boş olarak oluşturulur; dosya eklenirse proje kaydından sonra aynı işlemde analiz edilip malzeme listesine aktarılır.
                  </p>
                </div>
                <span className="inline-flex w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-blue-700">
                  Excel / PDF
                </span>
              </div>
              <label className="mt-4 block rounded-xl border border-blue-200 bg-white p-4 text-sm font-bold text-slate-700">
                Dosya seç
                <input
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.xlsm,.pdf,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={updateProjectFiles}
                  className="mt-3 block w-full text-sm font-semibold text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:font-bold file:text-white hover:file:bg-blue-700"
                />
              </label>
              {projectFileSummary && (
                <div className="mt-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                  {projectFileSummary}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={saving || projectDateInvalid}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                {saving
                  ? projectFiles.length > 0
                    ? "Kaydediliyor ve dosya analiz ediliyor..."
                    : "Kaydediliyor..."
                  : editingId
                    ? "Projeyi Kaydet"
                    : "Projeyi Oluştur"}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Proje Listesi</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {loading ? "Yükleniyor..." : `${displayedProjects.length} proje gösteriliyor.`}
                </p>
                {customerFilter && (
                  <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                    <span className="truncate">Müşteri filtresi: {customerFilter}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerFilter("");
                        router.replace("/dashboard/projeler");
                      }}
                      className="shrink-0 rounded-full bg-white px-2 py-1 text-blue-700"
                    >
                      Temizle
                    </button>
                  </div>
                )}
              </div>
              <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm font-bold">
                <button
                  type="button"
                  onClick={() => setProjectView("active")}
                  className={`rounded-lg px-4 py-2 ${projectView === "active" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}
                >
                  Aktif Projeler ({activeProjects.length})
                </button>
                <button
                  type="button"
                  onClick={() => setProjectView("archived")}
                  className={`rounded-lg px-4 py-2 ${projectView === "archived" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}
                >
                  Arşivlenen Projeler ({archivedProjects.length})
                </button>
              </div>
            </div>
          </div>
          <div className="overflow-hidden">
            <table className="w-full table-fixed text-left text-xs [&_td]:p-2">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="w-[4%] p-2">
                    <input
                      type="checkbox"
                      aria-label="Görünen projelerin tümünü seç"
                      checked={displayedProjects.some((project) => project.status !== "Arşivlendi" && !project.archived_at) && displayedProjects.filter((project) => project.status !== "Arşivlendi" && !project.archived_at).every((project) => selectedProjectIds.includes(project.id))}
                      onChange={toggleVisibleProjects}
                    />
                  </th>
                  <th className="w-[20%] p-2">Proje</th>
                  <th className="w-[16%] p-2">Müşteri</th>
                  <th className="w-[15%] p-2">Sipariş durumu</th>
                  <th className="w-[12%] p-2">Tamamlanma</th>
                  <th className="w-[13%] p-2">Tarih</th>
                  <th className="w-[9%] p-2">Durum</th>
                  <th className="w-[11%] p-2">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {displayedProjects.map((project) => {
                  const metrics = projectMetrics(project.id);

                  return (
                    <tr key={project.id} className="border-t border-slate-100 align-top hover:bg-blue-50">
                      <td className="p-4">
                        <input
                          type="checkbox"
                          aria-label={`${project.project_name || project.project_code} projesini seç`}
                          checked={selectedProjectIds.includes(project.id)}
                          onChange={() => toggleProjectSelection(project.id)}
                          disabled={project.status === "Arşivlendi" || Boolean(project.archived_at)}
                        />
                      </td>
                      <td className="p-4">
                        <Link href={`/dashboard/projeler/${project.id}`} className="font-black text-blue-700 hover:underline">
                          {project.project_code || "-"}
                        </Link>
                        <div className="mt-1 max-w-[150px] truncate font-bold text-slate-900" title={project.project_name || ""}>
                          {project.project_name}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="max-w-[105px] truncate" title={project.customer_name || "-"}>
                          {project.customer_name || "-"}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${projectListBadgeClass(metrics.orderStatus.tone)}`}>
                          {metrics.orderStatus.label}
                        </span>
                        <div className="mt-1 text-[11px] font-semibold text-slate-500">
                          Toplam sipariş {metrics.totalOrders}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-blue-600" style={{ width: `${metrics.completion}%` }} />
                          </div>
                          <span className="font-bold text-slate-700">%{metrics.completion}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div>{formatDate(project.start_date)}</div>
                        <div className="text-xs text-slate-500">{formatDate(project.planned_end_date)}</div>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex max-w-full justify-center rounded-full px-2.5 py-1 text-center text-xs font-bold leading-tight ${statusClass(project.status)}`}>
                          {project.status || "Taslak"}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="grid w-full grid-cols-1 gap-1.5">
                          <button
                            type="button"
                            onClick={() => router.push(`/dashboard/projeler/${project.id}`)}
                            className="w-full rounded-lg border border-blue-200 px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"
                          >
                            Detay
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditForm(project)}
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={() => archiveProject(project)}
                            className="w-full rounded-lg border border-amber-200 px-2 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-50"
                          >
                            Arşivle
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteProject(project)}
                            className="w-full rounded-lg border border-red-200 px-2 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
                          >
                            Sil
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && displayedProjects.length === 0 && (
                  <tr>
                    <td colSpan="9" className="p-8 text-center text-slate-500">
                      Henüz proje yok. İlk projeyi oluşturarak başlayın.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
