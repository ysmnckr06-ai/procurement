"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { calculateBaseAmount, currencyOptions, getBaseCurrency, getExchangeRate } from "@/lib/currency";
import {
  buildComponentConsumptionRows,
  componentRelationForItem,
  formatQuantity,
  hierarchyQuantityFields,
  mainItemStats,
  overviewStatusForMainItem,
  parentProcessInfo,
} from "@/lib/projectHierarchy";
import { supabase } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const UNCATEGORIZED_PREVIEW_CATEGORY = "Kategorisiz Ürünler";

const tabs = [
  "Genel Özet",
  "Malzeme Listesi",
  "Talepler",
  "Teklifler",
  "Siparişler",
  "Stok Hareketleri",
  "Ödemeler",
  "Revizyonlar",
  "Raporlar",
];

const paymentTypes = ["Avans", "Ara ödeme", "Hakediş", "Kapanış ödemesi"];

const lifecycleItemStatuses = [
  "Bekliyor",
  "Sat\u0131nalma gerekli",
  "Talep olu\u015fturuldu",
  "Teklif bekleniyor",
  "Sipari\u015f verildi",
  "Tedarik\u00e7iden bekleniyor",
  "K\u0131smi geldi",
  "Depoda",
  "Eksik geldi",
  "Fazla geldi",
  "Hatal\u0131 / ar\u0131zal\u0131 geldi",
  "Projeye rezerve edildi",
  "\u0130\u015fleme al\u0131nd\u0131",
  "\u0130\u015flemde",
  "Uygulamada",
  "Sevk edildi",
  "Tamamland\u0131",
];

const emptyItem = {
  parent_item_id: "",
  product_code: "",
  product_name: "",
  unit: "adet",
  estimated_quantity: "",
  estimated_unit_price: "",
  status: "Bekliyor",
  note: "",
};

const emptyPayment = {
  payment_date: new Date().toISOString().slice(0, 10),
  amount: "",
  currency: "TRY",
  exchange_rate: 1,
  payment_type: "Avans",
  description: "",
};

const expenseTypes = ["İşçilik", "Nakliye", "Uygulama", "Saha / ofis gideri", "Diğer"];

const emptyExpense = {
  expense_type: "İşçilik",
  amount: "",
  currency: "TRY",
  exchange_rate: 1,
  expense_date: new Date().toISOString().slice(0, 10),
  description: "",
};

const projectClosureStatuses = ["Açık", "Devam Ediyor", "Teslim Edildi", "Kapandı"];

function formatMoney(value, currency = "TRY") {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} ${currency || "TRY"}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("tr-TR");
}

function isDemoMovement(movement) {
  const source = normalizeText(`${movement?.source || ""} ${movement?.notes || ""} ${movement?.note || ""}`);
  return source.includes("demo") || source.includes("test") || source.includes("sahte");
}

function movementTypeLabel(movement) {
  const source = normalizeText(`${movement?.source || ""} ${movement?.notes || ""}`);

  if (source.includes("rezerve") || source.includes("stoktan karsiland")) return "Rezerve";
  if (source.includes("tamamlanan") || source.includes("isleme")) return "İşlenen Miktar";
  if (source.includes("sevk")) return "Sevk";
  if (source.includes("iade")) return "İade";
  if (movement?.movement_type === "out") return "Projeden Çıkış";
  return "Depoya Giriş";
}

function compactMoneyGroups(rows, amountFn, currencyFn) {
  const totals = rows.reduce((groups, row) => {
    const currency = currencyFn(row) || "TRY";
    groups[currency] = (groups[currency] || 0) + Number(amountFn(row) || 0);
    return groups;
  }, {});

  return Object.entries(totals)
    .filter(([, amount]) => Math.abs(amount) > 0)
    .sort(([left], [right]) => left.localeCompare(right));
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/\s+/g, " ");
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function textTokens(value) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function textSimilarity(left, right) {
  const leftText = normalizeText(left);
  const rightText = normalizeText(right);
  if (!leftText || !rightText) return 0;
  if (leftText === rightText) return 1;
  if (leftText.length >= 8 && rightText.length >= 8 && (leftText.includes(rightText) || rightText.includes(leftText))) return 0.9;

  const leftTokens = new Set(textTokens(leftText));
  const rightTokens = new Set(textTokens(rightText));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function statusClass(status) {
  const classes = {
    Taslak: "bg-slate-100 text-slate-700",
    "Onayland\u0131": "bg-blue-100 text-blue-700",
    "Devam Ediyor": "bg-emerald-100 text-emerald-700",
    "Tamamland\u0131": "bg-green-100 text-green-700",
    "\u0130ptal": "bg-red-100 text-red-700",
  };

  return classes[status] || "bg-slate-100 text-slate-700";
}

function itemStatusClass(status) {
  const classes = {
    Bekliyor: "bg-slate-100 text-slate-700",
    "Talep oluşturuldu": "bg-blue-100 text-blue-700",
    "Teklif bekleniyor": "bg-indigo-100 text-indigo-700",
    "Tedarikçiden bekleniyor": "bg-sky-100 text-sky-700",
    "Kısmi geldi": "bg-amber-100 text-amber-700",
    "Eksik geldi": "bg-yellow-100 text-yellow-800",
    "Fazla geldi": "bg-cyan-100 text-cyan-700",
    "Hatalı / arızalı geldi": "bg-red-100 text-red-700",
    "Projeye rezerve edildi": "bg-teal-100 text-teal-700",
    "İşleme alındı": "bg-violet-100 text-violet-700",
    "Sevk edildi": "bg-slate-900 text-white",
    "Satınalma gerekli": "bg-red-100 text-red-700",
    "Sipariş verildi": "bg-blue-100 text-blue-700",
    Depoda: "bg-emerald-100 text-emerald-700",
    İşlemde: "bg-purple-100 text-purple-700",
    Uygulamada: "bg-orange-100 text-orange-700",
    "Tamamland\u0131": "bg-green-100 text-green-700",
  };

  return classes[status] || "bg-slate-100 text-slate-700";
}

function SummaryCard({ title, value, text, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    green: "text-emerald-700",
    red: "text-red-600",
    blue: "text-blue-700",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-500">{title}</div>
      <div className={`mt-2 max-w-full break-words text-2xl font-black leading-tight ${tones[tone]}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-500">{text}</div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id;
  const previewResultsRef = useRef(null);

  const [project, setProject] = useState(null);
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [products, setProducts] = useState([]);
  const [projectRequests, setProjectRequests] = useState([]);
  const [projectReports, setProjectReports] = useState([]);
  const [projectOffers, setProjectOffers] = useState([]);
  const [projectOrders, setProjectOrders] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [stockMovements, setStockMovements] = useState([]);
  const [companySettings, setCompanySettings] = useState({ default_currency: "TRY", base_currency: "TRY" });
  const [activeTab, setActiveTab] = useState("Genel Özet");
  const [itemForm, setItemForm] = useState(emptyItem);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [expenseForm, setExpenseForm] = useState(emptyExpense);
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [expandedItems, setExpandedItems] = useState({});
  const [expandedRequestIds, setExpandedRequestIds] = useState([]);
  const [addingItemParentId, setAddingItemParentId] = useState("");
  const [selectedPurchaseItemIds, setSelectedPurchaseItemIds] = useState([]);
  const [selectedProjectItemIds, setSelectedProjectItemIds] = useState([]);
  const [itemStockFilter, setItemStockFilter] = useState("all");
  const [itemPriceDrafts, setItemPriceDrafts] = useState({});
  const [processQuantityDrafts, setProcessQuantityDrafts] = useState({});
  const [processingParentId, setProcessingParentId] = useState("");
  const [createdRequestId, setCreatedRequestId] = useState("");
  const [previewRows, setPreviewRows] = useState([]);
  const [selectedPreviewRowIds, setSelectedPreviewRowIds] = useState([]);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewCategoryFilter, setPreviewCategoryFilter] = useState("");
  const [editingPreviewRowId, setEditingPreviewRowId] = useState("");
  const [rawItems, setRawItems] = useState([]);
  const [mainProductCandidates, setMainProductCandidates] = useState([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState([]);
  const [suggestedHierarchyGroups, setSuggestedHierarchyGroups] = useState([]);
  const [isSuggestingHierarchy, setIsSuggestingHierarchy] = useState(false);
  const [selectedMainRawIds, setSelectedMainRawIds] = useState([]);
  const [hierarchyGroups, setHierarchyGroups] = useState([]);
  const [previewWarnings, setPreviewWarnings] = useState([]);
  const [previewBlocked, setPreviewBlocked] = useState(false);
  const [previewSections, setPreviewSections] = useState([]);
  const [storedSectionTotals, setStoredSectionTotals] = useState([]);
  const [previewParentId, setPreviewParentId] = useState("");
  const [createParentModalOpen, setCreateParentModalOpen] = useState(false);
  const [createParentSourceRowId, setCreateParentSourceRowId] = useState("");
  const [createParentNameDraft, setCreateParentNameDraft] = useState("");
  const [createParentQuantityDraft, setCreateParentQuantityDraft] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isImportingPreview, setIsImportingPreview] = useState(false);
  const [previewActionMessage, setPreviewActionMessage] = useState("");
  const [message, setMessage] = useState("");
  const [productCardWarning, setProductCardWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const visiblePreviewSections = useMemo(() => {
    const seen = new Set();

    return previewSections.filter((section) => {
      const name = String(section.section_name || "").trim().toUpperCase();
      const compactName = name.replace(/[^A-Z0-9\u00c7\u011e\u0130\u00d6\u015e\u00dc]/g, "");
      const total = Number(section.section_total || 0);

      if (!compactName || ["TL", "TRY", "EUR", "USD"].includes(compactName) || total <= 0) {
        return false;
      }

      const key = `${compactName}-${total.toFixed(2)}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }, [previewSections]);

  function normalizeGroupName(value) {
    return String(value || "")
      .trim()
      .toLocaleUpperCase("tr-TR")
      .replace(/[^A-Z0-9\u00c7\u011e\u0130\u00d6\u015e\u00dc]/g, "");
  }

  function mergedSectionTotals() {
    return [...visiblePreviewSections, ...storedSectionTotals];
  }

  function sectionQuoteTotalFor(name, fallbackTotal = 0) {
    const fallback = Number(fallbackTotal || 0) || 0;
    const target = normalizeGroupName(name);

    if (!target) {
      return fallback;
    }

    const match = mergedSectionTotals().find((section) =>
      normalizeGroupName(section.section_name) === target && Number(section.section_total || 0) > 0
    );

    return Number(match?.section_total || 0) || fallback;
  }

  function rememberSectionTotals(sections) {
    const cleanSections = (sections || []).filter((section) => Number(section.section_total || 0) > 0);
    setStoredSectionTotals(cleanSections);

    if (typeof window !== "undefined" && projectId) {
      window.localStorage.setItem(`project-section-totals-${projectId}`, JSON.stringify(cleanSections));
    }
  }

  function projectCurrencyForDisplay(sourceCurrency = "") {
    return project?.estimated_budget_currency
      || project?.contract_currency
      || companySettings.default_currency
      || companySettings.base_currency
      || sourceCurrency
      || "TRY";
  }

  function rowQuoteTotal(row, title = "") {
    return sectionQuoteTotalFor(
      row?.section_name || row?.category || row?.parent_name || title || row?.product_name,
      Number(row?.quote_total || row?.section_total || row?.estimated_total || row?.total || 0) || 0,
    );
  }

  useEffect(() => {
    if (typeof window !== "undefined" && projectId) {
      try {
        setStoredSectionTotals(JSON.parse(window.localStorage.getItem(`project-section-totals-${projectId}`) || "[]"));
      } catch {
        setStoredSectionTotals([]);
      }
    }

    loadProject();
  }, [projectId]);

  async function getUserOrRedirect() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return null;
    }

    return user;
  }

  async function loadProject() {
    setLoading(true);
    const user = await getUserOrRedirect();
    if (!user) return;

    const [projectRes, itemRes, paymentRes, expenseRes, revisionRes, productRes, requestRes, reportRes, offerRes, orderRes, allOrderRes, movementRes, settingsRes] = await Promise.all([
      supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("project_items")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("project_payments")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("payment_date", { ascending: false }),
      supabase
        .from("project_expenses")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("expense_date", { ascending: false }),
      supabase
        .from("project_revisions")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("revision_date", { ascending: false }),
      supabase
        .from("products")
        .select("*", { count: "exact" })
        .eq("user_id", user.id),
      supabase
        .from("requests")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("reports")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("offers")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("stock_movements")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("company_settings")
        .select("*")
        .eq("user_id", user.id)
        .limit(1),
    ]);

    if (projectRes.error) {
      setMessage("Proje bulunamadı veya proje tabloları hazır değil.");
      setLoading(false);
      return;
    }

    setProject(projectRes.data);
    setPayments(paymentRes.data || []);
    setExpenses(expenseRes.data || []);
    setRevisions(revisionRes.data || []);
    console.log("Project products query result", {
      userId: user.id,
      returned: productRes.data?.length || 0,
      count: productRes.count,
      error: productRes.error?.message || null,
      sampleUserIds: Array.from(new Set((productRes.data || []).map((product) => product.user_id))).slice(0, 5),
    });
    setProducts(productRes.data || []);
    const loadedItems = itemRes.data || [];
    const linkedItems = await ensureProductCardsForProjectItems(loadedItems, user.id, productRes.data || []);
    const linkedCount = linkedItems.filter((item) => item.product_id).length;
    const parentIdsWithChildren = new Set(linkedItems.map((item) => item.parent_item_id).filter(Boolean));
    const unlinkedItems = linkedItems
      .filter((item) => !item.product_id)
      .map((item) => ({
        id: item.id,
        item_type: item.item_type || "",
        product_code: item.product_code || "",
        product_name: item.product_name || item.description || "",
        unit: item.unit || "",
        reason: item.item_type === "main"
          ? "Ana ürün/ürün grubu olduğu için ürün kartına bağlanmadı"
          : parentIdsWithChildren.has(item.id)
            ? "Alt malzemesi olan üst kayıt olduğu için ürün kartına bağlanmadı"
            : !(item.product_name || item.description)
              ? "Ürün adı/açıklama boş olduğu için eşleştirilemedi"
              : "Eşleşme/oluşturma sonrası product_id boş kaldı",
      }));
    console.log("Project item product backfill", {
      total: linkedItems.length,
      linked: linkedCount,
      empty: linkedItems.length - linkedCount,
    });
    console.log("Unlinked project_items after product backfill", unlinkedItems);
    console.table(unlinkedItems);
    setItems(linkedItems);
    let nextProjectRequests = requestRes.data || [];
    if (projectRes.data?.project_code) {
      const { data: fallbackRequests, error: fallbackRequestError } = await supabase
        .from("requests")
        .select("*")
        .eq("user_id", user.id)
        .ilike("ad", `${projectRes.data.project_code}%`)
        .order("created_at", { ascending: false });

      if (fallbackRequestError) {
        console.warn("Proje talepleri yedek listeleme uyarisi:", fallbackRequestError);
      } else {
        const seenRequestIds = new Set(nextProjectRequests.map((request) => request.id));
        nextProjectRequests = [
          ...nextProjectRequests,
          ...(fallbackRequests || []).filter((request) => !seenRequestIds.has(request.id)),
        ];
      }
    } else if (requestRes.error) {
      console.warn("Proje talepleri listelenemedi:", requestRes.error);
    }
    setProjectRequests(nextProjectRequests);
    setProjectReports(reportRes.data || []);
    setProjectOffers(offerRes.data || []);
    setProjectOrders(orderRes.data || []);
    setAllOrders(allOrderRes.data || orderRes.data || []);
    setStockMovements(movementRes.data || []);
    if (settingsRes.data?.[0]) setCompanySettings(settingsRes.data[0]);
    setLoading(false);
  }

  async function loadProjectItems() {
    setLoading(true);
    const user = await getUserOrRedirect();
    if (!user) {
      setLoading(false);
      return items;
    }

    const { data, error } = await supabase
      .from("project_items")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Proje malzeme listesi yenilenemedi:", error);
      setMessage(error.message || "Malzeme listesi yenilenemedi.");
      setLoading(false);
      return items;
    }

    const freshItems = data || [];
    setItems(freshItems);
    setSelectedProjectItemIds((prev) => prev.filter((id) => freshItems.some((item) => item.id === id)));
    setSelectedPurchaseItemIds((prev) => prev.filter((id) => freshItems.some((item) => item.id === id)));
    setLoading(false);
    return freshItems;
  }

  function scrollToPreviewResults() {
    window.setTimeout(() => {
      previewResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  async function refreshProjectAfterMaterialChange(nextItems, user) {
    await refreshProjectBudget(nextItems);
    const freshItems = await loadProjectItems();

    if (!user) return freshItems;

    window.setTimeout(() => {
      ensureProductCardsForProjectItems(freshItems, user.id)
        .then((linkedItems) => {
          setItems(linkedItems);
          return loadProjectItems();
        })
        .catch((error) => {
          console.warn("Urun karti eslestirme arka planda tamamlanamadi:", error);
        });
    }, 0);

    return freshItems;
  }

  function isMainProjectItem(item) {
    if (!item?.id) return false;
    if (item.item_type === "main") return true;
    if (item.parent_item_id) return false;
    if ((childItemsByParent[item.id] || []).length > 0) return true;

    const hasSectionTotal = sectionQuoteTotalFor(item.product_name, 0) > 0;
    const hasProductCode = Boolean(normalizeCode(item.product_code));
    const note = normalizeText(item.note || "");

    return (!hasProductCode && hasSectionTotal) || note.includes("kategori grubu");
  }

  function projectItemGroupKey(name, total) {
    return `${normalizeGroupName(name)}-${Number(total || 0).toFixed(2)}`;
  }

  function materialIdentityKey(code, name, category = "") {
    return `${normalizeCode(code)}|${normalizeText(name)}|${normalizeGroupName(category)}`;
  }

  function stockInfoForItem(item) {
    const code = normalizeCode(item.product_code);
    const name = normalizeText(item.product_name);

    const matched = products.filter((product) => {
      const productCode = normalizeCode(product.product_code);
      const productName = normalizeText(product.product_name);

      if (code && productCode && code === productCode && name === productName) return true;
      if (!code && name && name === productName) return true;
      return false;
    });

    const stockQuantity = matched.reduce((sum, product) => {
      const total = Number(product.current_stock || 0);
      const reserved = Number(product.reserved_stock || 0);
      return sum + Math.max(total - reserved, 0);
    }, 0);
    const criticalLevels = matched
      .map((product) => Number(product.minimum_stock ?? product.critical_stock ?? product.min_stock ?? 0))
      .filter((value) => value > 0);
    const criticalStock = criticalLevels.length > 0 ? Math.max(...criticalLevels) : 0;
    const relation = componentRelationForItem(item, items);
    const estimatedQuantity = Number(item.estimated_quantity || 0);
    const openQuantity = Math.max(estimatedQuantity - relation.consumedChildQuantity, 0);
    const requiredQuantity = Math.max(0, openQuantity - relation.reservedChildQuantity - stockQuantity);
    const isMainItem = isMainProjectItem(item);
    const needsPurchase = !isMainItem && requiredQuantity > 0;
    const isCritical = !isMainItem && (criticalStock > 0 ? stockQuantity < criticalStock : requiredQuantity > 0);

    return {
      stockQuantity,
      matchedProducts: matched,
      criticalStock,
      estimatedQuantity,
      consumedQuantity: relation.consumedChildQuantity,
      reservedQuantity: relation.reservedChildQuantity,
      openQuantity,
      requiredQuantity,
      needsPurchase,
      isCritical,
      isMainItem,
    };
  }

  function stockWarning(item) {
    const info = stockInfoForItem(item);
    const available = info.stockQuantity;

    if (info.isMainItem) return { available: "-", text: "Ana kalem", tone: "slate" };
    if (info.estimatedQuantity <= 0) return { available, text: "Miktar girilmedi", tone: "slate" };
    if (info.requiredQuantity <= 0) return { available, text: "Karşılanabilir", tone: "green" };
    if (available > 0) return { available, text: "Kısmi stok var", tone: "yellow" };
    return { available, text: "Satınalma gerekli", tone: "red" };
  }

  function productCardLabel(item) {
    if (item.item_type === "main") return "";
    if (item.productCardStatus) return item.productCardStatus;
    return item.product_id ? "Ürün kartına bağlı" : "Ürün kartı yok";
  }

  function productCardLabelClass(item) {
    if (item.productCardStatus === "Ürün kartı oluşturuldu") return "bg-emerald-100 text-emerald-700";
    if (item.product_id) return "bg-blue-100 text-blue-700";
    return "bg-slate-100 text-slate-600";
  }

  function readFirstValue(source, keys) {
    for (const key of keys) {
      const value = source?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return "";
  }

  function normalizeOrderItems(order) {
    return (order?.items || []).map((line) => {
      const quantity = Number(readFirstValue(line, ["quantity", "miktar", "talepEdilenAdet", "adet", "estimated_quantity"]) || 0) || 0;
      const unitPrice = Number(readFirstValue(line, ["netUnitPrice", "unitPrice", "birimFiyat", "net_unit_price", "unit_price", "price", "fiyat"]) || 0) || 0;
      const total = Number(readFirstValue(line, ["total", "netTotal", "net_total", "toplam", "estimated_total"]) || 0) || quantity * unitPrice;

      return {
        orderId: order.id,
        projectId: order.project_id,
        createdAt: order.created_at || order.order_date || order.date || order.delivery_date,
        productCode: readFirstValue(line, ["productCode", "urunKodu", "product_code", "code", "kod"]),
        productName: readFirstValue(line, ["productName", "urunAciklamasi", "product_name", "description", "urunAdi", "name", "aciklama"]),
        quantity,
        unitPrice,
        total,
      };
    });
  }

  function projectItemMatchScore(item, line) {
    const itemCode = normalizeCode(item.product_code);
    const lineCode = normalizeCode(line.productCode || line.product_code);
    if (itemCode && lineCode && itemCode === lineCode) return 1;

    const itemName = item.product_name || item.description || "";
    const lineName = line.productName || line.product_name || line.description || "";
    return textSimilarity(itemName, lineName);
  }

  function productMatchesProjectItem(product, item) {
    const itemCode = normalizeCode(item.product_code);
    const productCode = normalizeCode(product.product_code);
    if (itemCode && productCode && itemCode === productCode) return true;

    const unitMatches = normalizeText(product.unit || "adet") === normalizeText(item.unit || "adet");
    const itemIdentity = normalizeProductIdentityForStock(item);
    const productIdentity = normalizeProductIdentityForStock(product);
    const nameScore = textSimilarity(productIdentity.product_name, itemIdentity.product_name);
    const brandScore = itemIdentity.brand || productIdentity.brand ? textSimilarity(productIdentity.brand, itemIdentity.brand) : 1;
    return unitMatches && nameScore >= 0.75 && brandScore >= 0.6;
  }

  function normalizeProductIdentityForStock(item) {
    const rawBrand = String(item?.brand || "").trim();
    let productName = String(item?.product_name || item?.description || "").trim();
    let brand = rawBrand && rawBrand !== "-" ? rawBrand : "";

    if (!brand && productName) {
      const leadingQuantityBrand = productName.match(/^\s*\d+(?:[.,]\d+)?\s*([A-Za-zÇĞİÖŞÜçğıöşü]{2,})\s+(.+)$/);
      if (leadingQuantityBrand) {
        brand = leadingQuantityBrand[1].toUpperCase();
        productName = leadingQuantityBrand[2].trim();
      }
    }

    if (!brand && productName) {
      const firstTokenBrand = productName.match(/^([A-ZÇĞİÖŞÜ]{2,20})\s+(.+)$/);
      const rest = firstTokenBrand?.[2] || "";
      if (firstTokenBrand && /[0-9/-]/.test(rest)) {
        brand = firstTokenBrand[1].trim();
        productName = rest.trim();
      }
    }

    return { brand, product_name: productName };
  }

  function safeProductCodeForItem(item) {
    const rawCode = String(item?.product_code || "").trim();
    if (rawCode) return rawCode.toUpperCase();

    const source = `${item?.product_name || item?.description || "URUN"}-${item?.id || Date.now()}`;
    const safe = normalizeText(source)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36);

    return safe ? `PRJ-${safe}` : `PRJ-URUN-${Date.now()}`;
  }

  function logProductCardError(error, item, payload, stage = "insert") {
    const details = {
      stage,
      projectId,
      itemId: item?.id || null,
      itemName: item?.product_name || item?.description || "",
      itemCode: item?.product_code || "",
      brand: item?.brand || "",
      unit: item?.unit || "",
      payload,
      errorMessage: error?.message || null,
      errorDetails: error?.details || null,
      errorHint: error?.hint || null,
      errorCode: error?.code || null,
      rawError: error || null,
    };

    console.error("Ürün kartı oluşturulamadı:", details);
  }

  function projectItemCategory(item) {
    if (item?.category) return item.category;

    const parent = items.find((candidate) => candidate.id === item?.parent_item_id);
    return parent?.product_name || item?.section_name || "Genel";
  }

  function stripPayloadFields(payload, fields) {
    const cleanRow = (row) => Object.fromEntries(
      Object.entries(row || {}).filter(([key]) => !fields.includes(key)),
    );

    return Array.isArray(payload) ? payload.map(cleanRow) : cleanRow(payload);
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

  async function insertProductWithFallback(payload) {
    const firstResult = await supabase
      .from("products")
      .insert(payload)
      .select("*")
      .single();

    if (!firstResult.error) return firstResult;

    const fallbackFields = [
      "brand",
      "critical_stock",
      "manual_unit_price",
      "last_currency",
      "last_movement_at",
      "source",
      "notes",
    ];

    console.warn("Product insert full payload failed, retrying basic payload:", {
      errorMessage: firstResult.error?.message || null,
      errorDetails: firstResult.error?.details || null,
      errorHint: firstResult.error?.hint || null,
      errorCode: firstResult.error?.code || null,
      rawError: firstResult.error || null,
      payload,
    });

    return supabase
      .from("products")
      .insert(stripPayloadFields(payload, fallbackFields))
      .select("*")
      .single();
  }

  async function ensureProductCardsForProjectItems(projectItems, userId, productRows = products) {
    const projectItemRows = projectItems || [];
    const parentById = new Map(projectItemRows.map((item) => [item.id, item]));
    const parentIdsWithChildren = new Set(projectItemRows.map((item) => item.parent_item_id).filter(Boolean));
    const subItems = projectItemRows.filter((item) =>
      item?.id && !item.product_id && item.item_type !== "main" && !parentIdsWithChildren.has(item.id) && (item.product_name || item.description)
    );

    if (subItems.length === 0) {
      setProductCardWarning("");
      return projectItemRows;
    }

    const createdProducts = [];
    const linkedItems = [];
    const failedItems = [];

    for (const item of subItems) {
      const itemName = String(item.product_name || item.description || "").trim();
      if (!itemName) {
        failedItems.push(item);
        console.warn("Ürün kartı oluşturma atlandı: ürün adı boş.", {
          projectId,
          itemId: item?.id || null,
          itemCode: item?.product_code || "",
          brand: item?.brand || "",
          unit: item?.unit || "",
        });
        continue;
      }

      const safeProductCode = safeProductCodeForItem(item);
      const safeUnit = item.unit || "adet";
      const safeCurrency = item.currency || projectCurrencyForDisplay() || "TRY";
      const normalizedIdentity = normalizeProductIdentityForStock(item);
      const searchableProducts = [...(productRows || []), ...createdProducts];
      let product = searchableProducts.find((candidate) => productMatchesProjectItem(candidate, item));
      let productCardStatus = "Ürün kartına bağlı";

      if (!product) {
        const { data: existingByCode, error: existingByCodeError } = await supabase
          .from("products")
          .select("*")
          .eq("user_id", userId)
          .eq("product_code", safeProductCode)
          .maybeSingle();

        if (existingByCodeError) {
          logProductCardError(existingByCodeError, item, { product_code: safeProductCode }, "existing-lookup");
        }

        product = existingByCode || null;
      }

      if (!product) {
        const productPayload = {
            user_id: userId,
            product_code: safeProductCode,
            brand: normalizedIdentity.brand || "",
            product_name: normalizedIdentity.product_name || itemName,
            unit: safeUnit,
            current_stock: 0,
            min_stock: 0,
            critical_stock: 0,
            last_unit_price: 0,
            manual_unit_price: 0,
            last_currency: safeCurrency,
            category: parentById.get(item.parent_item_id)?.product_name || projectItemCategory(item),
            source: "Proje malzeme listesi",
            notes: `Proje: ${project?.project_code || projectId}`,
          };

        const { data: insertedProduct, error: productError } = await insertProductWithFallback(productPayload);

        if (productError) {
          const duplicateCode = productError.code === "23505" || String(productError.message || "").toLowerCase().includes("duplicate");

          if (duplicateCode) {
            const { data: duplicateProduct, error: duplicateLookupError } = await supabase
              .from("products")
              .select("*")
              .eq("user_id", userId)
              .eq("product_code", safeProductCode)
              .maybeSingle();

            if (duplicateProduct && !duplicateLookupError) {
              product = duplicateProduct;
            } else {
              failedItems.push(item);
              logProductCardError(duplicateLookupError || productError, item, productPayload, "duplicate-lookup");
              continue;
            }
          } else {
            failedItems.push(item);
            logProductCardError(productError, item, productPayload, "insert");
            continue;
          }
        }

        if (!product) {
          product = insertedProduct;
          if (insertedProduct) createdProducts.push(insertedProduct);
          productCardStatus = "Ürün kartı oluşturuldu";
        }
      }

      if (!product?.id) continue;

      const { error: itemError } = await supabase
        .from("project_items")
        .update({ product_id: product.id, updated_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("project_id", projectId)
        .eq("user_id", userId);

      if (itemError) {
        failedItems.push(item);
        console.error("Proje malzemesi ürün kartına bağlanamadı:", {
          projectId,
          itemId: item?.id || null,
          itemName,
          itemCode: item?.product_code || "",
          productId: product.id,
          errorMessage: itemError?.message || null,
          errorDetails: itemError?.details || null,
          errorHint: itemError?.hint || null,
          errorCode: itemError?.code || null,
          rawError: itemError || null,
        });
        continue;
      }

      linkedItems.push({ ...item, product_id: product.id, productCardStatus });
    }

    if (failedItems.length > 0) {
      const warning = `${failedItems.length} ürün kartı oluşturulamadı. Detay için konsolu kontrol edin.`;
      setProductCardWarning(warning);
      setMessage((current) => current || warning);
    } else {
      setProductCardWarning("");
    }

    if (createdProducts.length > 0) {
      setProducts((prev) => [...prev, ...createdProducts]);
    }

    if (linkedItems.length === 0) return projectItemRows;

    const linkedById = new Map(linkedItems.map((item) => [item.id, item]));
    return projectItemRows.map((item) => linkedById.get(item.id) || item);
  }

  function bestPurchaseLineForItem(item, lines) {
    const candidates = lines
      .filter((line) => Number(line.unitPrice || 0) > 0)
      .map((line) => ({ ...line, matchScore: projectItemMatchScore(item, line) }))
      .filter((line) => line.matchScore >= 0.55)
      .sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

    return candidates[0];
  }

  function priceSourceClass(source) {
    const classes = {
      "Proje al\u0131m\u0131ndan": "bg-blue-100 text-blue-700",
      "Son genel al\u0131mdan": "bg-purple-100 text-purple-700",
      Tekliften: "bg-emerald-100 text-emerald-700",
      "\u00dcr\u00fcn kart\u0131ndan": "bg-slate-100 text-slate-700",
      "Fiyat bulunamad\u0131": "bg-red-100 text-red-700",
    };

    return classes[source] || classes["Fiyat bulunamad\u0131"];
  }

  function resolveProjectItemPrice(item, projectOrderRows = projectOrders, allOrderRows = allOrders, movementRows = stockMovements) {
    const quantity = Number(item.estimated_quantity || 0) || 0;
    const projectOrderLines = projectOrderRows.flatMap(normalizeOrderItems);
    const allOrderLines = allOrderRows.flatMap(normalizeOrderItems);

    const quoteUnitPrice = Number(item.quote_unit_price || item.estimated_unit_price || 0);
    const quoteTotal = sectionQuoteTotalFor(item.product_name, Number(item.quote_total || item.estimated_total || 0) || 0);
    if (quoteUnitPrice > 0 || quoteTotal > 0) {
      const unitPrice = quoteUnitPrice || (quantity > 0 ? quoteTotal / quantity : quoteTotal);
      return { unitPrice, total: quantity > 0 ? quantity * unitPrice : quoteTotal, source: "Tekliften", orderId: null, sourceDate: item.updated_at || item.created_at };
    }

    const projectOrderMatch = bestPurchaseLineForItem(item, projectOrderLines);
    if (projectOrderMatch) {
      const unitPrice = Number(projectOrderMatch.unitPrice || 0);
      return { unitPrice, total: quantity * unitPrice, source: "Proje al\u0131m\u0131ndan", orderId: projectOrderMatch.orderId, sourceDate: projectOrderMatch.createdAt };
    }

    const movementMatch = (movementRows || [])
      .filter((movement) => Number(movement.unit_price || 0) > 0)
      .map((movement) => ({
        unitPrice: Number(movement.unit_price || 0),
        orderId: movement.order_id,
        createdAt: movement.created_at || movement.movement_date,
        matchScore: projectItemMatchScore(item, { productCode: movement.product_code, productName: movement.product_name }),
      }))
      .filter((movement) => movement.matchScore >= 0.55)
      .sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      })[0];
    if (movementMatch) {
      const unitPrice = Number(movementMatch.unitPrice || 0);
      return { unitPrice, total: quantity * unitPrice, source: "Proje al\u0131m\u0131ndan", orderId: movementMatch.orderId, sourceDate: movementMatch.createdAt };
    }

    const generalOrderMatch = bestPurchaseLineForItem(item, allOrderLines);
    if (generalOrderMatch) {
      const unitPrice = Number(generalOrderMatch.unitPrice || 0);
      return { unitPrice, total: quantity * unitPrice, source: "Son genel al\u0131mdan", orderId: generalOrderMatch.orderId, sourceDate: generalOrderMatch.createdAt };
    }

    const productMatch = [...products]
      .filter((product) => Number(product.last_unit_price || 0) > 0)
      .map((product) => ({
        ...product,
        matchScore: projectItemMatchScore(item, { productCode: product.product_code, productName: product.product_name }),
      }))
      .filter((product) => product.matchScore >= 0.55)
      .sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        return new Date(b.last_movement_at || b.updated_at || b.created_at || 0) - new Date(a.last_movement_at || a.updated_at || a.created_at || 0);
      })[0];
    if (productMatch) {
      const unitPrice = Number(productMatch.last_unit_price || 0);
      return { unitPrice, total: quantity * unitPrice, source: "\u00dcr\u00fcn kart\u0131ndan", orderId: null, sourceDate: productMatch.updated_at || productMatch.created_at };
    }

    return { unitPrice: 0, total: 0, source: "Fiyat bulunamad\u0131", orderId: null, sourceDate: null };
  }
  function updateItemForm(field, value) {
    setItemForm((prev) => ({ ...prev, [field]: value }));
  }

  function updatePaymentForm(field, value) {
    setPaymentForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateExpenseForm(field, value) {
    setExpenseForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleMainProductCandidate(candidateId) {
    setSelectedCandidateIds((prev) =>
      prev.includes(candidateId)
        ? prev.filter((id) => id !== candidateId)
        : [...prev, candidateId],
    );
  }

  async function suggestProductHierarchy() {
    if (selectedCandidateIds.length === 0) {
      setMessage("Alt ürün önerisi için önce en az bir ana ürün adayı seçin.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token || !API_URL) {
      setMessage("Alt ürün önerisi için oturum veya API adresi bulunamadı.");
      return;
    }

    const selectedMainProducts = mainProductCandidates
      .filter((candidate) => selectedCandidateIds.includes(candidate.id))
      .map((candidate) => ({
        id: candidate.id,
        raw_item_id: candidate.raw_item_id,
        title: candidate.title,
        estimated_total: candidate.estimated_total,
      }));

    setIsSuggestingHierarchy(true);
    setMessage("");

    try {
      const response = await fetch(`${API_URL}/suggest-product-hierarchy`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          raw_items: rawItems,
          selected_main_products: selectedMainProducts,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setSuggestedHierarchyGroups([]);
        setMessage(data.warnings?.join(" | ") || "Alt ürün önerisi oluşturulamadı.");
        return;
      }

      setSuggestedHierarchyGroups(data.hierarchy_groups || []);
      setMessage("Alt ürün eşleştirme önerisi oluşturuldu. Bu aşamada sadece görüntülenir.");
    } catch (error) {
      console.error(error);
      setSuggestedHierarchyGroups([]);
      setMessage("Alt ürün önerisi sırasında hata oluştu.");
    } finally {
      setIsSuggestingHierarchy(false);
    }
  }

  function removeSuggestedGroup(groupId) {
    setSuggestedHierarchyGroups((prev) => prev.filter((group) => group.id !== groupId));
  }

  function removeSuggestedSubItem(groupId, rawItemId) {
    setSuggestedHierarchyGroups((prev) =>
      prev.map((group) =>
        group.id === groupId
          ? { ...group, sub_items: (group.sub_items || []).filter((item) => item.raw_item_id !== rawItemId) }
          : group,
      ),
    );
  }

  function moveSuggestedSubItem(fromGroupId, rawItemId, targetGroupId) {
    if (fromGroupId === targetGroupId) return;

    setSuggestedHierarchyGroups((prev) => {
      let movingItem = null;
      const withoutItem = prev.map((group) => ({
        ...group,
        sub_items: (group.sub_items || []).filter((item) => {
          if (group.id === fromGroupId && item.raw_item_id === rawItemId) {
            movingItem = item;
            return false;
          }
          return true;
        }),
      }));

      if (!movingItem) return prev;

      return withoutItem.map((group) =>
        group.id === targetGroupId
          ? { ...group, sub_items: [...(group.sub_items || []), movingItem] }
          : group,
      );
    });
  }

  function rawItemToSuggestedSubItem(rawItem) {
    return {
      raw_item_id: rawItem.id,
      title: rawItem.description || rawItem.product_code || "-",
      product_code: rawItem.product_code || "",
      brand: rawItem.brand || "",
      quantity: Number(rawItem.quantity || 0),
      unit: rawItem.unit || "",
      unit_price: Number(rawItem.unit_price || 0),
      total: Number(rawItem.total || 0),
      currency: rawItem.currency || "TRY",
      suggestion_score: 0,
      reasons: ["kullanıcı manuel ekledi"],
    };
  }

  function addRawItemToSuggestedGroup(groupId, rawItemId) {
    const rawItem = rawItems.find((item) => item.id === rawItemId);
    if (!rawItem) return;

    setSuggestedHierarchyGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        const exists = (group.sub_items || []).some((item) => item.raw_item_id === rawItemId);
        if (exists) return group;
        return { ...group, sub_items: [...(group.sub_items || []), rawItemToSuggestedSubItem(rawItem)] };
      }),
    );
  }

  function promoteSuggestedSubItem(groupId, rawItemId) {
    setSuggestedHierarchyGroups((prev) => {
      let promoted = null;
      const groups = prev.map((group) => ({
        ...group,
        sub_items: (group.sub_items || []).filter((item) => {
          if (group.id === groupId && item.raw_item_id === rawItemId) {
            promoted = item;
            return false;
          }
          return true;
        }),
      }));

      if (!promoted) return prev;

      return [
        ...groups,
        {
          id: `manual-group-${promoted.raw_item_id}`,
          main_product: {
            raw_item_id: promoted.raw_item_id,
            title: promoted.title,
            estimated_total: promoted.total || 0,
          },
          sub_items: [],
          suggestion_score: 0,
          user_confirmed: false,
        },
      ];
    });
  }

  function rawItemById(rawItemId) {
    return rawItems.find((item) => item.id === rawItemId) || {};
  }

  function suggestedMainPayload(group, userId) {
    const raw = rawItemById(group.main_product?.raw_item_id);
    const title = group.main_product?.title || raw.description || raw.product_code || "Ana ürün";
    const parentQuantity = Number(raw.section_quantity || raw.quantity || 0) || 0;
    const quoteTotal = sectionQuoteTotalFor(
      raw.section_name || title,
      Number(group.main_product?.estimated_total || raw.section_total || raw.total || 0) || 0,
    );

    return {
      user_id: userId,
      project_id: projectId,
      parent_item_id: null,
      product_code: raw.product_code || "",
      brand: raw.brand || "",
      product_name: title,
      unit: raw.unit || "adet",
      estimated_quantity: parentQuantity,
      estimated_unit_price: quoteTotal,
      quote_unit_price: quoteTotal,
      currency: raw.currency || "TRY",
      estimated_total: quoteTotal,
      quote_total: quoteTotal,
      status: "Bekliyor",
      source_file: raw.source_file || "",
      source_type: raw.source_type || "",
      raw_item_id: group.main_product?.raw_item_id || "",
      item_type: "main",
      note: parentQuantity > 0 ? "Hiyerarşik teklif aktarımı" : "Ana kalem miktarı kontrol gerekli",
      updated_at: new Date().toISOString(),
    };
  }

  function suggestedSubPayload(item, parentId, userId, parentRow = null) {
    const raw = rawItemById(item.raw_item_id);
    const parent = parentRow || items.find((candidate) => candidate.id === parentId) || {};
    const childQuantity = Number(item.quantity || raw.quantity || 0);

    return {
      user_id: userId,
      project_id: projectId,
      parent_item_id: parentId,
      product_code: item.product_code || raw.product_code || "",
      brand: item.brand || raw.brand || "",
      product_name: item.title || raw.description || raw.product_code || "Alt ürün",
      unit: item.unit || raw.unit || "adet",
      estimated_quantity: childQuantity,
      estimated_unit_price: Number(item.unit_price || raw.unit_price || 0),
      currency: item.currency || raw.currency || "TRY",
      estimated_total: Number(item.total || raw.total || 0),
      status: "Bekliyor",
      source_file: raw.source_file || "",
      source_type: raw.source_type || "",
      raw_item_id: item.raw_item_id || raw.id || "",
      item_type: "sub",
      note: (item.reasons || []).join(", "),
      ...hierarchyQuantityFields(parent, childQuantity),
      updated_at: new Date().toISOString(),
    };
  }

  async function saveSuggestedHierarchyToProject() {
    const validGroups = suggestedHierarchyGroups.filter((group) => group.main_product?.raw_item_id);

    if (validGroups.length === 0) {
      setMessage("Kaydedilecek hiyerarşi grubu yok.");
      return;
    }

    const user = await getUserOrRedirect();
    if (!user) return;

    setMessage("");

    const parentPayload = validGroups.map((group) => suggestedMainPayload(group, user.id));

    const { data: insertedParents, error: parentError } =
      await insertProjectItemsWithFallback(parentPayload);

    if (parentError) {
      setMessage("Hiyerarşik kayıt yapılamadı. Supabase'de project_items için brand, source_file, source_type, raw_item_id ve item_type alanları çalıştırılmış olmalı.");
      return;
    }

    const childPayload = [];
    validGroups.forEach((group, index) => {
      const parent = insertedParents?.[index];
      if (!parent) return;

      (group.sub_items || []).forEach((item) => {
        childPayload.push(suggestedSubPayload(item, parent.id, user.id, parent));
      });
    });

    let insertedChildren = [];
    if (childPayload.length > 0) {
      const { data, error } = await insertProjectItemsWithFallback(childPayload);

      if (error) {
        setMessage("Ana ürünler kaydedildi ama alt ürünler kaydedilemedi.");
        await loadProject();
        return;
      }

      insertedChildren = data || [];
    }

    const nextItems = await ensureProductCardsForProjectItems([...items, ...(insertedParents || []), ...insertedChildren], user.id);
    setItems(nextItems);
    setSuggestedHierarchyGroups([]);
    setMainProductCandidates([]);
    setSelectedCandidateIds([]);
    setRawItems([]);
    setPreviewRows([]);
    setPreviewParentId("");
    await refreshProjectBudget(nextItems);
    await loadProject();
    setMessage("Hiyerarşi proje malzeme listesine ana ürün ve alt ürün olarak kaydedildi.");
  }

  async function refreshProjectBudget(nextItems) {
    const estimatedTotal = nextItems.reduce((sum, item) => sum + Number(item.estimated_total || 0), 0);

    await supabase
      .from("projects")
      .update({
        estimated_budget: estimatedTotal,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", project.user_id);
  }

  function revisionTotalsForChange(beforeItem, afterItem) {
    const oldQuantity = Number(beforeItem?.estimated_quantity || 0);
    const newQuantity = Number(afterItem?.estimated_quantity || 0);
    const oldUnitPrice = Number(beforeItem?.estimated_unit_price || beforeItem?.quote_unit_price || 0);
    const newUnitPrice = Number(afterItem?.estimated_unit_price || afterItem?.quote_unit_price || 0);
    const oldTotal = Number(beforeItem?.estimated_total || oldQuantity * oldUnitPrice || 0);
    const newTotal = Number(afterItem?.estimated_total || newQuantity * newUnitPrice || 0);

    return {
      oldQuantity,
      newQuantity,
      quantityDelta: newQuantity - oldQuantity,
      oldUnitPrice,
      newUnitPrice,
      unitPriceDelta: newUnitPrice - oldUnitPrice,
      oldTotal,
      newTotal,
      costImpact: newTotal - oldTotal,
    };
  }

  function automaticRevisionTitle(actionType, item) {
    const names = {
      add: "Malzeme eklendi",
      remove: "Malzeme çıkarıldı",
      quantity: "Malzeme adedi değişti",
      price: "Malzeme fiyatı değişti",
    };

    return `${names[actionType] || "Malzeme revizyonu"}: ${item?.product_name || "Malzeme"}`;
  }

  async function insertRevisionWithFallback(payload) {
    const fullResult = await supabase
      .from("project_revisions")
      .insert(payload)
      .select("*")
      .single();

    if (!fullResult.error) return fullResult;

    const fallbackFields = [
      "action_type",
      "project_item_id",
      "product_code",
      "product_name",
      "unit",
      "old_quantity",
      "new_quantity",
      "quantity_delta",
      "old_unit_price",
      "new_unit_price",
      "unit_price_delta",
      "old_total",
      "new_total",
      "cost_impact",
      "performed_by",
      "performed_by_email",
    ];

    const fallbackPayload = stripPayloadFields(payload, fallbackFields);
    return supabase
      .from("project_revisions")
      .insert(fallbackPayload)
      .select("*")
      .single();
  }

  async function recordMaterialRevision({ actionType, beforeItem = null, afterItem = null, user, description = "" }) {
    const item = afterItem || beforeItem;
    if (!item || !user) return null;

    const totals = revisionTotalsForChange(beforeItem, afterItem);
    const currency = item.currency || projectCurrencyForDisplay();
    const exchangeRate = Number(item.exchange_rate || getExchangeRate(currency, companySettings) || 1);
    const costImpact = Number(totals.costImpact || 0);
    const detail = [
      description,
      `Eski adet: ${totals.oldQuantity}`,
      `Yeni adet: ${totals.newQuantity}`,
      `Adet farkı: ${totals.quantityDelta}`,
      `Eski birim fiyat: ${formatMoney(totals.oldUnitPrice, currency)}`,
      `Yeni birim fiyat: ${formatMoney(totals.newUnitPrice, currency)}`,
      `Maliyet etkisi: ${formatMoney(costImpact, currency)}`,
    ].filter(Boolean).join(" | ");

    const payload = {
      user_id: user.id,
      project_id: projectId,
      revision_date: new Date().toISOString().slice(0, 10),
      revision_type: "Malzeme Değişikliği",
      action_type: actionType,
      title: automaticRevisionTitle(actionType, item),
      description: detail,
      revenue_amount: 0,
      revenue_base_amount: 0,
      cost_amount: costImpact,
      cost_base_amount: calculateBaseAmount(costImpact, currency, companySettings, exchangeRate),
      currency,
      exchange_rate: exchangeRate,
      base_currency: getBaseCurrency(companySettings),
      status: "Uygulandı",
      project_item_id: item.id || null,
      product_code: item.product_code || "",
      product_name: item.product_name || "",
      unit: item.unit || "adet",
      old_quantity: totals.oldQuantity,
      new_quantity: totals.newQuantity,
      quantity_delta: totals.quantityDelta,
      old_unit_price: totals.oldUnitPrice,
      new_unit_price: totals.newUnitPrice,
      unit_price_delta: totals.unitPriceDelta,
      old_total: totals.oldTotal,
      new_total: totals.newTotal,
      cost_impact: costImpact,
      performed_by: user.id,
      performed_by_email: user.email || "",
    };

    const { data, error } = await insertRevisionWithFallback(payload);

    if (error) {
      console.error("Otomatik revizyon kaydı oluşturulamadı:", error);
      setMessage(error.message || "Malzeme değişti fakat revizyon kaydı oluşturulamadı.");
      return null;
    }

    setRevisions((prev) => [data, ...prev]);
    return data;
  }

  async function deleteRevision(revision) {
    if (!revision?.id) return;

    const approved = window.confirm("Bu revizyon kaydı silinecek. Devam etmek istiyor musunuz?");
    if (!approved) return;

    if (revision.project_item_id) {
      const linkedApproved = window.confirm(
        "Bu revizyon bir malzeme satırıyla ilişkili. Silme işlemi malzeme listesini geri almaz, sadece revizyon geçmişinden kaldırır. Devam etmek istiyor musunuz?",
      );
      if (!linkedApproved) return;
    }

    const user = await getUserOrRedirect();
    if (!user) return;

    const { error } = await supabase
      .from("project_revisions")
      .delete()
      .eq("id", revision.id)
      .eq("project_id", projectId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Revizyon silinemedi:", error);
      setMessage(error.message || "Revizyon kaydı silinemedi. Bağlı kayıtları kontrol edin.");
      return;
    }

    setRevisions((prev) => prev.filter((item) => item.id !== revision.id));
    setMessage("Revizyon kaydı silindi.");
  }

  async function addProjectItem(event) {
    event.preventDefault();
    setMessage("");

    const user = await getUserOrRedirect();
    if (!user) return;

    const quantity = Number(itemForm.estimated_quantity || 0);
    const unitPrice = Number(itemForm.estimated_unit_price || 0);
    const total = quantity * unitPrice;

    if (!itemForm.product_name.trim()) {
      setMessage("Ürün adı zorunlu.");
      return;
    }

    const payload = {
      user_id: user.id,
      project_id: projectId,
      parent_item_id: itemForm.parent_item_id || null,
      product_code: itemForm.product_code.trim().toUpperCase(),
      product_name: itemForm.product_name.trim(),
      unit: itemForm.unit || "adet",
      estimated_quantity: quantity,
      estimated_unit_price: unitPrice,
      estimated_total: total,
      status: itemForm.status,
      note: itemForm.note.trim(),
      item_type: itemForm.parent_item_id ? "sub" : "main",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("project_items")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      setMessage("Malzeme satırı eklenemedi. Supabase şemasında parent_item_id/status alanları çalıştırılmış olmalı.");
      return;
    }

    const nextItems = await ensureProductCardsForProjectItems([...items, data], user.id);
    await recordMaterialRevision({
      actionType: "add",
      beforeItem: { ...data, estimated_quantity: 0, estimated_unit_price: Number(data.estimated_unit_price || 0), estimated_total: 0 },
      afterItem: data,
      user,
      description: itemForm.parent_item_id ? "Alt malzeme eklendi." : "Ana malzeme eklendi.",
    });
    setItems(nextItems);
    setItemForm(emptyItem);
    setAddingItemParentId("");
    await refreshProjectBudget(nextItems);
    await loadProject();
  }

  async function updateItemStatus(itemId, status) {
    const { error } = await supabase
      .from("project_items")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("project_id", projectId);

    if (error) {
      setMessage("Durum güncellenemedi.");
      return;
    }

    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, status } : item)));
  }

  function startAddingChildItem(parentItem) {
    const willClose = addingItemParentId === parentItem.id;
    setAddingItemParentId(willClose ? "" : parentItem.id);
    setExpandedItems((prev) => ({ ...prev, [parentItem.id]: !willClose }));
    setItemForm({
      ...emptyItem,
      parent_item_id: willClose ? "" : parentItem.id,
      unit: "adet",
      status: "Bekliyor",
    });
  }

  async function deleteProjectItem(itemId) {
    const approved = window.confirm("Bu tahmini malzeme satırı silinsin mi?");
    if (!approved) return;

    const user = await getUserOrRedirect();
    if (!user) return;
    const deletingItems = items.filter((item) => item.id === itemId || item.parent_item_id === itemId);

    const { error } = await supabase
      .from("project_items")
      .delete()
      .eq("id", itemId)
      .eq("project_id", projectId);

    if (error) {
      setMessage("Malzeme satırı silinemedi.");
      return;
    }

    const removedIds = new Set([itemId, ...items.filter((item) => item.parent_item_id === itemId).map((item) => item.id)]);
    const nextItems = items.filter((item) => !removedIds.has(item.id));
    for (const deletingItem of deletingItems) {
      await recordMaterialRevision({
        actionType: "remove",
        beforeItem: deletingItem,
        afterItem: { ...deletingItem, estimated_quantity: 0, estimated_total: 0 },
        user,
        description: "Malzeme listeden çıkarıldı.",
      });
    }
    setSelectedProjectItemIds((prev) => prev.filter((id) => !removedIds.has(id)));
    setSelectedPurchaseItemIds((prev) => prev.filter((id) => !removedIds.has(id)));
    setItems(nextItems);
    await refreshProjectBudget(nextItems);
    const freshItems = await loadProjectItems();
    await refreshProjectBudget(freshItems);
    await loadProject();
  }

  function expandProjectItemSelection(selectedIds) {
    const deleteIds = new Set(selectedIds);
    items.forEach((item) => {
      if (item.parent_item_id && deleteIds.has(item.parent_item_id)) {
        deleteIds.add(item.id);
      }
    });
    return Array.from(deleteIds);
  }

  function toggleProjectItemSelection(itemId) {
    setSelectedProjectItemIds(() => {
      if (prev.includes(itemId)) {
        return prev.filter((id) => id !== itemId);
      }
      return [...prev, itemId];
    });
  }

  function toggleAllProjectItemsSelection() {
    setSelectedProjectItemIds(() => {
      if (allProjectItemsSelected) {
        return [];
      }
      return items.map((item) => item.id);
    });
  }

  async function deleteSelectedProjectItems() {
    const knownItemIds = new Set(items.map((item) => item.id).filter(Boolean));
    const selectedIds = Array.from(new Set(selectedProjectItemIds)).filter((id) => knownItemIds.has(id));
    if (selectedIds.length === 0) return;

    const approved = window.confirm("Seçili ürünleri silmek istediğine emin misin?");
    if (!approved) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token || !API_URL) {
      setMessage("Toplu silme i\u00e7in API ba\u011flant\u0131s\u0131 veya oturum bulunamad\u0131.");
      return;
    }

    const user = await getUserOrRedirect();
    if (!user) return;

    try {
      console.log("Toplu silme secilen id sayisi:", selectedIds.length);
      const response = await fetch(`${API_URL}/project-items/bulk-delete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: projectId,
          selected_ids: selectedIds,
          batch_size: 50,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        console.error("Toplu silme backend hatası:", data);
        setMessage(data.detail || data.message || "Seçili ürünler silinemedi.");
        return;
      }

      const deletedIds = data.deleted_ids || [];
      console.log("Toplu silme alt urun sayisi:", data.child_count || 0);
      console.log("Toplu silme batch sonuclari:", data.batch_logs || []);
      console.log("Toplu silme kalan kayit sayisi:", data.remaining_count || 0);
      const optimisticDeletedIds = data.remaining_count > 0
        ? deletedIds
        : Array.from(new Set([...deletedIds, ...selectedProjectItemDeleteIds, ...selectedIds]));
      const nextItems = items.filter((item) => !optimisticDeletedIds.includes(item.id));
      const deletedItems = items.filter((item) => optimisticDeletedIds.includes(item.id));
      for (const deletedItem of deletedItems) {
        await recordMaterialRevision({
          actionType: "remove",
          beforeItem: deletedItem,
          afterItem: { ...deletedItem, estimated_quantity: 0, estimated_total: 0 },
          user,
          description: "Malzeme toplu silme ile çıkarıldı.",
        });
      }
      setSelectedProjectItemIds([]);
      setSelectedPurchaseItemIds((prev) => prev.filter((id) => !optimisticDeletedIds.includes(id)));
      setItems(nextItems);
      await refreshProjectBudget(nextItems);
      const freshItems = await loadProjectItems();
      await refreshProjectBudget(freshItems);
      await loadProject();
      if (data.remaining_count > 0) {
        setMessage(`${data.remaining_count} kayıt silinemedi. ${data.deleted_count || deletedIds.length} kayıt silindi.`);
      } else {
        setMessage(`${data.deleted_count || deletedIds.length} ürün silindi.`);
      }
    } catch (error) {
      console.error("Toplu silme ba\u011flant\u0131 hatas\u0131:", error);
      setMessage(error.message || "Seçili ürünler silinemedi.");
    }
  }

  async function savePayment(event) {
    event.preventDefault();
    setMessage("");

    const user = await getUserOrRedirect();
    if (!user) return;

    const amount = Number(paymentForm.amount || 0);
    if (amount <= 0) {
      setMessage("Ödeme tutarı sıfırdan büyük olmalı.");
      return;
    }

    const payload = {
      payment_date: paymentForm.payment_date || new Date().toISOString().slice(0, 10),
      amount,
      original_amount: amount,
      currency: paymentForm.currency || project.contract_currency || getBaseCurrency(companySettings),
      exchange_rate: Number(paymentForm.exchange_rate || getExchangeRate(paymentForm.currency, companySettings)),
      exchange_rate_date: paymentForm.payment_date || new Date().toISOString().slice(0, 10),
      base_currency: getBaseCurrency(companySettings),
      base_amount: calculateBaseAmount(amount, paymentForm.currency, companySettings, paymentForm.exchange_rate),
      payment_type: paymentForm.payment_type,
      description: paymentForm.description.trim(),
    };

    const request = editingPaymentId
      ? supabase
          .from("project_payments")
          .update(payload)
          .eq("id", editingPaymentId)
          .eq("project_id", projectId)
          .eq("user_id", user.id)
          .select("*")
          .single()
      : supabase
          .from("project_payments")
          .insert({
            ...payload,
            user_id: user.id,
            project_id: projectId,
          })
          .select("*")
          .single();

    const { data, error } = await request;

    if (error) {
      setMessage("Ödeme kaydedilemedi.");
      return;
    }

    setPayments((prev) =>
      editingPaymentId
        ? prev.map((payment) => (payment.id === data.id ? data : payment))
        : [data, ...prev],
    );
    setPaymentForm(emptyPayment);
    setEditingPaymentId(null);
    setMessage(editingPaymentId ? "\u00d6deme kayd\u0131 g\u00fcncellendi." : "\u00d6deme kayd\u0131 eklendi.");
  }

  function editPayment(payment) {
    setEditingPaymentId(payment.id);
    setPaymentForm({
      payment_date: payment.payment_date || new Date().toISOString().slice(0, 10),
      amount: payment.amount ?? "",
      currency: payment.currency || project.contract_currency || getBaseCurrency(companySettings),
      exchange_rate: payment.exchange_rate || getExchangeRate(payment.currency, companySettings),
      payment_type: payment.payment_type || "Avans",
      description: payment.description || "",
    });
    setMessage("\u00d6deme kayd\u0131 d\u00fczenleniyor. De\u011fi\u015fiklikleri formdan kaydedebilirsiniz.");
  }

  function cancelPaymentEdit() {
    setEditingPaymentId(null);
    setPaymentForm(emptyPayment);
    setMessage("");
  }

  async function deletePayment(payment) {
    const approved = window.confirm("Bu \u00f6deme kayd\u0131n\u0131 silmek istedi\u011finize emin misiniz?");
    if (!approved) return;

    setMessage("");
    const user = await getUserOrRedirect();
    if (!user) return;

    const { error } = await supabase
      .from("project_payments")
      .delete()
      .eq("id", payment.id)
      .eq("project_id", projectId)
      .eq("user_id", user.id);

    if (error) {
      setMessage("?deme kayd? silinemedi.");
      return;
    }

    setPayments((prev) => prev.filter((item) => item.id !== payment.id));
    if (editingPaymentId === payment.id) {
      setEditingPaymentId(null);
      setPaymentForm(emptyPayment);
    }
    setMessage("?deme kayd? silindi. Finans ?zetleri yeniden hesapland?.");
  }

  async function addExpense(event) {
    event.preventDefault();
    setMessage("");

    const user = await getUserOrRedirect();
    if (!user) return;

    const amount = Number(expenseForm.amount || 0);
    if (amount <= 0) {
      setMessage("Ek gider tutarı sıfırdan büyük olmalı.");
      return;
    }

    const currency = expenseForm.currency || getBaseCurrency(companySettings);
    const exchangeRate = Number(expenseForm.exchange_rate || getExchangeRate(currency, companySettings));
    const payload = {
      user_id: user.id,
      project_id: projectId,
      expense_type: expenseForm.expense_type || "Diğer",
      amount,
      currency,
      exchange_rate: exchangeRate,
      base_currency: getBaseCurrency(companySettings),
      base_amount: calculateBaseAmount(amount, currency, companySettings, exchangeRate),
      expense_date: expenseForm.expense_date || new Date().toISOString().slice(0, 10),
      description: String(expenseForm.description || "").trim(),
    };

    const { data, error } = await supabase
      .from("project_expenses")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("Ek gider kaydedilemedi:", error);
      setMessage(error.message || "Ek gider kaydedilemedi.");
      return;
    }

    setExpenses((prev) => [data, ...prev]);
    setExpenseForm(emptyExpense);
    setMessage("Ek gider eklendi. Proje maliyeti yeniden hesaplandı.");
  }

  async function deleteExpense(expense) {
    const approved = window.confirm("Bu ek gider kaydını silmek istediğinize emin misiniz?");
    if (!approved) return;

    setMessage("");
    const user = await getUserOrRedirect();
    if (!user) return;

    const { error } = await supabase
      .from("project_expenses")
      .delete()
      .eq("id", expense.id)
      .eq("project_id", projectId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Ek gider silinemedi:", error);
      setMessage(error.message || "Ek gider silinemedi.");
      return;
    }

    setExpenses((prev) => prev.filter((item) => item.id !== expense.id));
    setMessage("Ek gider silindi. Proje maliyeti yeniden hesaplandı.");
  }

  async function updateProjectClosureStatus(status) {
    const user = await getUserOrRedirect();
    if (!user) return;

    const { error } = await supabase
      .from("projects")
      .update({
        status,
        closure_status: status,
        closed_at: status === "Kapandı" ? new Date().toISOString() : null,
        delivered_at: status === "Teslim Edildi" ? new Date().toISOString() : project?.delivered_at || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Proje durumu güncellenemedi:", error);
      setMessage(error.message || "Proje kapanış durumu güncellenemedi.");
      return;
    }

    setProject((prev) => ({
      ...prev,
      status,
      closure_status: status,
      closed_at: status === "Kapandı" ? new Date().toISOString() : null,
      delivered_at: status === "Teslim Edildi" ? new Date().toISOString() : prev?.delivered_at || null,
    }));
    setMessage("Proje kapanış durumu güncellendi.");
  }

  function rawToProjectRow(row, fallbackStatus = "Bekliyor") {
    return {
      product_code: String(row.product_code || "").trim().toUpperCase(),
      product_name: String(row.product_name || "").trim(),
      unit: row.unit || "adet",
      estimated_quantity: Number(row.estimated_quantity || 0) || 0,
      estimated_unit_price: Number(row.estimated_unit_price || 0),
      quote_unit_price: Number(row.quote_unit_price || row.estimated_unit_price || 0),
      estimated_total: Number(row.estimated_total || 0),
      quote_total: rowQuoteTotal(row),
      status: row.status || fallbackStatus,
      note: row.note || row.source_file || row.candidate_reason || "",
      source_file: row.source_file || "",
    };
  }

  function toggleMainRawItem(rowId) {
    setSelectedMainRawIds((prev) =>
      prev.includes(rowId)
        ? prev.filter((id) => id !== rowId)
        : [...prev, rowId],
    );
  }

  function buildHierarchyFromRaw() {
    const selectedIds = new Set(selectedMainRawIds);
    const mainRows = rawItems.filter((row) => selectedIds.has(row.id));

    if (mainRows.length === 0) {
      setMessage("Ana ürün oluşturmak için en az bir satır seçin.");
      return;
    }

    const groups = mainRows.map((row) => ({
      id: row.id,
      main: rawToProjectRow(row),
      source_index: Number(row.source_index ?? 0),
      source_file: row.source_file || "",
      section_name: row.section_name || "",
      subItems: [],
    }));

    rawItems.forEach((row) => {
      if (selectedIds.has(row.id)) return;

      const rowIndex = Number(row.source_index ?? 0);
      const scoredGroups = groups.map((group, index) => {
        const distance = Math.abs(rowIndex - Number(group.source_index ?? 0));
        let score = 0;

        if (row.source_file && group.source_file && row.source_file === group.source_file) score += 4;
        if (row.section_name && group.section_name && row.section_name === group.section_name) score += 3;
        if (Number(group.source_index ?? 0) < rowIndex) score += 2;
        if (distance <= 5) score += 2;
        if (distance <= 12) score += 1;

        return { index, score, distance };
      });

      scoredGroups.sort((left, right) => right.score - left.score || left.distance - right.distance);
      const targetIndex = scoredGroups[0]?.index ?? 0;

      groups[targetIndex].subItems.push({
        id: row.id,
        ...rawToProjectRow(row),
      });
    });

    setHierarchyGroups(groups);
    setMessage("Ana ürünler oluşturuldu. Alt ürünleri kontrol edip projeye aktarabilirsiniz.");
  }

  function removeMainGroup(groupId) {
    setHierarchyGroups((prev) => {
      const removedGroup = prev.find((group) => group.id === groupId);
      const remaining = prev.filter((group) => group.id !== groupId);

      if (!removedGroup || remaining.length === 0) return remaining;

      return remaining.map((group, index) =>
        index === 0
          ? { ...group, subItems: [...group.subItems, ...removedGroup.subItems] }
          : group,
      );
    });
  }

  function moveSubItem(subItemId, targetGroupId) {
    setHierarchyGroups((prev) => {
      let movingItem = null;
      const withoutItem = prev.map((group) => ({
        ...group,
        subItems: group.subItems.filter((item) => {
          if (item.id === subItemId) {
            movingItem = item;
            return false;
          }
          return true;
        }),
      }));

      if (!movingItem) return prev;

      return withoutItem.map((group) =>
        group.id === targetGroupId
          ? { ...group, subItems: [...group.subItems, movingItem] }
          : group,
      );
    });
  }

  function removeSubItem(subItemId) {
    setHierarchyGroups((prev) =>
      prev.map((group) => ({
        ...group,
        subItems: group.subItems.filter((item) => item.id !== subItemId),
      })),
    );
  }

  function promoteSubItem(subItemId) {
    setHierarchyGroups((prev) => {
      let promoted = null;
      const groups = prev.map((group) => ({
        ...group,
        subItems: group.subItems.filter((item) => {
          if (item.id === subItemId) {
            promoted = item;
            return false;
          }
          return true;
        }),
      }));

      if (!promoted) return prev;

      return [
        ...groups,
        {
          id: `main-${promoted.id}`,
          main: { ...promoted, status: "Bekliyor" },
          subItems: [],
        },
      ];
    });
  }

  async function importHierarchyGroups() {
    if (hierarchyGroups.length === 0) {
      setMessage("Aktarılacak ana ürün hiyerarşisi yok.");
      return;
    }

    const user = await getUserOrRedirect();
    if (!user) return;

    const invalidMainQuantity = hierarchyGroups
      .filter((group) => Number(group.main.estimated_quantity || 0) <= 0)
      .map((group) => group.section_name || group.main.product_name);

    if (invalidMainQuantity.length > 0) {
      setMessage(`${invalidMainQuantity.slice(0, 4).join(", ")} ana kalem miktarı kontrol gerekli.`);
      return;
    }

    const parentPayload = hierarchyGroups.map((group) => {
      const quoteTotal = sectionQuoteTotalFor(group.section_name || group.main.product_name, Number(group.main.quote_total || group.main.estimated_total || 0));
      return {
      user_id: user.id,
      project_id: projectId,
      parent_item_id: null,
      product_code: group.main.product_code,
      product_name: group.main.product_name,
      unit: group.main.unit || "adet",
      estimated_quantity: Number(group.main.estimated_quantity || 0) || 0,
      estimated_unit_price: quoteTotal,
      quote_unit_price: quoteTotal,
      estimated_total: quoteTotal,
      quote_total: quoteTotal,
      status: group.main.status || "Bekliyor",
      note: group.main.note || "Ana ürün",
      item_type: "main",
      updated_at: new Date().toISOString(),
      };
    });

    const { data: insertedParents, error: parentError } = await insertProjectItemsWithFallback(parentPayload);

    if (parentError) {
      setMessage("Ana ürünler projeye aktarılamadı.");
      return;
    }

    const childPayload = [];
    hierarchyGroups.forEach((group, index) => {
      const parent = insertedParents?.[index];
      if (!parent) return;

      group.subItems.forEach((item) => {
        if (!item.product_name) return;
        const childQuantity = Number(item.estimated_quantity || 0);
        childPayload.push({
          user_id: user.id,
          project_id: projectId,
          parent_item_id: parent.id,
          product_code: item.product_code,
          product_name: item.product_name,
          unit: item.unit || "adet",
          estimated_quantity: childQuantity,
          estimated_unit_price: Number(item.estimated_unit_price || 0),
          estimated_total: Number(item.estimated_total || 0),
          status: item.status || "Bekliyor",
          note: item.note || item.source_file || "",
          brand: item.brand || "",
          item_type: "sub",
          ...hierarchyQuantityFields(parent, childQuantity),
          updated_at: new Date().toISOString(),
        });
      });
    });

    let insertedChildren = [];
    if (childPayload.length > 0) {
      const { data, error } = await insertProjectItemsWithFallback(childPayload);

      if (error) {
        setMessage("Ana ürünler aktarıldı ama alt ürünler aktarılamadı.");
        await loadProject();
        return;
      }
      insertedChildren = data || [];
    }

    const nextItems = await ensureProductCardsForProjectItems([...items, ...(insertedParents || []), ...insertedChildren], user.id);
    setItems(nextItems);
    setRawItems([]);
    setSelectedMainRawIds([]);
    setHierarchyGroups([]);
    setPreviewRows([]);
    setPreviewParentId("");
    await refreshProjectBudget(nextItems);
    await loadProject();
    setMessage("Ana ürün ve alt ürün hiyerarşisi proje malzeme listesine aktarıldı.");
  }

  function preparePreviewRows(rows) {
    return (rows || []).map((row, index) => ({
      ...row,
      preview_id: row.preview_id || `preview-${index + 1}`,
    }));
  }

  function previewRowCategory(row) {
    return row.section_name || row.category || row.parent_name || UNCATEGORIZED_PREVIEW_CATEGORY;
  }

  function isUncategorizedPreviewCategory(category) {
    return normalizeText(category) === normalizeText(UNCATEGORIZED_PREVIEW_CATEGORY);
  }

  function previewRowMatchesSearch(row) {
    const search = previewSearch.trim().toLowerCase();
    if (!search) return true;

    return [
      row.product_name,
      row.product_code,
      row.brand,
      row.unit,
      row.note,
      previewRowCategory(row),
    ].some((value) => String(value || "").toLowerCase().includes(search));
  }

  function togglePreviewRow(rowId) {
    setSelectedPreviewRowIds((prev) =>
      prev.includes(rowId)
        ? prev.filter((id) => id !== rowId)
        : [...prev, rowId],
    );
  }

  function updatePreviewRow(rowId, field, value) {
    setPreviewRows((prev) =>
      prev.map((row) => {
        if (row.preview_id !== rowId) return row;

        const nextRow = { ...row, [field]: value };
        if (field === "estimated_quantity" || field === "estimated_unit_price") {
          const quantity = Number(field === "estimated_quantity" ? value : nextRow.estimated_quantity || 0);
          const unitPrice = Number(field === "estimated_unit_price" ? value : nextRow.estimated_unit_price || 0);
          nextRow.estimated_total = quantity * unitPrice;
        }
        return nextRow;
      }),
    );
  }

  function deletePreviewRow(rowId) {
    setPreviewRows((prev) => prev.filter((row) => row.preview_id !== rowId));
    setSelectedPreviewRowIds((prev) => prev.filter((id) => id !== rowId));
  }

  function deleteSelectedPreviewRows() {
    if (selectedPreviewRowIds.length === 0) return;
    setPreviewRows((prev) => prev.filter((row) => !selectedPreviewRowIds.includes(row.preview_id)));
    setSelectedPreviewRowIds([]);
  }

  function toggleAllFilteredPreviewRows() {
    const filteredIds = filteredPreviewRows.map((row) => row.preview_id);
    setSelectedPreviewRowIds((prev) => {
      const allSelected = filteredIds.length > 0 && filteredIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !filteredIds.includes(id));
      }
      return Array.from(new Set([...prev, ...filteredIds]));
    });
  }

  function previewRowPayload(row, userId, parentId = null, parentRow = null, options = {}) {
    const resolvedParentId = options.forceStandalone ? null : (parentId || previewParentId || null);
    const parent = parentRow || items.find((item) => item.id === resolvedParentId) || null;
    const quantity = Number(row.estimated_quantity || 0);

    return {
      user_id: userId,
      project_id: projectId,
      parent_item_id: resolvedParentId,
      product_code: String(row.product_code || "").trim().toUpperCase(),
      brand: row.brand || "",
      product_name: String(row.product_name || "").trim(),
      unit: row.unit || "adet",
      estimated_quantity: quantity,
      estimated_unit_price: Number(row.estimated_unit_price || 0),
      estimated_total: Number(row.estimated_total || 0),
      status: row.status || "Bekliyor",
      note: row.note || row.source_file || previewRowCategory(row),
      source_file: row.source_file || "",
      source_type: row.source_type || "",
      item_type: options.itemType || (resolvedParentId ? "sub" : "item"),
      ...(resolvedParentId ? hierarchyQuantityFields(parent, quantity) : {}),
      updated_at: new Date().toISOString(),
    };
  }

  function removePreviewRowsByIds(importedIds) {
    setPreviewRows((prev) => prev.filter((row) => !importedIds.has(row.preview_id)));
    setSelectedPreviewRowIds((prev) => prev.filter((id) => !importedIds.has(id)));
  }

  async function parseProjectItemFiles(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setIsParsing(true);
    setMessage(`${files.length} dosya okunuyor. Büyük tekliflerde bu işlem birkaç dakika sürebilir.`);
    setPreviewActionMessage("");
    setPreviewWarnings([]);
    setPreviewBlocked(false);
    setPreviewSections([]);
    setRawItems([]);
    setMainProductCandidates([]);
    setSelectedCandidateIds([]);
    setSuggestedHierarchyGroups([]);
    setSelectedMainRawIds([]);
    setHierarchyGroups([]);
    setSelectedPreviewRowIds([]);
    setPreviewSearch("");
    setPreviewCategoryFilter("");
    setEditingPreviewRowId("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const token = session?.access_token;

      if (!token || !API_URL) {
        setMessage("Dosya okuma için oturum veya API adresi bulunamadı.");
        setIsParsing(false);
        return;
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
      const warnings = data.warnings || [];

      if (!response.ok || !data.success) {
        setPreviewWarnings(warnings.length > 0 ? warnings : [data.detail || "Dosyadan ürün okunamadı."]);
        setPreviewBlocked(true);
        setPreviewSections(data.sections || []);
        rememberSectionTotals(data.sections || []);
        const nextRawItems = data.raw_items || data.rawItems || [];
        setRawItems(nextRawItems);
        setMessage("Dosya kontrol edildi ama güvenli aktarım için kilitlendi.");
        const nextPreviewRows = preparePreviewRows(data.rows || []);
        setPreviewRows(nextPreviewRows);
        setSelectedPreviewRowIds(nextPreviewRows.map((row) => row.preview_id));
        scrollToPreviewResults();
      } else {
        const nextPreviewRows = preparePreviewRows(data.rows || []);
        setPreviewRows(nextPreviewRows);
        setSelectedPreviewRowIds(nextPreviewRows.map((row) => row.preview_id));
        setPreviewWarnings(warnings);
        setPreviewBlocked(false);
        setPreviewSections(data.sections || []);
        rememberSectionTotals(data.sections || []);
        const nextRawItems = data.raw_items || data.rawItems || [];
        setRawItems(nextRawItems);
        setMessage(`${data.totalRows} satır okundu. Aktarmadan önce önizlemeyi kontrol edin.`);
        scrollToPreviewResults();
      }
    } catch (error) {
      console.error(error);
      setMessage("Dosya okunurken hata oluştu.");
    } finally {
      setIsParsing(false);
      event.target.value = "";
    }
  }

  async function importPreviewRows() {
    if (isImportingPreview) return;

    setIsImportingPreview(true);
    setPreviewActionMessage("Seçili ürünler projeye aktarılıyor...");

    try {
      setMessage("Ürünler projeye aktarılıyor...");
      const rowsToImport = selectedPreviewRows.length > 0 ? selectedPreviewRows : previewRows;
      if (rowsToImport.length === 0) {
        const emptyMessage = "Aktarılacak ürün bulunamadı.";
        setMessage(emptyMessage);
        setPreviewActionMessage(emptyMessage);
        return;
      }

      const user = await getUserOrRedirect();
      if (!user) {
        const authMessage = "Oturum bulunamadı. Lütfen tekrar giriş yapın.";
        setMessage(authMessage);
        setPreviewActionMessage(authMessage);
        return;
      }

      const existingMaterialKeys = new Set(
        items
          .filter((item) => item.product_name && !isMainProjectItem(item))
          .map((item) => materialIdentityKey(item.product_code, item.product_name, projectItemCategory(item))),
      );
      const duplicateRows = rowsToImport.filter((row) =>
        existingMaterialKeys.has(materialIdentityKey(row.product_code, row.product_name, previewRowCategory(row)))
      );

      if (duplicateRows.length > 0) {
        const duplicateMessage = `${duplicateRows.slice(0, 3).map((row) => row.product_name).join(", ")} zaten projede var. Tekrar aktarımı engellendi.`;
        setMessage(duplicateMessage);
        setPreviewActionMessage(duplicateMessage);
        return;
      }

      const payload = rowsToImport.map((row) => previewRowPayload(row, user.id));

      const { data, error, usedFallback } = await insertProjectItemsWithFallback(payload);

      if (error) {
        const errorMessage = error.message || "Önizleme satırları projeye aktarılamadı.";
        setMessage(errorMessage);
        setPreviewActionMessage(errorMessage);
        return;
      }

      const nextItems = [...items, ...(data || [])];
      setItems(nextItems);
      const importedIds = new Set(rowsToImport.map((row) => row.preview_id));
      setPreviewRows((prev) => prev.filter((row) => !importedIds.has(row.preview_id)));
      setSelectedPreviewRowIds([]);
      setRawItems([]);
      setSelectedMainRawIds([]);
      setHierarchyGroups([]);
      setPreviewParentId("");
      await refreshProjectAfterMaterialChange(nextItems, user);
      const successMessage = usedFallback
        ? "Ürünler projeye aktarıldı. Eski veritabanı kolonları için uyumlu kayıt kullanıldı."
        : "Dosyadan okunan ürünler projeye aktarıldı.";
      setMessage(successMessage);
      setPreviewActionMessage(successMessage);
    } catch (error) {
      console.error(error);
      const errorMessage = error.message || "Ürünler projeye aktarılırken beklenmeyen hata oluştu.";
      setMessage(errorMessage);
      setPreviewActionMessage(errorMessage);
    } finally {
      setIsImportingPreview(false);
    }
  }

  async function importSelectedPreviewRowsStandalone() {
    if (isImportingPreview) return;

    const rowsToImport = selectedPreviewRows;
    if (rowsToImport.length === 0) {
      const emptyMessage = "Bağımsız aktarım için en az bir satır seçin.";
      setMessage(emptyMessage);
      setPreviewActionMessage(emptyMessage);
      return;
    }

    setIsImportingPreview(true);
    setPreviewActionMessage("Seçili satırlar bağımsız kalem olarak aktarılıyor...");

    try {
      const user = await getUserOrRedirect();
      if (!user) {
        const authMessage = "Oturum bulunamadı. Lütfen tekrar giriş yapın.";
        setMessage(authMessage);
        setPreviewActionMessage(authMessage);
        return;
      }

      const payload = rowsToImport.map((row) =>
        previewRowPayload(row, user.id, null, null, { forceStandalone: true, itemType: "standalone" })
      );
      const { data, error, usedFallback } = await insertProjectItemsWithFallback(payload);

      if (error) {
        const errorMessage = error.message || "Bağımsız kalemler projeye aktarılamadı.";
        setMessage(errorMessage);
        setPreviewActionMessage(errorMessage);
        return;
      }

      const importedIds = new Set(rowsToImport.map((row) => row.preview_id));
      const nextItems = [...items, ...(data || [])];
      setItems(nextItems);
      removePreviewRowsByIds(importedIds);
      await refreshProjectAfterMaterialChange(nextItems, user);

      const successMessage = usedFallback
        ? `${rowsToImport.length} kalem bağımsız aktarıldı. Eski veritabanı kolonları için uyumlu kayıt kullanıldı.`
        : `${rowsToImport.length} kalem bağımsız proje malzemesi olarak aktarıldı.`;
      setMessage(successMessage);
      setPreviewActionMessage(successMessage);
    } catch (error) {
      console.error(error);
      const errorMessage = error.message || "Bağımsız aktarım sırasında beklenmeyen hata oluştu.";
      setMessage(errorMessage);
      setPreviewActionMessage(errorMessage);
    } finally {
      setIsImportingPreview(false);
    }
  }

  async function attachSelectedPreviewRowsToParent() {
    if (isImportingPreview) return;

    const rowsToImport = selectedPreviewRows;
    const parent = items.find((item) => item.id === previewParentId);
    const parentQuantity = Number(parent?.estimated_quantity || 0);

    if (rowsToImport.length === 0) {
      const emptyMessage = "Ana kaleme bağlamak için en az bir satır seçin.";
      setMessage(emptyMessage);
      setPreviewActionMessage(emptyMessage);
      return;
    }

    if (!parent) {
      const parentMessage = "Bağlanacak ana kalemi seçin.";
      setMessage(parentMessage);
      setPreviewActionMessage(parentMessage);
      return;
    }

    if (parentQuantity <= 0) {
      const quantityMessage = `${parent.product_name} ana kalem miktarı kontrol gerekli. Alt kalem oranı hesaplanamadı.`;
      setMessage(quantityMessage);
      setPreviewActionMessage(quantityMessage);
      setPreviewWarnings((prev) => Array.from(new Set([...prev, quantityMessage])));
      return;
    }

    setIsImportingPreview(true);
    setPreviewActionMessage("Seçili satırlar ana kaleme bağlanıyor...");

    try {
      const user = await getUserOrRedirect();
      if (!user) {
        const authMessage = "Oturum bulunamadı. Lütfen tekrar giriş yapın.";
        setMessage(authMessage);
        setPreviewActionMessage(authMessage);
        return;
      }

      const payload = rowsToImport.map((row) => previewRowPayload(row, user.id, parent.id, parent));
      const { data, error, usedFallback } = await insertProjectItemsWithFallback(payload);

      if (error) {
        const errorMessage = error.message || "Seçili kalemler ana kaleme bağlanamadı.";
        setMessage(errorMessage);
        setPreviewActionMessage(errorMessage);
        return;
      }

      const importedIds = new Set(rowsToImport.map((row) => row.preview_id));
      const nextItems = [...items, ...(data || [])];
      setItems(nextItems);
      removePreviewRowsByIds(importedIds);
      await refreshProjectAfterMaterialChange(nextItems, user);

      const successMessage = usedFallback
        ? `${rowsToImport.length} kalem ${parent.product_name} ana kalemine bağlandı. Eski veritabanı kolonları için uyumlu kayıt kullanıldı.`
        : `${rowsToImport.length} kalem ${parent.product_name} ana kalemine bağlandı.`;
      setMessage(successMessage);
      setPreviewActionMessage(successMessage);
    } catch (error) {
      console.error(error);
      const errorMessage = error.message || "Ana kaleme bağlama sırasında beklenmeyen hata oluştu.";
      setMessage(errorMessage);
      setPreviewActionMessage(errorMessage);
    } finally {
      setIsImportingPreview(false);
    }
  }

  async function importSelectedPreviewRowsAsMainItems() {
    if (isImportingPreview) return;

    const rowsToImport = selectedPreviewRows.length > 0 ? selectedPreviewRows : previewRows;
    if (rowsToImport.length === 0) {
      const emptyMessage = "Bağımsız ana kalem olarak aktarılacak satır bulunamadı.";
      setMessage(emptyMessage);
      setPreviewActionMessage(emptyMessage);
      return;
    }

    setIsImportingPreview(true);
    setPreviewActionMessage("Seçili satırlar bağımsız ana kalem olarak aktarılıyor...");

    try {
      const user = await getUserOrRedirect();
      if (!user) {
        const authMessage = "Oturum bulunamadı. Lütfen tekrar giriş yapın.";
        setMessage(authMessage);
        setPreviewActionMessage(authMessage);
        return;
      }

      const payload = rowsToImport.map((row) => {
        const quantity = Number(row.estimated_quantity || 0);
        const total = Number(row.estimated_total || 0);
        const unitPrice = Number(row.estimated_unit_price || 0) || (quantity > 0 && total > 0 ? total / quantity : 0);
        return {
          ...previewRowPayload(row, user.id, null, null, { forceStandalone: true, itemType: "main" }),
          estimated_unit_price: unitPrice,
          quote_unit_price: unitPrice,
          estimated_total: total || quantity * unitPrice,
          quote_total: total || quantity * unitPrice,
          status: "Bekliyor",
          note: row.note || "Düz ana ürün listesinden bağımsız ana kalem olarak aktarıldı",
        };
      });

      const { data, error, usedFallback } = await insertProjectItemsWithFallback(payload);

      if (error) {
        const errorMessage = error.message || "Bağımsız ana kalemler projeye aktarılamadı.";
        setMessage(errorMessage);
        setPreviewActionMessage(errorMessage);
        return;
      }

      const importedIds = new Set(rowsToImport.map((row) => row.preview_id));
      const nextItems = [...items, ...(data || [])];
      setItems(nextItems);
      removePreviewRowsByIds(importedIds);
      await refreshProjectAfterMaterialChange(nextItems, user);

      const successMessage = usedFallback
        ? `${rowsToImport.length} satır bağımsız ana kalem olarak aktarıldı. Eski veritabanı kolonları için uyumlu kayıt kullanıldı.`
        : `${rowsToImport.length} satır bağımsız ana kalem olarak aktarıldı.`;
      setMessage(successMessage);
      setPreviewActionMessage(successMessage);
    } catch (error) {
      console.error(error);
      const errorMessage = error.message || "Bağımsız ana kalem aktarımı sırasında beklenmeyen hata oluştu.";
      setMessage(errorMessage);
      setPreviewActionMessage(errorMessage);
    } finally {
      setIsImportingPreview(false);
    }
  }

  function openCreateParentFromSelectionModal() {
    if (isImportingPreview) return;

    if (selectedPreviewRows.length < 2) {
      const emptyMessage = "Yeni ana kalem oluşturmak için en az iki satır seçin. Bir satır ana kalem, diğerleri alt kalem olur.";
      setMessage(emptyMessage);
      setPreviewActionMessage(emptyMessage);
      return;
    }

    const firstRow = selectedPreviewRows[0];
    setCreateParentSourceRowId(firstRow.preview_id);
    setCreateParentNameDraft(firstRow.product_name || previewRowCategory(firstRow) || "Yeni ana kalem");
    setCreateParentQuantityDraft(String(firstRow.section_quantity || firstRow.estimated_quantity || ""));
    setCreateParentModalOpen(true);
    setPreviewActionMessage("Ana kalem olacak satırı seçin. Diğer seçili satırlar bu ana kalemin alt kalemi yapılacak.");
  }

  function closeCreateParentModal() {
    setCreateParentModalOpen(false);
    setCreateParentSourceRowId("");
    setCreateParentNameDraft("");
    setCreateParentQuantityDraft("");
  }

  async function confirmCreateParentFromSelectedPreviewRows() {
    if (isImportingPreview) return;

    const rowsToImport = selectedPreviewRows;
    const parentSourceRow = rowsToImport.find((row) => row.preview_id === createParentSourceRowId);
    const childRows = rowsToImport.filter((row) => row.preview_id !== createParentSourceRowId);

    if (!parentSourceRow) {
      const parentMessage = "Ana kalem olacak satırı seçin.";
      setMessage(parentMessage);
      setPreviewActionMessage(parentMessage);
      return;
    }

    if (childRows.length === 0) {
      const childMessage = "Ana kaleme bağlanacak en az bir alt kalem kalmalı.";
      setMessage(childMessage);
      setPreviewActionMessage(childMessage);
      return;
    }

    const parentName = createParentNameDraft.trim() || parentSourceRow.product_name || "Yeni ana kalem";
    const parentQuantity = Number(String(createParentQuantityDraft || "").replace(",", "."));
    if (!Number.isFinite(parentQuantity) || parentQuantity <= 0) {
      const quantityMessage = "Yeni ana kalem için geçerli bir miktar girin.";
      setMessage(quantityMessage);
      setPreviewActionMessage(quantityMessage);
      return;
    }

    setIsImportingPreview(true);
    setPreviewActionMessage("Yeni ana kalem oluşturuluyor ve seçili alt kalemler bağlanıyor...");

    try {
      const user = await getUserOrRedirect();
      if (!user) {
        const authMessage = "Oturum bulunamadı. Lütfen tekrar giriş yapın.";
        setMessage(authMessage);
        setPreviewActionMessage(authMessage);
        return;
      }

      const quoteTotal = Number(parentSourceRow.estimated_total || 0) || childRows.reduce((sum, row) => sum + Number(row.estimated_total || 0), 0);
      const parentPayload = [{
        user_id: user.id,
        project_id: projectId,
        parent_item_id: null,
        product_code: String(parentSourceRow.product_code || "").trim().toUpperCase(),
        brand: parentSourceRow.brand || "",
        product_name: parentName,
        unit: parentSourceRow.unit || "adet",
        estimated_quantity: parentQuantity,
        estimated_unit_price: quoteTotal,
        quote_unit_price: quoteTotal,
        estimated_total: quoteTotal,
        quote_total: quoteTotal,
        status: "Bekliyor",
        note: "Önizlemeden manuel ana kalem oluşturuldu",
        source_file: parentSourceRow.source_file || "",
        source_type: parentSourceRow.source_type || "",
        item_type: "main",
        updated_at: new Date().toISOString(),
      }];

      const { data: insertedParents, error: parentError, usedFallback: parentUsedFallback } = await insertProjectItemsWithFallback(parentPayload);
      if (parentError || !insertedParents?.[0]) {
        const errorMessage = parentError?.message || "Yeni ana kalem oluşturulamadı.";
        setMessage(errorMessage);
        setPreviewActionMessage(errorMessage);
        return;
      }

      const parent = insertedParents[0];
      const childPayload = childRows.map((row) => previewRowPayload(row, user.id, parent.id, parent));
      const { data: insertedChildren, error: childError, usedFallback: childUsedFallback } = await insertProjectItemsWithFallback(childPayload);
      if (childError) {
        const errorMessage = childError.message || "Ana kalem oluşturuldu ama alt kalemler bağlanamadı.";
        setMessage(errorMessage);
        setPreviewActionMessage(errorMessage);
        await loadProject();
        return;
      }

      const importedIds = new Set(rowsToImport.map((row) => row.preview_id));
      const nextItems = [...items, parent, ...(insertedChildren || [])];
      setItems(nextItems);
      removePreviewRowsByIds(importedIds);
      await refreshProjectAfterMaterialChange(nextItems, user);
      closeCreateParentModal();

      const usageSummary = childRows
        .slice(0, 4)
        .map((row) => {
          const totalQuantity = Number(row.estimated_quantity || 0);
          const perParent = parentQuantity > 0 ? totalQuantity / parentQuantity : 0;
          return `${row.product_name}: ${formatQuantity(totalQuantity)} / ${formatQuantity(parentQuantity)} = ${formatQuantity(perParent)}`;
        })
        .join("; ");
      const extraUsageCount = childRows.length > 4 ? ` +${childRows.length - 4} alt kalem` : "";

      const successMessage = parentUsedFallback || childUsedFallback
        ? `Ana kalem: ${parentName}. Miktar: ${formatQuantity(parentQuantity)}. Bağlanan alt kalem: ${childRows.length}. Birim kullanım: ${usageSummary}${extraUsageCount}. Eski veritabanı kolonları için uyumlu kayıt kullanıldı.`
        : `Ana kalem: ${parentName}. Miktar: ${formatQuantity(parentQuantity)}. Bağlanan alt kalem: ${childRows.length}. Birim kullanım: ${usageSummary}${extraUsageCount}.`;
      setMessage(successMessage);
      setPreviewActionMessage(successMessage);
    } catch (error) {
      console.error(error);
      const errorMessage = error.message || "Yeni ana kalem oluşturulurken beklenmeyen hata oluştu.";
      setMessage(errorMessage);
      setPreviewActionMessage(errorMessage);
    } finally {
      setIsImportingPreview(false);
    }
  }

  async function importGroupedPreviewRows() {
    if (isImportingPreview) return;

    setIsImportingPreview(true);
    setPreviewActionMessage("Hiyerarşik aktarım hazırlanıyor. Önce ana gruplar, sonra alt malzemeler kaydedilecek.");

    try {
      setMessage("Hiyerarşik aktarım başladı. Büyük listelerde ekran kısa süre bekleyebilir.");
      const rowsToImport = selectedPreviewRows.length > 0 ? selectedPreviewRows : previewRows;
      if (rowsToImport.length === 0) {
        const emptyMessage = "Aktarılacak ürün bulunamadı.";
        setMessage(emptyMessage);
        setPreviewActionMessage(emptyMessage);
        return;
      }

      const user = await getUserOrRedirect();
      if (!user) {
        const authMessage = "Oturum bulunamadı. Lütfen tekrar giriş yapın.";
        setMessage(authMessage);
        setPreviewActionMessage(authMessage);
        return;
      }

      const rowsByCategory = rowsToImport.reduce((groups, row) => {
        const category = previewRowCategory(row);
        groups[category] = [...(groups[category] || []), row];
        return groups;
      }, {});
      const groupedEntries = Object.entries(rowsByCategory);
      const uncategorizedEntries = groupedEntries.filter(([category]) => isUncategorizedPreviewCategory(category));

      const existingGroupKeys = new Set(
        items
          .filter(isMainProjectItem)
          .map((item) => projectItemGroupKey(item.product_name, Number(item.quote_total || item.estimated_total || 0))),
      );
      const duplicateCategories = Object.entries(rowsByCategory)
        .filter(([category, rows]) => {
          if (isUncategorizedPreviewCategory(category)) return false;
          const quoteTotal = sectionQuoteTotalFor(category, rows.reduce((sum, row) => sum + Number(row.estimated_total || 0), 0));
          return existingGroupKeys.has(projectItemGroupKey(category, quoteTotal));
        })
        .map(([category]) => category);
      const duplicateCategorySet = new Set(duplicateCategories);

      const missingParentQuantity = groupedEntries
        .filter(([category, rows]) => !isUncategorizedPreviewCategory(category) && !rows.some((row) => Number(row.section_quantity || 0) > 0))
        .map(([category]) => category);
      const missingParentQuantitySet = new Set(missingParentQuantity);
      const validHierarchyEntries = groupedEntries.filter(([category]) =>
        !isUncategorizedPreviewCategory(category)
          && !duplicateCategorySet.has(category)
          && !missingParentQuantitySet.has(category)
      );
      const controlWarningParts = [];

      if (uncategorizedEntries.length > 0) {
        const uncategorizedCount = uncategorizedEntries.reduce((sum, [, rows]) => sum + rows.length, 0);
        controlWarningParts.push(`${uncategorizedCount} kategorisiz kalem kontrol bekliyor`);
      }
      if (missingParentQuantity.length > 0) {
        controlWarningParts.push(`${missingParentQuantity.slice(0, 4).join(", ")} ana kalem miktarı kontrol gerekli`);
      }
      if (duplicateCategories.length > 0) {
        controlWarningParts.push(`${duplicateCategories.slice(0, 4).join(", ")} zaten projede var`);
      }

      if (controlWarningParts.length > 0) {
        const controlMessage = controlWarningParts.join(". ");
        setPreviewWarnings((prev) => Array.from(new Set([...prev, controlMessage])));
      }

      if (validHierarchyEntries.length === 0) {
        const noValidMessage = controlWarningParts.length > 0
          ? `Hiyerarşik aktarılacak geçerli ana kalem bulunamadı. ${controlWarningParts.join(". ")}.`
          : "Hiyerarşik aktarılacak geçerli ana kalem bulunamadı.";
        setMessage(noValidMessage);
        setPreviewActionMessage(noValidMessage);
        return;
      }

      const parentPayload = validHierarchyEntries.map(([category, rows]) => {
        const quoteTotal = sectionQuoteTotalFor(category, rows.reduce((sum, row) => sum + Number(row.estimated_total || 0), 0));
        const parentQuantity = Number(rows.find((row) => Number(row.section_quantity || 0) > 0)?.section_quantity || 0) || 0;
        return {
          user_id: user.id,
          project_id: projectId,
          parent_item_id: null,
          product_code: "",
          product_name: category,
          unit: "adet",
          estimated_quantity: parentQuantity,
          estimated_unit_price: quoteTotal,
          quote_unit_price: quoteTotal,
          estimated_total: quoteTotal,
          quote_total: quoteTotal,
          status: "Bekliyor",
          note: parentQuantity > 0 ? "Dosya önizleme ana kalem grubu" : "Ana kalem miktarı kontrol gerekli",
          item_type: "main",
          updated_at: new Date().toISOString(),
        };
      });

      const { data: insertedParents, error: parentError, usedFallback: parentUsedFallback } = await insertProjectItemsWithFallback(parentPayload);
      setPreviewActionMessage(`${parentPayload.length} ana grup kaydedildi. Alt malzemeler aktarılıyor...`);

      if (parentError) {
        const errorMessage = parentError.message || "Hiyerarşik aktarım yapılamadı.";
        setMessage(errorMessage);
        setPreviewActionMessage(errorMessage);
        return;
      }

      const childPayload = [];
      validHierarchyEntries.forEach(([, rows], index) => {
        const parent = insertedParents?.[index];
        if (!parent) return;
        rows.forEach((row) => {
          childPayload.push(previewRowPayload(row, user.id, parent.id, parent));
        });
      });

      let insertedChildren = [];
      let childUsedFallback = false;
      if (childPayload.length > 0) {
        setPreviewActionMessage(`${childPayload.length} alt malzeme kaydediliyor...`);
        const { data, error, usedFallback } = await insertProjectItemsWithFallback(childPayload);

        if (error) {
          const errorMessage = error.message || "Ana ürünler aktarıldı ama alt ürünler aktarılamadı.";
          setMessage(errorMessage);
          setPreviewActionMessage(errorMessage);
          await loadProject();
          return;
        }

        insertedChildren = data || [];
        childUsedFallback = usedFallback;
      }

      const importedRows = validHierarchyEntries.flatMap(([, rows]) => rows);
      const importedIds = new Set(importedRows.map((row) => row.preview_id));
      setPreviewActionMessage("Malzeme listesi yenileniyor...");
      const nextItems = [...items, ...(insertedParents || []), ...insertedChildren];
      setItems(nextItems);
      removePreviewRowsByIds(importedIds);
      setRawItems([]);
      setSelectedMainRawIds([]);
      setHierarchyGroups([]);
      setPreviewParentId("");
      await refreshProjectAfterMaterialChange(nextItems, user);
      const controlCount = rowsToImport.length - importedRows.length;
      const controlSuffix = controlCount > 0 ? ` ${controlCount} kalem kontrol bekliyor.` : "";
      const successMessage = parentUsedFallback || childUsedFallback
        ? `${insertedParents?.length || 0} ana kalem ve ${insertedChildren.length} alt kalem hiyerarşik aktarıldı.${controlSuffix} Eski veritabanı kolonları için uyumlu kayıt kullanıldı.`
        : `${insertedParents?.length || 0} ana kalem ve ${insertedChildren.length} alt kalem hiyerarşik aktarıldı.${controlSuffix}`;
      setMessage(successMessage);
      setPreviewActionMessage(successMessage);
    } catch (error) {
      console.error(error);
      const errorMessage = error.message || "Hiyerarşik aktarım sırasında beklenmeyen hata oluştu.";
      setMessage(errorMessage);
      setPreviewActionMessage(errorMessage);
    } finally {
      setIsImportingPreview(false);
    }
  }

  function togglePurchaseItem(itemId) {
    setSelectedPurchaseItemIds((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId],
    );
  }

  async function transferSelectedItemsToStock() {
    setMessage("");

    const user = await getUserOrRedirect();
    if (!user) return;

    const selectedItems = items.filter((item) =>
      selectedPurchaseItemIds.includes(item.id) && !stockInfoForItem(item).isMainItem
    );

    if (selectedItems.length === 0) {
      setMessage("Stoğa aktarmak için en az bir alt ürün seçin.");
      return;
    }

    const approved = window.confirm(`${selectedItems.length} kalem stok kartı ve stok hareketi olarak kaydedilsin mi?`);
    if (!approved) return;

    const selectedItemIds = selectedItems.map((item) => item.id);
    const { data: existingMovements, error: existingMovementError } = await supabase
      .from("stock_movements")
      .select("id, project_item_id")
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .eq("source", "Proje teklifinden stok aktarımı")
      .in("project_item_id", selectedItemIds);

    if (existingMovementError) {
      console.error("Mevcut stok hareketleri kontrol edilemedi:", existingMovementError);
      setMessage(existingMovementError.message || "Mevcut stok hareketleri kontrol edilemedi.");
      return;
    }

    const alreadyTransferredItemIds = new Set((existingMovements || []).map((movement) => movement.project_item_id));
    const itemsToTransfer = selectedItems.filter((item) => !alreadyTransferredItemIds.has(item.id));

    if (itemsToTransfer.length === 0) {
      setMessage("Seçili kalemler daha önce stoğa aktarılmış. Stok tekrar artırılmadı.");
      return;
    }

    const ensuredItems = await ensureProductCardsForProjectItems(itemsToTransfer, user.id);
    const transferableItems = ensuredItems.filter((item) => item.product_id);

    if (transferableItems.length === 0) {
      setMessage("Stok kartı oluşturulamadığı için aktarım yapılmadı.");
      return;
    }

    const productIds = Array.from(new Set(transferableItems.map((item) => item.product_id).filter(Boolean)));
    const { data: latestProducts, error: latestProductError } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", user.id)
      .in("id", productIds);

    if (latestProductError) {
      console.error("Stok kartları okunamadı:", latestProductError);
      setMessage(latestProductError.message || "Stok kartları okunamadı.");
      return;
    }

    const productById = new Map((latestProducts || []).map((product) => [product.id, product]));
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    const movementPayload = transferableItems.map((item) => {
      const price = resolveProjectItemPrice(item);
      const quantity = Number(item.estimated_quantity || 0) || 0;
      const product = productById.get(item.product_id);

      return {
        user_id: user.id,
        product_id: item.product_id,
        project_id: projectId,
        project_item_id: item.id,
        parent_item_id: item.parent_item_id || null,
        product_code: product?.product_code || item.product_code || "",
        product_name: product?.product_name || item.product_name,
        movement_type: "in",
        quantity,
        unit: item.unit || product?.unit || "adet",
        supplier_name: item.note || item.source_file || "Proje teklifi",
        partner_name: item.note || item.source_file || "Proje teklifi",
        partner_type: "Tedarikçi",
        related_project_id: projectId,
        related_project_name: project?.project_name || "",
        unit_price: Number(price.unitPrice || 0) || 0,
        currency: item.currency || product?.last_currency || "TRY",
        movement_date: today,
        source: "Proje teklifinden stok aktarımı",
        notes: [
          project?.project_code || project?.project_name || "Proje",
          `Fiyat kaynağı: ${price.source}`,
          item.source_file ? `Kaynak dosya: ${item.source_file}` : "",
          Number(price.unitPrice || 0) > 0 ? "" : "Teklifte ve son alımda fiyat bulunamadı; fiyat 0 bırakıldı.",
        ].filter(Boolean).join(" | "),
      };
    }).filter((movement) => movement.quantity > 0);

    if (movementPayload.length === 0) {
      setMessage("Aktarılacak kalemlerde geçerli miktar bulunamadı.");
      return;
    }

    const { data: insertedMovements, error: movementError } = await supabase
      .from("stock_movements")
      .insert(movementPayload)
      .select("*");

    if (movementError) {
      console.error("Stok hareketi kaydedilemedi:", movementError);
      setMessage(movementError.message || "Stok hareketi kaydedilemedi.");
      return;
    }

    const totalsByProduct = movementPayload.reduce((groups, movement) => {
      const group = groups.get(movement.product_id) || { quantity: 0, lastPrice: 0, currency: movement.currency, supplier: movement.supplier_name };
      group.quantity += Number(movement.quantity || 0);
      if (Number(movement.unit_price || 0) > 0) {
        group.lastPrice = Number(movement.unit_price || 0);
        group.currency = movement.currency || group.currency;
        group.supplier = movement.supplier_name || group.supplier;
      }
      groups.set(movement.product_id, group);
      return groups;
    }, new Map());

    const updateWarnings = [];

    for (const [productId, total] of totalsByProduct.entries()) {
      const product = productById.get(productId) || {};
      const updatePayload = {
        current_stock: Number(product.current_stock || 0) + total.quantity,
        last_supplier: total.supplier || product.last_supplier || "",
        last_movement_at: now,
        source: "Proje teklifinden stok aktarımı",
        updated_at: now,
      };

      if (total.lastPrice > 0) {
        updatePayload.last_unit_price = total.lastPrice;
        updatePayload.last_currency = total.currency || product.last_currency || "TRY";
      }

      const { error: productUpdateError } = await supabase
        .from("products")
        .update(updatePayload)
        .eq("id", productId)
        .eq("user_id", user.id);

      if (productUpdateError) {
        console.error("Stok kartı güncellenemedi:", productUpdateError);
        updateWarnings.push(productUpdateError.message);
      }
    }

    for (const item of transferableItems) {
      const price = resolveProjectItemPrice(item);
      const quantity = Number(item.estimated_quantity || 0) || 0;

      const { error: itemUpdateError } = await supabase
        .from("project_items")
        .update({
          product_id: item.product_id,
          received_quantity: Number(item.received_quantity || 0) + quantity,
          resolved_unit_price: Number(price.unitPrice || 0) || 0,
          resolved_total: Number(price.total || 0) || 0,
          price_source: price.source,
          price_source_order_id: price.orderId || null,
          price_source_date: price.sourceDate || null,
          status: "Depoda",
          updated_at: now,
        })
        .eq("id", item.id)
        .eq("project_id", projectId)
        .eq("user_id", user.id);

      if (itemUpdateError) {
        console.error("Proje kalemi stok aktarımıyla güncellenemedi:", itemUpdateError);
        updateWarnings.push(itemUpdateError.message);
      }
    }

    setStockMovements((prev) => [...(insertedMovements || []), ...prev]);
    setSelectedPurchaseItemIds((prev) => prev.filter((id) => !movementPayload.some((movement) => movement.project_item_id === id)));
    await loadProject();

    const skippedCount = selectedItems.length - itemsToTransfer.length;
    setMessage(`${movementPayload.length} kalem stoğa aktarıldı.${skippedCount > 0 ? ` ${skippedCount} kalem daha önce aktarıldığı için atlandı.` : ""}${updateWarnings.length > 0 ? " Bazı kart güncellemeleri kontrol edilmeli." : ""}`);
  }

  async function coverItemFromStock(item) {
    setMessage("");

    const user = await getUserOrRedirect();
    if (!user) return;

    const info = stockInfoForItem(item);
    const product = info.matchedProducts?.find((candidate) => {
      const total = Number(candidate.current_stock || 0);
      const reserved = Number(candidate.reserved_stock || 0);
      return Math.max(total - reserved, 0) > 0;
    });
    const coverQuantity = Math.min(Number(item.estimated_quantity || 0), Number(info.stockQuantity || 0));

    if (!product || coverQuantity <= 0) {
      setMessage("Bu kalem için stoktan karşılanabilecek uygun ürün bulunamadı.");
      return;
    }

    const approved = window.confirm(`${item.product_name} için ${coverQuantity} ${item.unit || "adet"} stoktan projeye ayrılsın mı?`);
    if (!approved) return;

    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const reservedStock = Number(product.reserved_stock || 0) + coverQuantity;
    const itemReserved = Number(item.reserved_quantity || 0) + coverQuantity;
    const remainingAfterReserve = Math.max(Number(item.estimated_quantity || 0) - itemReserved, 0);
    const nextStatus = remainingAfterReserve <= 0 ? "Projeye rezerve edildi" : "Satınalma gerekli";

    const { error: productError } = await supabase
      .from("products")
      .update({
        reserved_stock: reservedStock,
        updated_at: now,
      })
      .eq("id", product.id)
      .eq("user_id", user.id);

    if (productError) {
      setMessage(productError.message || "Stok kartı rezerve edilemedi.");
      return;
    }

    const { error: itemError } = await supabase
      .from("project_items")
      .update({
        product_id: product.id,
        reserved_quantity: itemReserved,
        status: nextStatus,
        updated_at: now,
      })
      .eq("id", item.id)
      .eq("project_id", projectId)
      .eq("user_id", user.id);

    if (itemError) {
      setMessage(itemError.message || "Proje kalemi stoktan karşılandı olarak güncellenemedi.");
      return;
    }

    const { error: movementError } = await supabase
      .from("stock_movements")
      .insert({
        user_id: user.id,
        product_id: product.id,
        project_id: projectId,
        project_item_id: item.id,
        parent_item_id: item.parent_item_id || null,
        product_code: product.product_code || item.product_code || "",
        product_name: product.product_name || item.product_name,
        movement_type: "out",
        quantity: coverQuantity,
        reserved_quantity: coverQuantity,
        unit: item.unit || product.unit || "adet",
        related_project_id: projectId,
        related_project_name: project?.project_name || "",
        unit_price: Number(product.last_unit_price || item.estimated_unit_price || 0),
        currency: product.last_currency || projectCurrencyForDisplay(item.currency),
        movement_date: today,
        source: "Projeye stoktan karşılandı",
        notes: `${project?.project_code || project?.project_name || "Proje"} için stok rezervasyonu`,
      });

    if (movementError) {
      console.warn("Stok rezervasyonu hareketi kaydedilemedi:", movementError);
    }

    await loadProject();
    setMessage(`${item.product_name} için ${coverQuantity} ${item.unit || "adet"} stoktan karşılandı.`);
  }

  async function processParentItem(parent) {
    setMessage("");

    const user = await getUserOrRedirect();
    if (!user) return;

    const processQuantity = Number(processQuantityDrafts[parent.id] || 0);
    const parentInfo = parentProcessInfo(parent);
    const children = childItemsByParent[parent.id] || [];

    if (processQuantity <= 0) {
      setMessage("Tamamlanan ana kalem miktarı sıfırdan büyük olmalı.");
      return;
    }

    if (parentInfo.parentQuantity <= 0) {
      setMessage("Ana kalem miktarı kontrol gerekli. Toplam ana kalem miktarı okunmadan tamamlanan miktar kaydedilemez.");
      return;
    }

    if (processQuantity > parentInfo.remainingParentQuantity) {
      setMessage(`En fazla ${parentInfo.remainingParentQuantity} ${parent.unit || "adet"} tamamlanan miktar kaydedilebilir.`);
      return;
    }

    if (children.length === 0) {
      setMessage("Bu ana kaleme bağlı bileşen bulunamadı.");
      return;
    }

    setProcessingParentId(parent.id);

    const ensuredItems = await ensureProductCardsForProjectItems(children, user.id);
    const childRows = ensuredItems.filter((item) => item.parent_item_id === parent.id);
    const productIds = Array.from(new Set(childRows.map((child) => child.product_id).filter(Boolean)));

    if (productIds.length === 0) {
      setMessage("Bileşenler için stok kartı bulunamadı veya oluşturulamadı.");
      setProcessingParentId("");
      return;
    }

    const { data: latestProducts, error: latestProductError } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", user.id)
      .in("id", productIds);

    if (latestProductError) {
      setMessage(latestProductError.message || "Stok kartları okunamadı.");
      setProcessingParentId("");
      return;
    }

    const productById = new Map((latestProducts || []).map((product) => [product.id, product]));
    const consumptionRows = buildComponentConsumptionRows(childRows, productById, processQuantity, items);

    const missingRows = consumptionRows.filter((row) => !row.product || row.currentStock < row.quantityToConsume);
    if (missingRows.length > 0) {
      const names = missingRows.slice(0, 4).map((row) => row.child.product_name).join(", ");
      setMessage(`Eksik stok var. İşleme alınamadı: ${names}`);
      setProcessingParentId("");
      return;
    }

    const approved = window.confirm(`${parent.product_name} ana kaleminden ${processQuantity} ${parent.unit || "adet"} tamamlandı olarak kaydedilsin mi? Alt kalem kullanılan ve bekleyen miktarları hesaplanacak.`);
    if (!approved) {
      setProcessingParentId("");
      return;
    }

    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const movementPayload = [];
    const warnings = [];

    for (const row of consumptionRows) {
      const { child, relation, product, quantityToConsume } = row;
      const reservedToRelease = Math.min(Number(product.reserved_stock || 0), Number(child.reserved_quantity || 0), quantityToConsume);
      const nextProductStock = Math.max(Number(product.current_stock || 0) - quantityToConsume, 0);
      const nextReservedStock = Math.max(Number(product.reserved_stock || 0) - reservedToRelease, 0);
      const nextChildConsumed = Number(child.received_quantity || 0) + quantityToConsume;
      const nextChildReserved = Math.max(Number(child.reserved_quantity || 0) - reservedToRelease, 0);
      const childDone = nextChildConsumed >= Number(child.estimated_quantity || 0);

      const { error: productError } = await supabase
        .from("products")
        .update({
          current_stock: nextProductStock,
          reserved_stock: nextReservedStock,
          last_movement_at: now,
          updated_at: now,
        })
        .eq("id", product.id)
        .eq("user_id", user.id);

      if (productError) {
        warnings.push(productError.message);
        continue;
      }

      const { error: childError } = await supabase
        .from("project_items")
        .update({
          product_id: product.id,
          received_quantity: nextChildConsumed,
          reserved_quantity: nextChildReserved,
          status: childDone ? "Tamamlandı" : "İşlemde",
          updated_at: now,
        })
        .eq("id", child.id)
        .eq("project_id", projectId)
        .eq("user_id", user.id);

      if (childError) {
        warnings.push(childError.message);
      }

      movementPayload.push({
        user_id: user.id,
        product_id: product.id,
        project_id: projectId,
        project_item_id: child.id,
        parent_item_id: parent.id,
        product_code: product.product_code || child.product_code || "",
        product_name: product.product_name || child.product_name,
        movement_type: "out",
        quantity: quantityToConsume,
        unit: child.unit || product.unit || "adet",
        supplier_name: "Proje ana kalem tamamlanan miktar",
        partner_name: "Proje ana kalem tamamlanan miktar",
        partner_type: "Proje",
        related_project_id: projectId,
        related_project_name: project?.project_name || "",
        unit_price: Number(resolveProjectItemPrice(child).unitPrice || product.last_unit_price || 0) || 0,
        currency: child.currency || product.last_currency || projectCurrencyForDisplay(),
        movement_date: today,
        source: "Ana kalem tamamlanan miktar kaydı",
        reserved_quantity: reservedToRelease,
        issued_to_production_quantity: quantityToConsume,
        notes: `${parent.product_name} için ${processQuantity} ${parent.unit || "adet"} tamamlanan ana kalem karşılığı kullanıldı | Birim kullanım: ${relation.childQuantityPerParent} | Stoktan karşılanan: ${quantityToConsume} | Bekleyen/rezerve kalan: ${Math.max(Number(child.reserved_quantity || 0) - reservedToRelease, 0)}`,
      });
    }

    if (movementPayload.length > 0) {
      const { error: movementError } = await supabase.from("stock_movements").insert(movementPayload);
      if (movementError) warnings.push(movementError.message);
    }

    const nextProducedParentQuantity = Number(parent.received_quantity || 0) + processQuantity;
    const parentDone = nextProducedParentQuantity >= Number(parent.estimated_quantity || 0);
    const { error: parentError } = await supabase
      .from("project_items")
      .update({
        received_quantity: nextProducedParentQuantity,
        status: parentDone ? "Tamamlandı" : "İşlemde",
        updated_at: now,
      })
      .eq("id", parent.id)
      .eq("project_id", projectId)
      .eq("user_id", user.id);

    if (parentError) warnings.push(parentError.message);

    setProcessQuantityDrafts((prev) => ({ ...prev, [parent.id]: "" }));
    setProcessingParentId("");
    await loadProject();
    setMessage(`${processQuantity} ${parent.unit || "adet"} tamamlanan ana kalem kaydedildi. ${movementPayload.length} bileşen için stok hareketi kaydedildi.${warnings.length > 0 ? " Bazı kayıtlar kontrol edilmeli." : ""}`);
  }

  function mapItemToRequestLine(item, quantityOverride = null) {
    const quantity = quantityOverride ?? Number(item.estimated_quantity || 0);

    return {
      urunKodu: item.product_code || "",
      urunAciklamasi: item.product_name || "",
      birim: item.unit || "adet",
      talepEdilenAdet: quantity,
      birimFiyat: Number(item.estimated_unit_price || 0),
      toplam: Number(item.estimated_total || 0),
      paraBirimi: item.currency || "TRY",
      not: item.note || "",
      projectItemId: item.id,
      parentItemId: item.parent_item_id || null,
    };
  }

  function summarizeRequestItems(lines) {
    const grouped = new Map();

    (lines || []).forEach((line) => {
      const code = String(line.urunKodu || line.product_code || "").trim();
      const description = String(line.urunAciklamasi || line.product_name || line.description || "").trim();
      const unit = String(line.birim || line.unit || "adet").trim() || "adet";
      const key = `${code || description}`.toLocaleLowerCase("tr-TR");
      if (!key) return;

      const quantity = Number(line.talepEdilenAdet ?? line.quantity ?? line.estimated_quantity ?? 0) || 0;
      const unitPrice = Number(line.birimFiyat ?? line.unit_price ?? line.estimated_unit_price ?? 0) || 0;
      const total = Number(line.toplam ?? line.total ?? line.estimated_total ?? 0) || unitPrice * quantity;
      const note = line.not || line.note || "";

      if (!grouped.has(key)) {
        grouped.set(key, {
          urunKodu: code,
          urunAciklamasi: description,
          birim: unit,
          talepEdilenAdet: quantity,
          birimFiyat: unitPrice,
          toplam: total,
          paraBirimi: line.paraBirimi || line.currency || "TRY",
          not: note,
          projectItemIds: line.projectItemIds || (line.projectItemId ? [line.projectItemId] : []),
          parentItemIds: line.parentItemIds || (line.parentItemId ? [line.parentItemId] : []),
          sourceLineCount: 1,
        });
        return;
      }

      const existing = grouped.get(key);
      const notes = new Set(String(existing.not || "").split(" | ").filter(Boolean));
      if (note) notes.add(note);
      grouped.set(key, {
        ...existing,
        urunKodu: existing.urunKodu || code,
        urunAciklamasi: existing.urunAciklamasi || description,
        talepEdilenAdet: Number(existing.talepEdilenAdet || 0) + quantity,
        birimFiyat: existing.birimFiyat || unitPrice,
        toplam: Number(existing.toplam || 0) + total,
        paraBirimi: existing.paraBirimi || line.paraBirimi || line.currency || "TRY",
        not: Array.from(notes).join(" | "),
        projectItemIds: Array.from(new Set([...(existing.projectItemIds || []), ...(line.projectItemIds || []), line.projectItemId].filter(Boolean))),
        parentItemIds: Array.from(new Set([...(existing.parentItemIds || []), ...(line.parentItemIds || []), line.parentItemId].filter(Boolean))),
        sourceLineCount: Number(existing.sourceLineCount || 1) + 1,
      });
    });

    return Array.from(grouped.values()).sort((a, b) => {
      const codeCompare = String(a.urunKodu || "").localeCompare(String(b.urunKodu || ""), "tr");
      if (codeCompare !== 0) return codeCompare;
      return String(a.urunAciklamasi || "").localeCompare(String(b.urunAciklamasi || ""), "tr");
    });
  }

  function parseRequestItems(request) {
    if (Array.isArray(request.items)) return summarizeRequestItems(request.items);
    if (typeof request.items === "string" && request.items.trim()) {
      try {
        const parsed = JSON.parse(request.items);
        return Array.isArray(parsed) ? summarizeRequestItems(parsed) : [];
      } catch (error) {
        console.warn("Talep kalemleri okunamadi:", error);
      }
    }

    const fallbackItems = items
      .filter((item) => item.status === "Talep oluşturuldu" && !stockInfoForItem(item).isMainItem)
      .map((item) => mapItemToRequestLine(item, stockInfoForItem(item).requiredQuantity || Number(item.estimated_quantity || 0)));

    return summarizeRequestItems(fallbackItems);
  }

  function toggleProjectRequest(requestId) {
    setExpandedRequestIds((prev) =>
      prev.includes(requestId)
        ? prev.filter((id) => id !== requestId)
        : [...prev, requestId],
    );
  }

  function safeFileName(value) {
    return String(value || "dosya")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 90);
  }

  function projectItemExportRows(parentItem, childRows) {
    return (childRows || []).map((item, index) => ({
      "Sıra": index + 1,
      "Ana Ürün": parentItem.product_name || "",
      "Ürün Kodu": item.product_code || "",
      "Ürün / Açıklama": item.product_name || "",
      "Miktar": Number(item.estimated_quantity || 0),
      "Birim": item.unit || "adet",
      "Birim Fiyat": Number(item.estimated_unit_price || 0),
      "Toplam": Number(item.estimated_total || 0),
      "Para Birimi": item.currency || "TRY",
      "Durum": item.status || "Bekliyor",
      "Not": item.note || "",
    }));
  }

  function requestExportRows(requestItems) {
    return (requestItems || []).map((item, index) => ({
      "Sıra": index + 1,
      "Ürün Kodu": item.urunKodu || item.product_code || "",
      "Ürün / Açıklama": item.urunAciklamasi || item.product_name || item.description || "",
      "Miktar": Number(item.talepEdilenAdet || item.quantity || item.estimated_quantity || 0),
      "Birim": item.birim || item.unit || "adet",
      "Birim Fiyat": Number(item.birimFiyat || item.unit_price || item.estimated_unit_price || 0),
      "Toplam": Number(item.toplam || item.total || item.estimated_total || 0),
      "Para Birimi": item.paraBirimi || item.currency || "TRY",
      "Birleşen Satır": Number(item.sourceLineCount || 1),
      "Not": item.not || item.note || "",
    }));
  }

  function downloadRowsAsExcel(rows, fileName, sheetName = "Liste") {
    if (!rows || rows.length === 0) {
      setMessage("İndirilecek kalem bulunamadı.");
      return;
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
    XLSX.writeFile(workbook, `${safeFileName(fileName)}.xlsx`);
  }

  async function downloadRowsAsPdf(rows, title, fileName) {
    if (!rows || rows.length === 0) {
      setMessage("İndirilecek kalem bulunamadı.");
      return;
    }

    const [{ default: jsPDF }, autoTableModule] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const autoTable = autoTableModule.default || autoTableModule.autoTable;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const columns = Object.keys(rows[0]);

    doc.setFontSize(13);
    doc.text(title, 40, 36);
    autoTable(doc, {
      startY: 52,
      head: [columns],
      body: rows.map((row) => columns.map((column) => row[column] ?? "")),
      styles: { fontSize: 7, cellPadding: 4 },
      headStyles: { fillColor: [37, 99, 235] },
    });
    doc.save(`${safeFileName(fileName)}.pdf`);
  }

  function downloadProjectItemChildren(parentItem, format) {
    const childRows = childItemsByParent[parentItem.id] || [];
    const rows = projectItemExportRows(parentItem, childRows);
    const fileName = `${project?.project_code || "proje"}-${parentItem.product_code || parentItem.product_name}-alt-malzemeler`;
    const title = `${parentItem.product_name || "Ana Ürün"} Alt Malzemeleri`;

    if (format === "pdf") {
      downloadRowsAsPdf(rows, title, fileName);
      return;
    }

    downloadRowsAsExcel(rows, fileName, "Alt Malzemeler");
  }

  function downloadRequestItems(request, format) {
    const rows = requestExportRows(parseRequestItems(request));
    const fileName = `${project?.project_code || "proje"}-${request.ad || "talep"}-icmal`;
    const title = `${request.ad || "Proje Talebi"} İcmal Listesi`;

    if (format === "pdf") {
      downloadRowsAsPdf(rows, title, fileName);
      return;
    }

    downloadRowsAsExcel(rows, fileName, "Talep İcmali");
  }

  async function deleteProjectRequest(request) {
    setMessage("");

    if (!request?.id) {
      setMessage("Silinecek talep kaydı bulunamadı.");
      return;
    }

    const approved = window.confirm(`"${request.ad || "Proje Talebi"}" talebi silinsin mi?`);
    if (!approved) return;

    const user = await getUserOrRedirect();
    if (!user) return;

    const requestItems = parseRequestItems(request);
    const relatedItemIds = Array.from(
      new Set(
        requestItems
          .flatMap((item) => [
            item.projectItemId,
            ...(item.projectItemIds || []),
          ])
          .filter(Boolean),
      ),
    );

    const { error } = await supabase
      .from("requests")
      .delete()
      .eq("id", request.id)
      .eq("user_id", user.id);

    if (error) {
      console.error("Proje talebi silinemedi:", error);
      setMessage(error.message || "Talep silinemedi.");
      return;
    }

    if (relatedItemIds.length > 0) {
      const { error: itemError } = await supabase
        .from("project_items")
        .update({ status: "Satınalma gerekli", updated_at: new Date().toISOString() })
        .in("id", relatedItemIds)
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .eq("status", "Talep oluşturuldu");

      if (itemError) {
        console.warn("Talep silindi ama proje kalemi durumları güncellenemedi:", itemError);
      } else {
        setItems((prev) =>
          prev.map((item) =>
            relatedItemIds.includes(item.id) && item.status === "Talep oluşturuldu"
              ? { ...item, status: "Satınalma gerekli", updated_at: new Date().toISOString() }
              : item,
          ),
        );
      }
    }

    setProjectRequests((prev) => prev.filter((item) => item.id !== request.id));
    setExpandedRequestIds((prev) => prev.filter((id) => id !== request.id));
    if (createdRequestId === request.id) setCreatedRequestId("");
    setMessage("Talep silindi.");
    await loadProject();
  }

  async function updateProjectItemQuantity(item, delta) {
    const user = await getUserOrRedirect();
    if (!user) return;

    const oldQuantity = Number(item.estimated_quantity || 0);
    const nextQuantity = Math.max(oldQuantity + Number(delta || 0), 0);
    if (nextQuantity === oldQuantity) return;

    const unitPrice = Number(item.estimated_unit_price || item.quote_unit_price || 0);
    const nextItem = {
      ...item,
      estimated_quantity: nextQuantity,
      estimated_total: nextQuantity * unitPrice,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("project_items")
      .update({
        estimated_quantity: nextItem.estimated_quantity,
        estimated_total: nextItem.estimated_total,
        updated_at: nextItem.updated_at,
      })
      .eq("id", item.id)
      .eq("project_id", projectId)
      .eq("user_id", user.id);

    if (error) {
      setMessage(error.message || "Malzeme adedi güncellenemedi.");
      return;
    }

    const nextItems = items.map((candidate) => candidate.id === item.id ? nextItem : candidate);
    setItems(nextItems);
    await recordMaterialRevision({
      actionType: "quantity",
      beforeItem: item,
      afterItem: nextItem,
      user,
      description: delta > 0 ? "Malzeme adedi artırıldı." : "Malzeme adedi azaltıldı.",
    });
    await refreshProjectBudget(nextItems);
    await loadProject();
  }

  async function updateProjectItemUnitPrice(item) {
    const user = await getUserOrRedirect();
    if (!user) return;

    const draft = itemPriceDrafts[item.id];
    const nextUnitPrice = Number(draft ?? item.estimated_unit_price ?? 0);
    const oldUnitPrice = Number(item.estimated_unit_price || item.quote_unit_price || 0);
    if (nextUnitPrice === oldUnitPrice) return;

    const quantity = Number(item.estimated_quantity || 0);
    const nextItem = {
      ...item,
      estimated_unit_price: nextUnitPrice,
      estimated_total: quantity * nextUnitPrice,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("project_items")
      .update({
        estimated_unit_price: nextItem.estimated_unit_price,
        estimated_total: nextItem.estimated_total,
        updated_at: nextItem.updated_at,
      })
      .eq("id", item.id)
      .eq("project_id", projectId)
      .eq("user_id", user.id);

    if (error) {
      setMessage(error.message || "Malzeme fiyatı güncellenemedi.");
      return;
    }

    const nextItems = items.map((candidate) => candidate.id === item.id ? nextItem : candidate);
    setItems(nextItems);
    setItemPriceDrafts((prev) => ({ ...prev, [item.id]: String(nextUnitPrice) }));
    await recordMaterialRevision({
      actionType: "price",
      beforeItem: item,
      afterItem: nextItem,
      user,
      description: "Malzeme birim fiyatı güncellendi.",
    });
    await refreshProjectBudget(nextItems);
    await loadProject();
  }

  async function createRequestFromSelectedItems() {
    setMessage("");
    setCreatedRequestId("");

    const user = await getUserOrRedirect();
    if (!user) return;

    const selectedItems = items.filter((item) => selectedPurchaseItemIds.includes(item.id) && !stockInfoForItem(item).isMainItem);

    if (selectedItems.length === 0) {
      setMessage("Talep oluşturmak için en az bir ürün seçin.");
      return;
    }

    const requestItems = summarizeRequestItems(selectedItems.map(mapItemToRequestLine));
    const title = `${project.project_code || "PRJ"} - Satınalma Talebi`;

    const { data, error } = await supabase
      .from("requests")
      .insert({
        user_id: user.id,
        project_id: projectId,
        ad: title,
        durum: "Proje Talebi",
        filepath: null,
        totalitems: requestItems.length,
        items: requestItems,
      })
      .select("*")
      .single();

    if (error) {
      setMessage("Proje talebi oluşturulamadı. Requests tablosunda project_id ve items alanları çalıştırılmış olmalı.");
      return;
    }

    await supabase
      .from("project_items")
      .update({ status: "Satınalma gerekli", updated_at: new Date().toISOString() })
      .in("id", selectedItems.map((item) => item.id));

    setProjectRequests((prev) => [data, ...prev]);
    setSelectedPurchaseItemIds([]);
    setCreatedRequestId(data.id);
    setMessage("Proje satınalma talebi oluşturuldu.");
  }

  async function createRequestFromNeededItems() {
    setMessage("");
    setCreatedRequestId("");

    const user = await getUserOrRedirect();
    if (!user) return;

    const neededItems = items
      .map((item) => ({ item, stock: stockInfoForItem(item) }))
      .filter(({ stock }) => !stock.isMainItem && stock.requiredQuantity > 0);

    if (neededItems.length === 0) {
      setMessage("Satınalma gereken ürün bulunamadı.");
      return;
    }

    const requestItems = summarizeRequestItems(neededItems.map(({ item, stock }) => mapItemToRequestLine(item, stock.requiredQuantity)));
    const title = `${project.project_code || "PRJ"} - Satınalma Gerekenler`;
    const fullPayload = {
      user_id: user.id,
      project_id: projectId,
      ad: title,
      durum: "Proje Talebi",
      filepath: null,
      totalitems: requestItems.length,
      items: requestItems,
    };

    console.log("Otomatik talep payload:", fullPayload);
    let localRequestPayload = fullPayload;

    let { data, error } = await supabase
      .from("requests")
      .insert(fullPayload)
      .select("*")
      .single();

    if (error) {
      console.warn("Otomatik talep tam payload insert uyarısı:", error);

      const projectLinkedPayload = {
        user_id: user.id,
        project_id: projectId,
        ad: title,
        durum: "Proje Talebi",
        filepath: null,
        totalitems: requestItems.length,
      };

      console.log("Otomatik talep proje ba\u011flant\u0131l\u0131 fallback payload:", projectLinkedPayload);

      const projectLinkedResult = await supabase
        .from("requests")
        .insert(projectLinkedPayload)
        .select("*")
        .single();

      if (!projectLinkedResult.error) {
        data = projectLinkedResult.data;
        localRequestPayload = { ...projectLinkedPayload, items: requestItems };
      } else {
        console.warn("Otomatik talep proje ba\u011flant\u0131l\u0131 fallback uyar\u0131s\u0131:", projectLinkedResult.error);

        const fallbackPayload = {
          user_id: user.id,
          ad: title,
          durum: "Proje Talebi",
          filepath: null,
          totalitems: requestItems.length,
        };

        console.log("Otomatik talep fallback payload:", fallbackPayload);

        const fallbackResult = await supabase
          .from("requests")
          .insert(fallbackPayload)
          .select("*")
          .single();

        if (fallbackResult.error) {
          console.error("Otomatik talep fallback insert hatası:", fallbackResult.error);
          setMessage(fallbackResult.error.message || projectLinkedResult.error.message || error.message || "Satınalma gerekenlerden talep oluşturulamadı.");
          return;
        }

        data = fallbackResult.data;
        localRequestPayload = { ...fallbackPayload, project_id: projectId, items: requestItems };
      }
    }

    if (!data?.id) {
      setMessage("Talep oluşturuldu ama kayıt id bilgisi alınamadı.");
      return;
    }

    await supabase
      .from("project_items")
      .update({ status: "Talep oluşturuldu", updated_at: new Date().toISOString() })
      .in("id", neededItems.map(({ item }) => item.id));

    const localRequest = {
      ...localRequestPayload,
      ...data,
      project_id: data.project_id || projectId,
      items: data.items || requestItems,
      totalitems: data.totalitems || requestItems.length,
      ad: data.ad || title,
      durum: data.durum || "Proje Talebi",
    };

    setProjectRequests((prev) => [localRequest, ...prev.filter((request) => request.id !== localRequest.id)]);
    setCreatedRequestId(localRequest.id);
    setActiveTab("Talepler");
    setMessage("Talep başarıyla oluşturuldu. Proje taleplerinde listelendi.");
    await loadProjectItems();
  }
  const parentItems = useMemo(() => items.filter((item) => !item.parent_item_id), [items]);

  const childItemsByParent = useMemo(() => {
    const grouped = {};
    items.forEach((item) => {
      if (!item.parent_item_id) return;
      grouped[item.parent_item_id] = [...(grouped[item.parent_item_id] || []), item];
    });
    return grouped;
  }, [items]);


  const purchaseRequiredItems = useMemo(() => {
    return items.filter((item) => stockInfoForItem(item).needsPurchase);
  }, [items, products, childItemsByParent]);

  const criticalStockItems = useMemo(() => {
    return items.filter((item) => stockInfoForItem(item).isCritical);
  }, [items, products, childItemsByParent]);

  function itemMatchesFilter(item, filter = itemStockFilter) {
    const info = stockInfoForItem(item);
    if (filter === "purchase") return info.needsPurchase;
    if (filter === "critical") return info.isCritical;
    return true;
  }

  function itemMatchesStockFilter(item) {
    return itemMatchesFilter(item, itemStockFilter);
  }

  const visibleParentItems = useMemo(() => {
    if (itemStockFilter === "all") return parentItems;

    return parentItems.filter((item) => {
      const children = childItemsByParent[item.id] || [];
      return itemMatchesStockFilter(item) || children.some(itemMatchesStockFilter);
    });
  }, [parentItems, childItemsByParent, itemStockFilter, products]);

  const activeStockFilterCount = itemStockFilter === "purchase"
    ? purchaseRequiredItems.length
    : itemStockFilter === "critical"
      ? criticalStockItems.length
      : items.length;

  function applyItemStockFilter(nextFilter) {
    const resolvedFilter = itemStockFilter === nextFilter ? "all" : nextFilter;
    setItemStockFilter(resolvedFilter);

    if (resolvedFilter === "all") {
      setMessage("Malzeme listesi tüm kayıtları gösterecek şekilde açıldı.");
      return;
    }

    const matchedParentIds = parentItems
      .filter((parent) => {
        const children = childItemsByParent[parent.id] || [];
        return itemMatchesFilter(parent, resolvedFilter) || children.some((child) => itemMatchesFilter(child, resolvedFilter));
      })
      .map((parent) => parent.id);

    setExpandedItems((prev) => ({
      ...prev,
      ...Object.fromEntries(matchedParentIds.map((id) => [id, true])),
    }));

    const count = resolvedFilter === "purchase" ? purchaseRequiredItems.length : criticalStockItems.length;
    const label = resolvedFilter === "purchase" ? "Satınalma gereken" : "Kritik stok";
    setMessage(`${label} filtresi uygulandı. ${count} kalem, ${matchedParentIds.length} ana ürün altında gösteriliyor.`);
  }

  const previewCategories = useMemo(() => {
    return Array.from(new Set(previewRows.map((row) => previewRowCategory(row)))).filter(Boolean);
  }, [previewRows]);

  const filteredPreviewRows = useMemo(() => {
    return previewRows.filter((row) => {
      const categoryMatch = !previewCategoryFilter || previewRowCategory(row) === previewCategoryFilter;
      return categoryMatch && previewRowMatchesSearch(row);
    });
  }, [previewRows, previewCategoryFilter, previewSearch]);

  const groupedPreviewRows = useMemo(() => {
    return filteredPreviewRows.reduce((groups, row) => {
      const category = previewRowCategory(row);
      groups[category] = [...(groups[category] || []), row];
      return groups;
    }, {});
  }, [filteredPreviewRows]);

  const selectedPreviewRows = useMemo(() => {
    const selected = new Set(selectedPreviewRowIds);
    return previewRows.filter((row) => selected.has(row.preview_id));
  }, [previewRows, selectedPreviewRowIds]);

  const allFilteredPreviewRowsSelected = useMemo(() => {
    return filteredPreviewRows.length > 0 && filteredPreviewRows.every((row) => selectedPreviewRowIds.includes(row.preview_id));
  }, [filteredPreviewRows, selectedPreviewRowIds]);

  const previewLooksLikeFlatMainList = useMemo(() => {
    return previewRows.length > 0 && previewRows.every((row) => isUncategorizedPreviewCategory(previewRowCategory(row)));
  }, [previewRows]);

  const allProjectItemsSelected = useMemo(() => {
    return items.length > 0 && items.every((item) => selectedProjectItemIds.includes(item.id));
  }, [items, selectedProjectItemIds]);

  const selectedProjectItemDeleteIds = useMemo(() => {
    return expandProjectItemSelection(selectedProjectItemIds);
  }, [items, selectedProjectItemIds]);

  const totals = useMemo(() => {
    const parentById = new Map(items.map((item) => [item.id, item]));
    const parentIdsWithChildren = new Set(items.map((item) => item.parent_item_id).filter(Boolean));
    const itemEstimate = items.reduce((sum, item) => {
      if (item.parent_item_id) {
        const parent = parentById.get(item.parent_item_id);
        const parentTotal = Number(parent?.quote_total || parent?.estimated_total || 0);
        return parentTotal > 0 ? sum : sum + Number(item.estimated_total || 0);
      }

      if (parentIdsWithChildren.has(item.id) || isMainProjectItem(item)) {
        return sum + sectionQuoteTotalFor(item.product_name, Number(item.quote_total || item.estimated_total || 0));
      }

      return sum + Number(item.estimated_total || 0);
    }, 0);
    const materialCost = items
      .filter((item) => item.parent_item_id)
      .reduce((sum, item) => sum + Number(resolveProjectItemPrice(item).total || 0), 0);
    const orderTotal = projectOrders.reduce((sum, order) => sum + Number(order.total_amount || order.order_total || order.total || 0), 0);
    const stockCost = stockMovements.reduce(
      (sum, movement) => sum + Number(movement.quantity || 0) * Number(movement.unit_price || 0),
      0,
    );
    const expenseTotal = expenses.reduce((sum, expense) => sum + Number(expense.base_amount || expense.amount || 0), 0);
    const approvedRevisions = revisions.filter((revision) =>
      (revision.status === "Onaylandı" || revision.status === "Uygulandı") &&
      revision.revision_type !== "Malzeme Değişikliği"
    );
    const revisionRevenue = approvedRevisions.reduce((sum, revision) => sum + Number(revision.revenue_base_amount || revision.revenue_amount || 0), 0);
    const revisionCost = approvedRevisions.reduce((sum, revision) => sum + Number(revision.cost_base_amount || revision.cost_amount || 0), 0);
    const totalCost = materialCost + orderTotal + stockCost + expenseTotal + revisionCost;
    const actualCost = totalCost || Number(project?.actual_cost || 0) || 0;
    const contract = Number(project?.contract_amount || 0) + revisionRevenue;
    const estimatedBudget = (itemEstimate || Number(project?.estimated_budget || 0)) + revisionCost;
    const remainingBudget = estimatedBudget - actualCost;
    const budgetVariance = actualCost - estimatedBudget;
    const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const remainingCollection = contract - paidTotal;
    const netProfitLoss = contract - totalCost;

    return {
      itemEstimate,
      materialCost,
      actualCost,
      orderTotal,
      stockCost,
      expenseTotal,
      revisionRevenue,
      revisionCost,
      totalCost,
      contract,
      estimatedBudget,
      remainingBudget,
      budgetVariance,
      paidTotal,
      remainingCollection,
      netProfitLoss,
    };
  }, [items, payments, expenses, revisions, project, projectOrders, allOrders, stockMovements, products, visiblePreviewSections, storedSectionTotals]);

  const revisionSummary = useMemo(() => {
    const appliedRevisions = revisions.filter((revision) => !["İptal", "Iptal"].includes(revision.status));
    const impactFor = (revision) => Number(revision.cost_impact ?? revision.cost_base_amount ?? revision.cost_amount ?? 0);
    const netImpact = appliedRevisions.reduce((sum, revision) => sum + impactFor(revision), 0);
    const addedCost = appliedRevisions.reduce((sum, revision) => {
      const impact = impactFor(revision);
      return impact > 0 ? sum + impact : sum;
    }, 0);
    const deductedCost = appliedRevisions.reduce((sum, revision) => {
      const impact = impactFor(revision);
      return impact < 0 ? sum + Math.abs(impact) : sum;
    }, 0);
    const currentTotal = totals.itemEstimate || Number(project?.estimated_budget || 0) || 0;
    const initialTotal = currentTotal - netImpact;

    return { initialTotal, addedCost, deductedCost, currentTotal, netImpact };
  }, [revisions, totals.itemEstimate, project]);

  const projectKpis = useMemo(() => {
    const mainItems = items.filter((item) => !item.parent_item_id);
    const childItems = items.filter((item) => item.parent_item_id);
    const completedItems = items.filter((item) =>
      ["Tamamlandı", "Sevk edildi", "Depoda"].includes(item.status),
    ).length;
    const receivedItems = items.filter((item) => Number(item.received_quantity || 0) > 0 || item.status === "Depoda").length;
    const missingItems = items.filter((item) =>
      ["Satınalma gerekli", "Eksik geldi", "Tedarikçiden bekleniyor"].includes(item.status),
    ).length;
    const openOrders = projectOrders.filter(
      (order) => !["Tam Teslim", "Teslim Edildi", "İptal"].includes(order.status),
    ).length;
    const materialCompletion =
      items.length > 0 ? Math.round((receivedItems / items.length) * 100) : 0;
    const completion =
      items.length > 0 ? Math.round((completedItems / items.length) * 100) : 0;
    const collection =
      totals.contract > 0 ? Math.round((totals.paidTotal / totals.contract) * 100) : 0;
    const profitLoss = totals.netProfitLoss;

    return {
      mainItems,
      childItems,
      completion,
      materialCompletion,
      collection,
      totalOrders: projectOrders.length,
      openOrders,
      receivedItems,
      missingItems,
      actualCost: totals.actualCost,
      profitLoss,
      budgetVariance: totals.budgetVariance,
    };
  }, [items, projectOrders, totals]);

  const recentProjectOrders = useMemo(() => {
    return [...projectOrders]
      .sort((a, b) => new Date(b.created_at || b.order_date || 0) - new Date(a.created_at || a.order_date || 0))
      .slice(0, 5);
  }, [projectOrders]);

  const overviewWarnings = useMemo(() => {
    const warnings = [];

    if (projectKpis.openOrders > 0) {
      warnings.push({ tone: "red", text: `${projectKpis.openOrders} adet acik siparis bulunmaktadir.` });
    }
    if (criticalStockItems.length > 0) {
      warnings.push({ tone: "orange", text: `${criticalStockItems.length} adet kritik stok seviyesi uyarisi.` });
    }
    if (totals.budgetVariance > 0) {
      warnings.push({ tone: "amber", text: `${formatMoney(totals.budgetVariance, projectCurrencyForDisplay())} bütçe aşımı riski tespit edildi.` });
    }

    const delayedOrders = projectOrders.filter((order) => {
      const dueDate = order.due_date || order.delivery_date || order.termin_date;
      if (!dueDate) return false;
      const isClosed = ["Tam Teslim", "Teslim Edildi", "Iptal", "İptal"].includes(order.status);
      return !isClosed && new Date(dueDate) < new Date();
    }).length;

    if (delayedOrders > 0) {
      warnings.push({ tone: "blue", text: `${delayedOrders} adet geciken teslimat bulunmaktadir.` });
    }

    if (warnings.length === 0) {
      warnings.push({ tone: "green", text: "Bu proje icin acil uyari bulunmuyor." });
    }

    return warnings;
  }, [criticalStockItems.length, projectKpis.openOrders, projectOrders, totals.budgetVariance]);

  function overviewWarningClass(tone) {
    const classes = {
      red: "border-red-100 bg-red-50 text-red-700",
      orange: "border-orange-100 bg-orange-50 text-orange-700",
      amber: "border-amber-100 bg-amber-50 text-amber-700",
      blue: "border-blue-100 bg-blue-50 text-blue-700",
      green: "border-emerald-100 bg-emerald-50 text-emerald-700",
    };

    return classes[tone] || classes.blue;
  }

  function overviewOrderAmount(order) {
    return Number(order.total_amount || order.order_total || order.total || 0);
  }

  function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.warn("Liste verisi okunamadi:", error);
      }
    }
    return [];
  }

  function reportName(report) {
    return report.ad || report.name || report.report_name || report.title || "Mukayese raporu";
  }

  function reportSupplier(report) {
    return report.partner_name || report.onerilenFirma || report.onerilenfirma || report.recommended_firm || report.firma || "-";
  }

  function reportAmount(report) {
    return Number(report.net_total_base || report.net_total || report.base_amount || report.supplier_offer_amount || report.total_amount || 0);
  }

  function reportRows(report) {
    return parseJsonArray(report.items).length > 0 ? parseJsonArray(report.items) : parseJsonArray(report.analysis);
  }

  function offerAmount(offer) {
    return Number(offer.toplam_tutar || offer.total_amount || offer.base_amount || 0);
  }

  function movementAmount(movement) {
    return Number(movement.quantity || 0) * Number(movement.unit_price || 0);
  }

  function projectDependencySummary() {
    return [
      { label: "Stok hareketi", value: stockMovements.length, blocker: stockMovements.length > 0 },
      { label: "Teklif", value: projectOffers.length, blocker: projectOffers.length > 0 },
      { label: "Sipariş", value: projectOrders.length, blocker: projectOrders.length > 0 },
      { label: "Ödeme", value: payments.length, blocker: payments.length > 0 },
      { label: "Revizyon", value: revisions.length, blocker: revisions.length > 0 },
    ];
  }

  async function reverseStockMovementTotals(movement, userId) {
    if (!movement.product_id) return;

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id,current_stock,reserved_stock")
      .eq("id", movement.product_id)
      .eq("user_id", userId)
      .single();

    if (productError || !product) return;

    const quantity = Number(movement.quantity || 0);
    const reservedQuantity = Number(movement.reserved_quantity || 0) || quantity;
    const source = normalizeText(`${movement.source || ""} ${movement.notes || ""}`);
    const updatePayload = { updated_at: new Date().toISOString() };

    if (movement.movement_type === "in") {
      updatePayload.current_stock = Math.max(Number(product.current_stock || 0) - quantity, 0);
    } else if (source.includes("stoktan karsiland") || source.includes("rezerve")) {
      updatePayload.reserved_stock = Math.max(Number(product.reserved_stock || 0) - reservedQuantity, 0);
    } else if (movement.movement_type === "out") {
      updatePayload.current_stock = Number(product.current_stock || 0) + quantity;
    }

    await supabase
      .from("products")
      .update(updatePayload)
      .eq("id", product.id)
      .eq("user_id", userId);
  }

  async function deleteStockMovement(movement) {
    const approved = window.confirm(`${movement.product_name || "Stok hareketi"} kaydı silinsin mi? Stok toplamları ters hareketle güncellenecek.`);
    if (!approved) return;

    const user = await getUserOrRedirect();
    if (!user) return;

    await reverseStockMovementTotals(movement, user.id);

    const { error } = await supabase
      .from("stock_movements")
      .delete()
      .eq("id", movement.id)
      .eq("user_id", user.id);

    if (error) {
      setMessage(error.message || "Stok hareketi silinemedi.");
      return;
    }

    setMessage("Stok hareketi silindi ve liste yenilendi.");
    await loadProject();
  }

  async function deleteProjectOffer(offer) {
    const hasReports = projectReports.length > 0;
    const approved = window.confirm(
      hasReports
        ? "Bu projede mukayese/analiz raporu var. Teklifi silmek rapor geçmişini otomatik silmez. Teklif kaydı silinsin mi?"
        : "Teklif kaydı silinsin mi?",
    );
    if (!approved) return;

    const user = await getUserOrRedirect();
    if (!user) return;

    const { error } = await supabase
      .from("offers")
      .delete()
      .eq("id", offer.id)
      .eq("user_id", user.id);

    if (error) {
      setMessage(error.message || "Teklif silinemedi.");
      return;
    }

    setMessage("Teklif silindi. Teklif toplamları yenilendi.");
    await loadProject();
  }

  function quantityText(quantity, unit = "adet") {
    return `${new Intl.NumberFormat("tr-TR", {
      maximumFractionDigits: 2,
    }).format(Number(quantity || 0))} ${unit || "adet"}`;
  }

  const projectReportTotal = projectReports.reduce((sum, report) => sum + reportAmount(report), 0);
  const offerTotalsByCurrency = compactMoneyGroups(projectOffers, offerAmount, (offer) => offer.para_birimi || offer.currency || projectCurrencyForDisplay());
  const stockTotalsByCurrency = compactMoneyGroups(stockMovements, movementAmount, (movement) => movement.currency || projectCurrencyForDisplay());
  const dependencySummary = projectDependencySummary();

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Proje yükleniyor...</div>;
  }

  if (!project) {
    return (
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-bold text-yellow-900">
        {message || "Proje bulunamadı."}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="mx-auto max-w-[1280px] space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link href="/dashboard/projeler" className="text-sm font-bold text-blue-700 hover:underline">
              Projelere dön
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-bold text-slate-900">{project.project_name}</h1>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(project.status)}`}>
                {project.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {project.project_code} · {project.customer_name || "Müşteri belirtilmedi"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={project.closure_status || project.status || "Açık"}
              onChange={(event) => updateProjectClosureStatus(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700"
            >
              {projectClosureStatuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
              onClick={() => window.print()}
            >
              Proje Raporu
            </button>
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <span>{message}</span>
              {createdRequestId && (
                <Link
                  href="/dashboard/talepler"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-center text-xs font-bold text-white hover:bg-blue-700"
                >
                  Talepler sayfasına git
                </Link>
              )}
            </div>
          </div>
        )}

        {productCardWarning && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
            <div className="font-black">Bazı ürün kartları oluşturulamadı.</div>
            <div className="mt-1">{productCardWarning}</div>
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-black text-slate-900">Bağlı kayıtlar</h2>
              <p className="mt-1 text-xs text-slate-500">Proje silme ve veri temizliği için ilişkili kayıt özeti.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {dependencySummary.map((item) => (
                <div key={item.label} className={`rounded-xl border px-3 py-2 ${item.blocker ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                  <div className="truncate text-[11px] font-bold text-slate-500" title={item.label}>{item.label}</div>
                  <div className="mt-1 text-lg font-black text-slate-950">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {activeTab === "Genel Özet" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-xl font-black text-white">TL</div>
              <div className="text-sm font-bold text-slate-600">Sözleşme Bedeli</div>
              <div className="mt-3 max-w-full break-words text-2xl font-black leading-tight text-slate-950">{formatMoney(totals.contract, projectCurrencyForDisplay())}</div>
              <div className="mt-2 text-sm text-slate-500">Toplam bedel</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-xl font-black text-white">OK</div>
              <div className="text-sm font-bold text-slate-600">Tahsilat</div>
              <div className="mt-3 max-w-full break-words text-2xl font-black leading-tight text-slate-950">{formatMoney(totals.paidTotal, projectCurrencyForDisplay())}</div>
              <div className="mt-2 text-sm text-slate-500">Tahsil edilen</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-600 text-xl font-black text-white">#</div>
              <div className="text-sm font-bold text-slate-600">Sipariş</div>
              <div className="mt-3 text-2xl font-black text-slate-950">{projectKpis.totalOrders}</div>
              <div className="mt-2 text-sm text-slate-500">Toplam sipariş</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500 text-xl font-black text-white">%</div>
              <div className="text-sm font-bold text-slate-600">Tamamlanma</div>
              <div className="mt-3 text-2xl font-black text-slate-950">%{projectKpis.completion}</div>
              <div className="mt-2 text-sm text-slate-500">Genel ilerleme</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-xl font-black text-white">TL</div>
              <div className="text-sm font-bold text-slate-600">Bütçe Durumu</div>
              <div className={`mt-3 max-w-full break-words text-2xl font-black leading-tight ${totals.budgetVariance > 0 ? "text-red-600" : "text-emerald-700"}`}>{formatMoney(totals.budgetVariance, projectCurrencyForDisplay())}</div>
              <div className="mt-2 text-sm text-slate-500">Bütçe sapması</div>
            </div>
          </div>
        )}
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="flex min-w-max gap-2">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-xl px-4 py-3 text-sm font-bold ${
                  activeTab === tab ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "Genel Özet" && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.1fr_0.8fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-slate-900">Proje İlerleme Durumu</h2>
                <div className="mt-8 space-y-8">
                  {[
                    ["Proje Tamamlanma", projectKpis.completion],
                    ["Malzeme Temini", projectKpis.materialCompletion],
                    ["Tahsilat Gerçekleşme", projectKpis.collection],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="mb-3 flex items-center justify-between text-sm font-bold text-slate-700">
                        <span>{label}</span>
                        <span>%{value}</span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-800">
                    Proje ilerleme oranları, tamamlanan malzeme, sipariş ve tahsilat verilerine göre hesaplanır.
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-slate-900">Kritik Uyarılar</h2>
                <div className="mt-6 space-y-3">
                  {overviewWarnings.map((warning, index) => (
                    <div key={`${warning.text}-${index}`} className={`flex items-center justify-between rounded-xl border p-4 text-sm font-bold ${overviewWarningClass(warning.tone)}`}>
                      <span>{warning.text}</span>
                      <span>›</span>
                    </div>
                  ))}
                </div>
                <button type="button" className="mt-6 text-sm font-bold text-blue-700 hover:underline" onClick={() => setActiveTab("Malzeme Listesi")}>Tüm uyarıları gör</button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-slate-900">Finans Özeti</h2>
                <div className="mt-6 overflow-hidden rounded-xl border border-slate-100">
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Sözleşme Bedeli</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{formatMoney(totals.contract, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Tahmini Maliyet</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{formatMoney(totals.estimatedBudget, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Gerçekleşen Maliyet</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{formatMoney(totals.actualCost, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Tahsil Edilen</div>
                    <div className="mt-1 text-xl font-black text-emerald-700">{formatMoney(totals.paidTotal, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Kalan Tahsilat</div>
                    <div className="mt-1 text-xl font-black text-blue-700">{formatMoney(totals.remainingCollection, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Malzeme Maliyeti</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{formatMoney(totals.materialCost, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Sipariş Toplamı</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{formatMoney(totals.orderTotal, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Stok Hareket Değeri</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{formatMoney(totals.stockCost, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Ek Giderler</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{formatMoney(totals.expenseTotal, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Revizyon Gelir / Maliyet</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{formatMoney(totals.revisionRevenue, projectCurrencyForDisplay())} / {formatMoney(totals.revisionCost, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Toplam Maliyet</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{formatMoney(totals.totalCost, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-xs font-bold text-slate-500">Net Kâr / Zarar</div>
                    <div className={`mt-1 text-xl font-black ${totals.netProfitLoss >= 0 ? "text-emerald-700" : "text-red-600"}`}>{formatMoney(totals.netProfitLoss, projectCurrencyForDisplay())}</div>
                  </div>
                  <div className="p-4">
                    <div className="text-xs font-bold text-slate-500">Bütçe Sapması</div>
                    <div className={`mt-1 text-xl font-black ${totals.budgetVariance > 0 ? "text-red-600" : "text-emerald-700"}`}>{formatMoney(totals.budgetVariance, projectCurrencyForDisplay())}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-slate-900">Ek Gider Ekle</h2>
                <form onSubmit={addExpense} className="mt-5 space-y-4">
                  <select
                    value={expenseForm.expense_type}
                    onChange={(event) => updateExpenseForm("expense_type", event.target.value)}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold"
                  >
                    {expenseTypes.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={expenseForm.amount}
                      onChange={(event) => updateExpenseForm("amount", event.target.value)}
                      placeholder="Tutar"
                      className="rounded-xl border border-slate-200 p-3 text-sm font-semibold"
                    />
                    <select
                      value={expenseForm.currency}
                      onChange={(event) => {
                        const currency = event.target.value;
                        updateExpenseForm("currency", currency);
                        updateExpenseForm("exchange_rate", getExchangeRate(currency, companySettings));
                      }}
                      className="rounded-xl border border-slate-200 p-3 text-sm font-semibold"
                    >
                      {currencyOptions.map((currency) => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={expenseForm.exchange_rate}
                      onChange={(event) => updateExpenseForm("exchange_rate", event.target.value)}
                      placeholder="Kur"
                      className="rounded-xl border border-slate-200 p-3 text-sm font-semibold"
                    />
                  </div>
                  <input
                    type="date"
                    value={expenseForm.expense_date}
                    onChange={(event) => updateExpenseForm("expense_date", event.target.value)}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold"
                  />
                  <textarea
                    value={expenseForm.description}
                    onChange={(event) => updateExpenseForm("description", event.target.value)}
                    placeholder="Açıklama"
                    rows={3}
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm font-semibold"
                  />
                  <button type="submit" className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700">
                    Ek Gider Ekle
                  </button>
                </form>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-black text-slate-900">Ek Giderler</h2>
                    <p className="mt-1 text-sm text-slate-500">Toplam: {formatMoney(totals.expenseTotal, projectCurrencyForDisplay())}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{expenses.length} kayıt</span>
                </div>
                <div className="mt-5 space-y-3">
                  {expenses.map((expense) => (
                    <div key={expense.id} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-100 p-4 md:grid-cols-[1fr_auto] md:items-center">
                      <div>
                        <div className="font-black text-slate-900">{expense.expense_type || "Diğer"}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {formatDate(expense.expense_date)} · {expense.description || "Açıklama yok"}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="font-black text-slate-950">{formatMoney(expense.base_amount || expense.amount)}</div>
                          <div className="text-xs font-semibold text-slate-500">
                            {Number(expense.amount || 0).toLocaleString("tr-TR")} {expense.currency || "TRY"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteExpense(expense)}
                          className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  ))}
                  {expenses.length === 0 && (
                    <div className="rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                      Bu proje için ek gider kaydı yok.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-black text-slate-900">Son Siparişler</h2>
                  <button type="button" onClick={() => setActiveTab("Siparişler")} className="text-sm font-bold text-blue-700 hover:underline">Tümünü gör</button>
                </div>
                <div className="mt-5 overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                      <tr>
                        <th className="p-3">Sipariş No</th>
                        <th className="p-3">Tedarikçi</th>
                        <th className="p-3">Tutar</th>
                        <th className="p-3">Durum</th>
                        <th className="p-3">Tarih</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentProjectOrders.map((order) => (
                        <tr key={order.id} className="border-t border-slate-100">
                          <td className="p-3 font-bold text-slate-900">{order.order_no || order.siparis_no || order.id?.slice?.(0, 8) || "-"}</td>
                          <td className="p-3 text-slate-700">{order.partner_name || order.supplier_name || order.supplier || order.firma || "-"}</td>
                          <td className="p-3 font-bold text-slate-900">{formatMoney(overviewOrderAmount(order))}</td>
                          <td className="p-3"><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{order.status || "Bekliyor"}</span></td>
                          <td className="p-3 text-slate-600">{formatDate(order.created_at || order.order_date)}</td>
                        </tr>
                      ))}
                      {recentProjectOrders.length === 0 && (
                        <tr><td colSpan={5} className="p-4 text-center text-sm text-slate-500">Henüz sipariş yok.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-black text-slate-900">Tahsilat Özeti</h2>
                <div className="mt-8 flex flex-col items-center gap-6 md:flex-row md:justify-center">
                  <div className="flex h-44 w-44 items-center justify-center rounded-full" style={{ background: `conic-gradient(#2563eb ${Math.min(100, Math.max(0, projectKpis.collection))}%, #e8eefc 0)` }}>
                    <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white shadow-sm">
                      <div className="text-3xl font-black text-slate-950">%{projectKpis.collection}</div>
                      <div className="text-xs font-bold text-slate-500">Tahsilat Oranı</div>
                    </div>
                  </div>
                  <div className="space-y-4 text-sm">
                    <div><span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500" />Tahsil Edilen <div className="ml-5 font-black text-slate-900">{formatMoney(totals.paidTotal, projectCurrencyForDisplay())}</div></div>
                    <div><span className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-600" />Kalan Tahsilat <div className="ml-5 font-black text-slate-900">{formatMoney(totals.remainingCollection, projectCurrencyForDisplay())}</div></div>
                  </div>
                </div>
                <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Tahsilat planına göre ilerleme oranı %{projectKpis.collection}.</div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-black text-slate-900">Ana Kalem Durum Takibi</h2>
                <button type="button" onClick={() => setActiveTab("Malzeme Listesi")} className="text-sm font-bold text-blue-700 hover:underline">Tümünü gör</button>
              </div>
              <div className="mt-5 overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                    <tr>
                      <th className="p-3">Ana Kalem Kodu</th>
                      <th className="p-3">Ana Kalem Adı</th>
                      <th className="p-3">Tamamlanma</th>
                      <th className="p-3">Eksik Malzeme</th>
                      <th className="p-3">İşlenen</th>
                      <th className="p-3">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parentItems.map((item) => {
                      const stats = mainItemStats(item, childItemsByParent);
                      const status = overviewStatusForMainItem(stats);
                      return (
                        <tr key={item.id} className="border-t border-slate-100">
                          <td className="p-3 font-black text-slate-900">{item.product_code || "-"}</td>
                          <td className="p-3 font-bold text-slate-800">{item.product_name}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-3">
                              <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${stats.completion}%` }} /></div>
                              <span className="text-xs font-bold text-slate-600">%{stats.completion}</span>
                            </div>
                          </td>
                          <td className="p-3 font-bold text-slate-900">{stats.missing}</td>
                          <td className="p-3 font-bold text-slate-900">{stats.inProgress}</td>
                          <td className="p-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>{status.text}</span></td>
                        </tr>
                      );
                    })}
                    {parentItems.length === 0 && (
                      <tr><td colSpan={6} className="p-4 text-center text-sm text-slate-500">Henüz ana kalem yok.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
        {activeTab === "Malzeme Listesi" && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-1">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-bold text-slate-900">Excel / PDF / Görselden Ürünleri Yükle</h2>
                <p className="mt-2 text-sm text-slate-500">Dosyadan okunan satırlar önce önizlemeye alınır, kontrol ettikten sonra projeye aktarılır.</p>
                <input
                  type="file"
                  multiple
                  accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.ods,.pdf,.png,.jpg,.jpeg,.webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12,text/csv"
                  onChange={parseProjectItemFiles}
                  className="mt-5 w-full rounded-xl border border-dashed border-blue-300 bg-blue-50 p-4 text-sm"
                />
                {previewWarnings.length > 0 && (
                  <div className={`mt-4 rounded-xl border p-4 text-sm ${previewBlocked ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                    <div className="font-bold">{previewBlocked ? "Aktarım kilitlendi" : "Fiyatlandırma notu"}</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {previewWarnings.slice(0, 6).map((warning, index) => (
                        <li key={`${index}-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                    {previewWarnings.length > 6 && (
                      <div className="mt-2 text-xs font-bold">
                        +{previewWarnings.length - 6} ek kontrol uyarısı var.
                      </div>
                    )}
                  </div>
                )}
                {visiblePreviewSections.length > 0 && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <div className="font-bold">Kategori toplamları ürün olarak aktarılmayacak</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {visiblePreviewSections.map((section) => (
                        <span key={`${section.section_name}-${section.section_total}`} className="rounded-full bg-white px-3 py-1 text-xs font-bold">
                          {section.section_name}: {formatMoney(section.section_total)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {previewRows.length > 0 && (
                  <div ref={previewResultsRef} className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-lg font-black text-slate-900">Okunan Ürünleri Kontrol Et</h3>
                        <p className="mt-1 text-sm text-slate-500">Ürünler kategori/ana kalem bilgisine göre gruplandı. Kontrol edip seçili satırları projeye aktarabilirsiniz.</p>
                      </div>
                      <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                        {selectedPreviewRows.length} / {previewRows.length} seçili
                      </div>
                    </div>

                    {previewLooksLikeFlatMainList && (
                      <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-900">
                        Bu dosyada alt kalem ilişkisi bulunamadı. Ürünleri bağımsız ana kalem olarak aktarabilirsiniz.
                      </div>
                    )}

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_auto_auto] md:items-center">
                      <input
                        value={previewSearch}
                        onChange={(event) => setPreviewSearch(event.target.value)}
                        placeholder="Ürün, kod, marka veya kategori ara..."
                        className="rounded-xl border border-slate-300 p-3 text-sm"
                      />
                      <select
                        value={previewCategoryFilter}
                        onChange={(event) => setPreviewCategoryFilter(event.target.value)}
                        className="rounded-xl border border-slate-300 p-3 text-sm"
                      >
                        <option value="">Tüm kategoriler</option>
                        {previewCategories.map((category) => (
                          <option key={category} value={category}>{category}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                        <input
                          type="checkbox"
                          checked={allFilteredPreviewRowsSelected}
                          onChange={toggleAllFilteredPreviewRows}
                          className="h-4 w-4"
                        />
                        Tümünü seç
                      </label>
                      <button
                        type="button"
                        disabled={selectedPreviewRows.length === 0}
                        onClick={deleteSelectedPreviewRows}
                        className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700 hover:bg-red-100 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        Seçilenleri Sil
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_auto_auto_auto_auto_auto] xl:items-center">
                      <select
                        className="rounded-xl border border-slate-300 p-3 text-sm"
                        value={previewParentId}
                        onChange={(event) => setPreviewParentId(event.target.value)}
                      >
                        <option value="">Bağlanacak ana kalemi seç</option>
                        {parentItems.map((item) => (
                          <option key={item.id} value={item.id}>{item.product_name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={isImportingPreview || selectedPreviewRows.length === 0}
                        onClick={importSelectedPreviewRowsStandalone}
                        className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-300"
                      >
                        Seçilileri Bağımsız Aktar
                      </button>
                      <button
                        type="button"
                        disabled={isImportingPreview || previewRows.length === 0}
                        onClick={importSelectedPreviewRowsAsMainItems}
                        className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:bg-slate-300"
                      >
                        Bağımsız Ana Kalem Olarak Aktar
                      </button>
                      <button
                        type="button"
                        disabled={isImportingPreview || selectedPreviewRows.length === 0 || !previewParentId}
                        onClick={attachSelectedPreviewRowsToParent}
                        className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300"
                      >
                        Seçilileri Ana Kaleme Bağla
                      </button>
                      <button
                        type="button"
                        disabled={isImportingPreview || selectedPreviewRows.length === 0}
                        onClick={openCreateParentFromSelectionModal}
                        className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-white hover:bg-amber-600 disabled:bg-slate-300"
                      >
                        Seçiliden Ana Kalem Oluştur
                      </button>
                      <button
                        type="button"
                        disabled={isImportingPreview || previewRows.length === 0}
                        onClick={importGroupedPreviewRows}
                        className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                      >
                        {isImportingPreview ? "Aktarılıyor..." : "Hiyerarşik Aktar"}
                      </button>
                    </div>

                    {createParentModalOpen && (
                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <h4 className="text-base font-black text-slate-950">Hangi satır ana kalem olacak?</h4>
                            <p className="mt-1 text-sm text-slate-600">
                              Seçtiğiniz tek satır ana kalem yapılır. Diğer {Math.max(selectedPreviewRows.length - 1, 0)} seçili satır bu ana kalemin alt kalemi olur.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={closeCreateParentModal}
                            className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                          >
                            Kapat
                          </button>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr_180px]">
                          <select
                            value={createParentSourceRowId}
                            onChange={(event) => {
                              const row = selectedPreviewRows.find((previewRow) => previewRow.preview_id === event.target.value);
                              setCreateParentSourceRowId(event.target.value);
                              if (row) {
                                setCreateParentNameDraft(row.product_name || previewRowCategory(row) || "Yeni ana kalem");
                                setCreateParentQuantityDraft(String(row.section_quantity || row.estimated_quantity || ""));
                              }
                            }}
                            className="rounded-xl border border-amber-200 bg-white p-3 text-sm font-semibold"
                          >
                            {selectedPreviewRows.map((row) => (
                              <option key={row.preview_id} value={row.preview_id}>
                                {row.product_name || row.product_code || "İsimsiz satır"}
                              </option>
                            ))}
                          </select>
                          <input
                            value={createParentNameDraft}
                            onChange={(event) => setCreateParentNameDraft(event.target.value)}
                            placeholder="Ana kalem adı"
                            className="rounded-xl border border-amber-200 bg-white p-3 text-sm font-semibold"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={createParentQuantityDraft}
                            onChange={(event) => setCreateParentQuantityDraft(event.target.value)}
                            placeholder="Ana kalem miktarı"
                            className="rounded-xl border border-amber-200 bg-white p-3 text-sm font-semibold"
                          />
                        </div>

                        <div className="mt-4 rounded-xl bg-white p-3 text-xs text-slate-700">
                          <div className="font-black text-slate-900">İşlem özeti</div>
                          <div className="mt-1">
                            Ana kalem: {createParentNameDraft || "-"} · Miktar: {createParentQuantityDraft || "-"} · Alt kalem: {Math.max(selectedPreviewRows.length - 1, 0)}
                          </div>
                          <div className="mt-2 space-y-1">
                            {selectedPreviewRows
                              .filter((row) => row.preview_id !== createParentSourceRowId)
                              .slice(0, 5)
                              .map((row) => {
                                const parentQuantity = Number(String(createParentQuantityDraft || "").replace(",", "."));
                                const totalQuantity = Number(row.estimated_quantity || 0);
                                const perParent = parentQuantity > 0 ? totalQuantity / parentQuantity : 0;
                                return (
                                  <div key={row.preview_id}>
                                    {row.product_name}: toplam {formatQuantity(totalQuantity)} / ana kalem {formatQuantity(parentQuantity)} = birim kullanım {formatQuantity(perParent)}
                                  </div>
                                );
                              })}
                            {selectedPreviewRows.length > 6 && (
                              <div className="font-bold text-slate-500">+{selectedPreviewRows.length - 6} alt kalem daha</div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                          <button
                            type="button"
                            onClick={closeCreateParentModal}
                            className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100"
                          >
                            Vazgeç
                          </button>
                          <button
                            type="button"
                            disabled={isImportingPreview || !createParentSourceRowId || !createParentQuantityDraft}
                            onClick={confirmCreateParentFromSelectedPreviewRows}
                            className="rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white hover:bg-amber-700 disabled:bg-slate-300"
                          >
                            Ana Kalemi Oluştur ve Bağla
                          </button>
                        </div>
                      </div>
                    )}

                    {previewActionMessage && (
                      <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900" aria-live="polite">
                        {previewActionMessage}
                      </div>
                    )}

                    <div className="mt-5 space-y-4">
                      {Object.entries(groupedPreviewRows).map(([category, rows]) => (
                        <div key={category} className="rounded-2xl border border-slate-200">
                          <div className="flex items-center justify-between rounded-t-2xl bg-slate-50 px-4 py-3">
                            <div className="font-black text-slate-900">{category}</div>
                            <div className="text-xs font-bold text-slate-500">{rows.length} ürün</div>
                          </div>
                          <div className="divide-y divide-slate-100">
                            {rows.map((row) => {
                              const isEditing = editingPreviewRowId === row.preview_id;
                              return (
                                <div key={row.preview_id} className="grid grid-cols-1 gap-3 p-4 text-sm md:grid-cols-[auto_1fr_auto_auto_auto] md:items-center">
                                  <input
                                    type="checkbox"
                                    checked={selectedPreviewRowIds.includes(row.preview_id)}
                                    onChange={() => togglePreviewRow(row.preview_id)}
                                    className="h-4 w-4"
                                  />
                                  <div className="min-w-0">
                                    {isEditing ? (
                                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                        <input className="rounded-lg border border-slate-200 p-2" value={row.product_name || ""} onChange={(event) => updatePreviewRow(row.preview_id, "product_name", event.target.value)} />
                                        <input className="rounded-lg border border-slate-200 p-2" value={row.product_code || ""} onChange={(event) => updatePreviewRow(row.preview_id, "product_code", event.target.value)} />
                                        <input className="rounded-lg border border-slate-200 p-2" value={row.brand || ""} onChange={(event) => updatePreviewRow(row.preview_id, "brand", event.target.value)} placeholder="Marka" />
                                        <input className="rounded-lg border border-slate-200 p-2" value={row.unit || ""} onChange={(event) => updatePreviewRow(row.preview_id, "unit", event.target.value)} placeholder="Birim" />
                                      </div>
                                    ) : (
                                      <>
                                        <div className="font-black text-slate-900">{row.product_name}</div>
                                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                                          <span>Kod: {row.product_code || "-"}</span>
                                          {row.brand && <span>Marka: {row.brand}</span>}
                                          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-700">{category}</span>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 text-xs md:w-44">
                                    <input type="number" disabled={!isEditing} className="rounded-lg border border-slate-200 p-2 disabled:bg-transparent" value={row.estimated_quantity || ""} onChange={(event) => updatePreviewRow(row.preview_id, "estimated_quantity", event.target.value)} />
                                    <input disabled={!isEditing} className="rounded-lg border border-slate-200 p-2 disabled:bg-transparent" value={row.unit || "adet"} onChange={(event) => updatePreviewRow(row.preview_id, "unit", event.target.value)} />
                                  </div>
                                  <div className="text-xs font-bold text-slate-700 md:w-32">
                                    {isEditing ? (
                                      <input
                                        type="number"
                                        className="mb-2 w-full rounded-lg border border-slate-200 p-2"
                                        value={row.estimated_unit_price || ""}
                                        onChange={(event) => updatePreviewRow(row.preview_id, "estimated_unit_price", event.target.value)}
                                      />
                                    ) : (
                                      <div>{formatMoney(row.estimated_unit_price, projectCurrencyForDisplay())}</div>
                                    )}
                                    <div className="text-slate-500">{formatMoney(row.estimated_total, projectCurrencyForDisplay())}</div>
                                  </div>
                                  <div className="flex gap-2">
                                    <button type="button" onClick={() => setEditingPreviewRowId(isEditing ? "" : row.preview_id)} className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                                      {isEditing ? "Tamam" : "Düzenle"}
                                    </button>
                                    <button type="button" onClick={() => deletePreviewRow(row.preview_id)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                                      Sil
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {filteredPreviewRows.length === 0 && (
                        <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Filtreye uygun ürün yok.</div>
                      )}
                    </div>
                  </div>
                )}

                {(rawItems.length > 0 || suggestedHierarchyGroups.length > 0) && (
                  <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <summary className="cursor-pointer text-sm font-black text-slate-700">Gelişmiş teknik detaylar</summary>
                    <div className="mt-4">
                {rawItems.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                    <div>
                      <h3 className="text-lg font-black text-slate-900">Ham Verilerin Okunması</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Dosyadan okunan standart raw_items satırları. Bu tablo sadece kontrol içindir; mevcut projeye aktarma akışı aşağıdaki önizleme tablosuyla aynı şekilde devam eder.
                      </p>
                    </div>

                    <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-blue-100 bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="p-3">Satır</th>
                            <th className="p-3">Dosya</th>
                            <th className="p-3">Tip</th>
                            <th className="p-3">Kod</th>
                            <th className="p-3">Marka</th>
                            <th className="p-3">Açıklama</th>
                            <th className="p-3">Miktar</th>
                            <th className="p-3">Birim</th>
                            <th className="p-3">Birim Fiyat</th>
                            <th className="p-3">Tutar</th>
                            <th className="p-3">Para</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rawItems.map((row, index) => (
                            <tr key={row.id || index} className="border-t border-slate-100">
                              <td className="p-3 font-bold text-slate-700">#{row.row_index || index + 1}</td>
                              <td className="p-3 text-slate-500">{row.source_file || "-"}</td>
                              <td className="p-3 text-slate-500">{row.source_type || "-"}</td>
                              <td className="p-3 font-semibold text-slate-700">{row.product_code || "-"}</td>
                              <td className="p-3 text-slate-600">{row.brand || "-"}</td>
                              <td className="p-3 font-bold text-slate-900">{row.description || "-"}</td>
                              <td className="p-3">{row.quantity || "-"}</td>
                              <td className="p-3">{row.unit || "-"}</td>
                              <td className="p-3">{formatMoney(row.unit_price, projectCurrencyForDisplay(row.currency))}</td>
                              <td className="p-3 font-bold">{formatMoney(row.total, projectCurrencyForDisplay(row.currency))}</td>
                              <td className="p-3">{projectCurrencyForDisplay(row.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {false && mainProductCandidates.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-lg font-black text-slate-900">Devre dışı teknik öneriler</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          Bunlar sistemin raw_items \u00fczerinden \u00fcretti\u011fi sekt\u00f6r ba\u011f\u0131ms\u0131z \u00f6nerilerdir. \u015eimdilik sadece se\u00e7im yap\u0131l\u0131r, kay\u0131t/hiyerar\u015fi olu\u015fturulmaz.
                        </p>
                      </div>
                      <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                        {selectedCandidateIds.length} seçildi
                      </div>
                    </div>

                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        disabled={selectedCandidateIds.length === 0 || isSuggestingHierarchy}
                        onClick={suggestProductHierarchy}
                        className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-300"
                      >
                        {isSuggestingHierarchy ? "Öneri hazırlanıyor..." : "Alt Ürünleri Öner"}
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {mainProductCandidates.map((candidate) => (
                        <label key={candidate.id} className="flex cursor-pointer gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 hover:bg-blue-50">
                          <input
                            type="checkbox"
                            checked={selectedCandidateIds.includes(candidate.id)}
                            onChange={() => toggleMainProductCandidate(candidate.id)}
                            className="mt-1 h-4 w-4"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <div>
                                <div className="font-black text-slate-900">{candidate.title}</div>
                                <div className="mt-1 text-xs text-slate-500">Raw satır: {candidate.raw_item_id}</div>
                              </div>
                              <div className="text-sm font-bold text-slate-700">
                                {formatMoney(candidate.estimated_total, projectCurrencyForDisplay())}
                              </div>
                            </div>
                            <div className="mt-3 flex items-center gap-3">
                              <div className="h-2 flex-1 rounded-full bg-slate-200">
                                <div
                                  className="h-2 rounded-full bg-blue-600"
                                  style={{ width: `${Math.min(100, Math.max(0, candidate.confidence_score || 0))}%` }}
                                />
                              </div>
                              <div className="w-16 text-right text-xs font-black text-blue-700">
                                %{candidate.confidence_score || 0}
                              </div>
                            </div>
                            {candidate.reasons?.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {candidate.reasons.map((reason) => (
                                  <span key={reason} className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-slate-600">
                                    {reason}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {suggestedHierarchyGroups.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                    <div>
                      <h3 className="text-lg font-black text-slate-900">Alt Ürün Eşleştirme Önerisi</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Bu liste sistem önerisidir. Alt ürünleri taşıyabilir, çıkarabilir veya yeni ana ürün yapabilirsiniz. Henüz Supabase kaydı yapılmaz.
                      </p>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={saveSuggestedHierarchyToProject}
                        className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700"
                      >
                        Hiyerarşiyi Projeye Kaydet
                      </button>
                    </div>
                    <div className="mt-4 space-y-4">
                      {suggestedHierarchyGroups.map((group) => (
                        <div key={group.id} className="rounded-xl border border-emerald-100 bg-white p-4">
                          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="font-black text-slate-900">{group.main_product?.title || "Ana ürün"}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                Raw: {group.main_product?.raw_item_id || "-"} · {group.sub_items?.length || 0} önerilen alt ürün
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-emerald-700">{formatMoney(group.main_product?.estimated_total, projectCurrencyForDisplay())}</div>
                              <div className="text-xs font-black text-blue-700">Öneri skoru %{group.suggestion_score || 0}</div>
                              <button
                                type="button"
                                onClick={() => removeSuggestedGroup(group.id)}
                                className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                              >
                                Ana grubu sil
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-col gap-2 rounded-xl bg-emerald-50 p-3 md:flex-row md:items-center">
                            <select
                              className="flex-1 rounded-lg border border-emerald-100 bg-white p-2 text-xs font-semibold"
                              defaultValue=""
                              onChange={(event) => {
                                addRawItemToSuggestedGroup(group.id, event.target.value);
                                event.target.value = "";
                              }}
                            >
                              <option value="">Raw satırdan alt ürün ekle</option>
                              {rawItems.map((rawItem) => (
                                <option key={`${group.id}-raw-${rawItem.id}`} value={rawItem.id}>
                                  #{rawItem.row_index || rawItem.id} - {rawItem.description || rawItem.product_code || "-"}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-100">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                  <th className="p-3">Alt Ürün</th>
                                  <th className="p-3">Miktar</th>
                                  <th className="p-3">Tutar</th>
                                  <th className="p-3">Skor</th>
                                  <th className="p-3">Sebep</th>
                                  <th className="p-3">İşlem</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(group.sub_items || []).map((item) => (
                                  <tr key={`${group.id}-${item.raw_item_id}`} className="border-t border-slate-100">
                                    <td className="p-3">
                                      <div className="font-bold text-slate-900">{item.title}</div>
                                      <div className="text-slate-500">{item.product_code || "-"} · {item.brand || "-"}</div>
                                    </td>
                                    <td className="p-3">{item.quantity || "-"} {item.unit || ""}</td>
                                    <td className="p-3 font-bold">{formatMoney(item.total, item.currency || "TRY")}</td>
                                    <td className="p-3 font-black text-blue-700">%{item.suggestion_score || 0}</td>
                                    <td className="p-3 text-slate-500">{(item.reasons || []).join(", ") || "-"}</td>
                                    <td className="p-3">
                                      <div className="flex flex-col gap-2">
                                        <select
                                          value={group.id}
                                          onChange={(event) => moveSuggestedSubItem(group.id, item.raw_item_id, event.target.value)}
                                          className="rounded-lg border border-slate-200 p-2 text-xs"
                                        >
                                          {suggestedHierarchyGroups.map((targetGroup) => (
                                            <option key={`${item.raw_item_id}-${targetGroup.id}`} value={targetGroup.id}>
                                              {targetGroup.main_product?.title || "Ana ürün"}
                                            </option>
                                          ))}
                                        </select>
                                        <div className="flex gap-2">
                                          <button
                                            type="button"
                                            onClick={() => promoteSuggestedSubItem(group.id, item.raw_item_id)}
                                            className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700"
                                          >
                                            Ana yap
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => removeSuggestedSubItem(group.id, item.raw_item_id)}
                                            className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700"
                                          >
                                            Çıkar
                                          </button>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                                {(group.sub_items || []).length === 0 && (
                                  <tr>
                                    <td colSpan={6} className="p-4 text-sm text-slate-500">Bu ana ürün için önerilen alt ürün yok.</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                    </div>
                  </details>
                )}
                {false && rawItems.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-lg font-black text-slate-900">Ana ürünleri seçiniz</h3>
                        <p className="mt-1 text-sm text-slate-600">
                          Sistem sadece \u00f6neri \u00fcretir; toplam fiyat, grup ba\u015fl\u0131\u011f\u0131 g\u00f6r\u00fcn\u00fcm\u00fc, k\u0131sa a\u00e7\u0131klama, d\u00fc\u015f\u00fck adet ve \u00e7evresindeki \u00fcr\u00fcn yo\u011funlu\u011fu gibi genel sinyalleri kullan\u0131r. Son karar\u0131 siz verirsiniz.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={selectedMainRawIds.length === 0}
                        onClick={buildHierarchyFromRaw}
                        className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300"
                      >
                        Ana Ürünleri Onayla ({selectedMainRawIds.length})
                      </button>
                    </div>

                    <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-blue-100 bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr>
                            <th className="p-3">Ana</th>
                            <th className="p-3">Satır</th>
                            <th className="p-3">Ürün</th>
                            <th className="p-3">Miktar</th>
                            <th className="p-3">Toplam</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rawItems.map((row, index) => (
                            <tr key={row.id || index} className="border-t border-slate-100">
                              <td className="p-3">
                                <input
                                  type="checkbox"
                                  checked={selectedMainRawIds.includes(row.id)}
                                  onChange={() => toggleMainRawItem(row.id)}
                                  className="h-4 w-4"
                                />
                              </td>
                              <td className="p-3 text-slate-500">#{index + 1}</td>
                              <td className="p-3">
                                <div className="font-bold text-slate-900">{row.product_name || "-"}</div>
                                <div className="text-slate-500">
                                  {row.product_code || "-"} {row.main_product_candidate ? `· aday puanı ${row.candidate_score || 0}` : ""}
                                </div>
                                {row.candidate_reasons?.length > 0 && (
                                  <div className="mt-1 text-[11px] font-semibold text-blue-700">
                                    {row.candidate_reasons.join(", ")}
                                  </div>
                                )}
                              </td>
                              <td className="p-3">{row.estimated_quantity || "-"} {row.unit || ""}</td>
                              <td className="p-3 font-bold">{formatMoney(row.estimated_total, projectCurrencyForDisplay())}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {false && hierarchyGroups.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-lg font-black text-slate-900">Ana ürün + alt ürün hiyerarşisi</h3>
                        <p className="mt-1 text-sm text-slate-600">Alt ürünleri başka ana ürüne taşıyabilir, silebilir veya yeni ana ürün yapabilirsiniz.</p>
                      </div>
                      <button
                        type="button"
                        onClick={importHierarchyGroups}
                        className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700"
                      >
                        Hiyerarşiyi Projeye Aktar
                      </button>
                    </div>
                    <div className="mt-4 space-y-4">
                      {hierarchyGroups.map((group) => (
                        <div key={group.id} className="rounded-xl border border-emerald-100 bg-white p-4">
                          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="font-black text-slate-900">{group.main.product_name}</div>
                              <div className="text-xs text-slate-500">{group.main.product_code || "-"} · {group.subItems.length} alt ürün</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="font-bold text-emerald-700">{formatMoney(group.main.estimated_total, projectCurrencyForDisplay())}</div>
                              <button type="button" onClick={() => removeMainGroup(group.id)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                                Ana ürünü sil
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 space-y-2">
                            {group.subItems.map((item) => (
                              <div key={item.id} className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-3 text-xs md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                                <div>
                                  <div className="font-bold text-slate-900">{item.product_name}</div>
                                  <div className="text-slate-500">{item.product_code || "-"} · {item.estimated_quantity} {item.unit || "adet"}</div>
                                </div>
                                <select
                                  value={group.id}
                                  onChange={(e) => moveSubItem(item.id, e.target.value)}
                                  className="rounded-lg border border-slate-200 p-2"
                                >
                                  {hierarchyGroups.map((target) => (
                                    <option key={target.id} value={target.id}>{target.main.product_name}</option>
                                  ))}
                                </select>
                                <button type="button" onClick={() => promoteSubItem(item.id)} className="rounded-lg bg-blue-50 px-3 py-2 font-bold text-blue-700">
                                  Ana ürün yap
                                </button>
                                <button type="button" onClick={() => removeSubItem(item.id)} className="rounded-lg bg-red-50 px-3 py-2 font-bold text-red-700">
                                  Sil
                                </button>
                              </div>
                            ))}
                            {group.subItems.length === 0 && <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Alt ürün yok.</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {false && (
                <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
                  <select className="rounded-xl border border-slate-300 p-3 text-sm" value={previewParentId} onChange={(e) => setPreviewParentId(e.target.value)}>
                    <option value="">Aktarırken ana ürün olarak ekle</option>
                    {parentItems.map((item) => (
                      <option key={item.id} value={item.id}>{item.product_name} altına aktar</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={previewRows.length === 0 || isParsing || previewBlocked}
                    onClick={importPreviewRows}
                    className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-300"
                  >
                    {isParsing ? "Okunuyor..." : previewBlocked ? "Kontrol Gerekli" : hierarchyGroups.length > 0 ? "Hiyerarşi Bekliyor" : "Düz Liste Olarak Aktar"}
                  </button>
                </div>
                )}
                {false && previewRows.length > 0 && (
                  <div className="mt-5 max-h-80 overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="p-3">Ürün</th>
                          <th className="p-3">Miktar</th>
                          <th className="p-3">Birim Fiyat</th>
                          <th className="p-3">Toplam</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, index) => (
                          <tr key={`${row.product_code}-${index}`} className="border-t border-slate-100">
                            <td className="p-3">
                              <div className="font-bold text-slate-900">{row.product_name}</div>
                              <div className="text-slate-500">{row.product_code || "-"}</div>
                              {row.section_name && (
                                <div className="mt-1 text-[11px] font-bold text-amber-700">
                                  {row.section_name}
                                </div>
                              )}
                            </td>
                            <td className="p-3">{row.estimated_quantity} {row.unit || "adet"}</td>
                            <td className="p-3">
                              {row.price_status === "section_total_only" ? (
                                <span className="text-xs font-bold text-amber-700">Kategori toplamında</span>
                              ) : formatMoney(row.estimated_unit_price, projectCurrencyForDisplay())}
                            </td>
                            <td className="p-3 font-bold">
                              {row.price_status === "section_total_only" ? "-" : formatMoney(row.estimated_total, projectCurrencyForDisplay())}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Malzeme Listesi</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Toplam: {formatMoney(totals.itemEstimate, projectCurrencyForDisplay())} · Satınalma gerekli: {purchaseRequiredItems.length} · Kritik stok: {criticalStockItems.length}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => applyItemStockFilter("purchase")}
                    className={`rounded-xl px-4 py-3 text-sm font-bold ${itemStockFilter === "purchase" ? "bg-red-600 text-white" : "bg-red-50 text-red-700 hover:bg-red-100"}`}
                  >
                    {itemStockFilter === "purchase" ? "Tüm Listeyi Göster" : "Satınalma Gerekenleri Göster"}
                  </button>
                  <button
                    type="button"
                    onClick={() => applyItemStockFilter("critical")}
                    className={`rounded-xl px-4 py-3 text-sm font-bold ${itemStockFilter === "critical" ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100"}`}
                  >
                    {itemStockFilter === "critical" ? "Tüm Listeyi Göster" : "Kritik Stokları Göster"}
                  </button>
                  <button
                    type="button"
                    disabled={purchaseRequiredItems.length === 0}
                    onClick={createRequestFromNeededItems}
                    className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                  >
                    Satınalma Gerekenlerden Talep Oluştur
                  </button>
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={allProjectItemsSelected}
                      disabled={items.length === 0}
                      onChange={toggleAllProjectItemsSelection}
                      className="h-4 w-4"
                    />
                    Tümünü Seç
                  </label>
                  <span className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">
                    {selectedProjectItemDeleteIds.length} seçili
                  </span>
                  <button
                    type="button"
                    disabled={selectedProjectItemDeleteIds.length === 0}
                    onClick={deleteSelectedProjectItems}
                    className="rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:bg-slate-300"
                  >
                    Seçilenleri Sil
                  </button>
                </div>
                <button
                  type="button"
                  disabled={selectedPurchaseItemIds.length === 0}
                  onClick={createRequestFromSelectedItems}
                  className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-300"
                >
                  Seçilenlerden Talep Oluştur ({selectedPurchaseItemIds.length})
                </button>
                <button
                  type="button"
                  disabled={selectedPurchaseItemIds.length === 0}
                  onClick={transferSelectedItemsToStock}
                  className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                >
                  Seçilenleri Stoğa Aktar ({selectedPurchaseItemIds.length})
                </button>
              </div>

              {itemStockFilter !== "all" && (
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-black">
                      {itemStockFilter === "purchase" ? "Satınalma gerekenler filtresi aktif" : "Kritik stok filtresi aktif"}
                    </div>
                    <div className="mt-1 text-xs font-semibold">
                      {activeStockFilterCount} kalem, {visibleParentItems.length} ana ürün altında gösteriliyor. Eşleşen ana ürünlerin alt malzemeleri otomatik açıldı.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyItemStockFilter(itemStockFilter)}
                    className="rounded-lg bg-white px-4 py-2 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-100"
                  >
                    Filtreyi temizle
                  </button>
                </div>
              )}

              <div className="mt-5 space-y-3">
                {visibleParentItems.map((item) => {
                  const allChildren = childItemsByParent[item.id] || [];
                  const parentProcess = parentProcessInfo(item);
                  const children = itemStockFilter === "all"
                    ? allChildren
                    : allChildren.filter(itemMatchesStockFilter);
                  const stock = stockWarning(item);
                  const stockInfo = stockInfoForItem(item);
                  const itemPrice = resolveProjectItemPrice(item);
                  const quoteTotal = sectionQuoteTotalFor(item.product_name, Number(item.quote_total || item.estimated_total || 0) || 0);
                  const childResolvedTotal = allChildren.reduce((sum, child) => sum + resolveProjectItemPrice(child).total, 0);
                  const itemDifference = quoteTotal - childResolvedTotal;
                  const priceLivesOnParent = allChildren.length > 0 && quoteTotal > 0 && childResolvedTotal === 0;

                  return (
                    <div key={item.id} className="rounded-2xl border border-slate-200">
                      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selectedProjectItemIds.includes(item.id)}
                            onChange={() => toggleProjectItemSelection(item.id)}
                            title="Silmek için seç"
                            className="mt-1 h-4 w-4"
                          />
                          {item.status === "Satınalma gerekli" && !stockInfo.isMainItem && (
                            <input
                              type="checkbox"
                              checked={selectedPurchaseItemIds.includes(item.id)}
                              onChange={() => togglePurchaseItem(item.id)}
                              className="mt-1 h-4 w-4"
                            />
                          )}
                          <div>
                            <div className="font-black text-slate-900">{item.product_name}</div>
                            <div className="text-xs text-slate-500">{item.product_code || "-"} · {Number(item.estimated_quantity || 0)} {item.unit || "adet"}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold">
                              {productCardLabel(item) && (
                                <span className={`rounded-full px-2 py-1 ${productCardLabelClass(item)}`}>{productCardLabel(item)}</span>
                              )}
                              <span className="text-emerald-700">Teklif bedeli: {formatMoney(quoteTotal)}</span>
                              {priceLivesOnParent ? (
                                <span className="text-amber-700">Parça fiyatı yok; bedel ana toplamda</span>
                              ) : (
                                <>
                                  <span className="text-blue-700">Alt malzeme toplamı: {formatMoney(childResolvedTotal)}</span>
                                  <span className={itemDifference >= 0 ? "text-emerald-700" : "text-red-700"}>Fark: {formatMoney(itemDifference)}</span>
                                </>
                              )}
                              <span className={`rounded-full px-2 py-1 ${priceSourceClass(itemPrice.source)}`}>{itemPrice.source}</span>
                            </div>
                            {stockInfo.isMainItem ? (
                              <div className="mt-2 space-y-2 text-xs font-bold text-slate-600">
                                <div>
                                  Alt kalem: {allChildren.length} bileşen · Toplam ana kalem: {formatQuantity(parentProcess.parentQuantity)} {item.unit || "adet"} · İşlenen: {formatQuantity(parentProcess.producedParentQuantity)} · Kalan: {formatQuantity(parentProcess.remainingParentQuantity)}
                                </div>
                                <div className="text-slate-500">
                                  Girilen ana kalem miktarına göre alt kalemlerin kullanılan ve bekleyen miktarları hesaplanır.
                                </div>
                                {allChildren.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <input
                                      type="number"
                                      min="0"
                                      max={parentProcess.remainingParentQuantity}
                                      step="0.01"
                                      value={processQuantityDrafts[item.id] || ""}
                                      onChange={(event) => setProcessQuantityDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                                      className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"
                                      placeholder="Tamamlanan miktar"
                                    />
                                    <button
                                      type="button"
                                      disabled={processingParentId === item.id || parentProcess.remainingParentQuantity <= 0}
                                      onClick={() => processParentItem(item)}
                                      className="rounded-lg bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100 disabled:bg-slate-100 disabled:text-slate-400"
                                    >
                                      {processingParentId === item.id ? "Kaydediliyor..." : "Tamamlanan Miktarı Kaydet"}
                                    </button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="mt-1 text-xs font-bold text-slate-600">
                                Tahmini: {stockInfo.estimatedQuantity} {item.unit || "adet"} · Stok: {stockInfo.stockQuantity} {item.unit || "adet"} · Satınalma gerekli: {stockInfo.requiredQuantity} {item.unit || "adet"}
                              </div>
                            )}
                            {!stockInfo.isMainItem && (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button type="button" onClick={() => updateProjectItemQuantity(item, -1)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                                  -1
                                </button>
                                <button type="button" onClick={() => updateProjectItemQuantity(item, 1)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                                  +1
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={itemPriceDrafts[item.id] ?? item.estimated_unit_price ?? ""}
                                  onChange={(event) => setItemPriceDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))}
                                  className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"
                                  placeholder="Birim fiyat"
                                />
                                <button type="button" onClick={() => updateProjectItemUnitPrice(item)} className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">
                                  Fiyatı Güncelle
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${itemStatusClass(item.status)}`}>{item.status || "Bekliyor"}</span>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                          stock.tone === "green" ? "bg-green-100 text-green-700" :
                          stock.tone === "yellow" ? "bg-yellow-100 text-yellow-700" :
                          stock.tone === "red" ? "bg-red-100 text-red-700" :
                          "bg-slate-100 text-slate-700"
                        }`}>
                          Stok: {stock.available} · {stock.text}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setExpandedItems((prev) => ({ ...prev, [item.id]: !prev[item.id] }))} className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">
                            Alt Malzemeleri Gör / Ekle
                          </button>
                          <button type="button" onClick={() => downloadProjectItemChildren(item, "xlsx")} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
                            Excel indir
                          </button>
                          <button type="button" onClick={() => downloadProjectItemChildren(item, "pdf")} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
                            PDF indir
                          </button>
                          <button type="button" onClick={() => startAddingChildItem(item)} className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100">
                            Malzeme ekle
                          </button>
                          {!stockInfo.isMainItem && stockInfo.stockQuantity > 0 && (
                            <button type="button" onClick={() => coverItemFromStock(item)} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
                              Stoktan Karşıla
                            </button>
                          )}
                          <button type="button" onClick={() => deleteProjectItem(item.id)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100">
                            Sil
                          </button>
                        </div>
                      </div>
                      {expandedItems[item.id] && (
                        <div className="border-t border-slate-100 bg-slate-50 p-4">
                          {children.length === 0 && <div className="text-sm text-slate-500">Alt malzeme yok.</div>}
                          <div className="space-y-2">
                            {children.map((child) => {
                              const childStock = stockWarning(child);
                              const childStockInfo = stockInfoForItem(child);
                              const childPrice = resolveProjectItemPrice(child);
                              const relation = componentRelationForItem(child, items);
                              return (
                                <div key={child.id} className="grid grid-cols-1 gap-3 rounded-xl bg-white p-3 text-sm md:grid-cols-[1fr_auto_auto_auto] md:items-center">
                                  <div className="flex items-start gap-3">
                                    <input
                                      type="checkbox"
                                      checked={selectedProjectItemIds.includes(child.id)}
                                      onChange={() => toggleProjectItemSelection(child.id)}
                                      title="Silmek için seç"
                                      className="mt-1 h-4 w-4"
                                    />
                                    {child.status === "Satınalma gerekli" && (
                                      <input
                                        type="checkbox"
                                        checked={selectedPurchaseItemIds.includes(child.id)}
                                        onChange={() => togglePurchaseItem(child.id)}
                                        className="mt-1 h-4 w-4"
                                      />
                                    )}
                                    <div>
                                      <div className="font-bold text-slate-900">{child.product_name}</div>
                                      <div className="text-xs text-slate-500">{child.product_code || "-"} · {Number(child.estimated_quantity || 0)} {child.unit || "adet"}</div>
                                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold">
                                        <span className={`rounded-full px-2 py-1 ${productCardLabelClass(child)}`}>{productCardLabel(child)}</span>
                                        <span className="text-emerald-700">Birim fiyat: {formatMoney(childPrice.unitPrice)}</span>
                                        <span className="text-blue-700">Toplam: {formatMoney(childPrice.total)}</span>
                                        <span className={`rounded-full px-2 py-1 ${priceSourceClass(childPrice.source)}`}>{childPrice.source}</span>
                                      </div>
                                      <div className="mt-1 text-xs font-bold text-slate-600">
                                        Toplam ihtiyaç: {formatQuantity(childStockInfo.estimatedQuantity)} {child.unit || "adet"} · Birim kullanım: {formatQuantity(relation.childQuantityPerParent)} · Kullanılan: {formatQuantity(childStockInfo.consumedQuantity)} · Bekleyen/rezerve: {formatQuantity(relation.remainingChildQuantity)} · Eksik: {formatQuantity(childStockInfo.requiredQuantity)}
                                      </div>
                                      <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <button type="button" onClick={() => updateProjectItemQuantity(child, -1)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                                          -1
                                        </button>
                                        <button type="button" onClick={() => updateProjectItemQuantity(child, 1)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                                          +1
                                        </button>
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          value={itemPriceDrafts[child.id] ?? child.estimated_unit_price ?? ""}
                                          onChange={(event) => setItemPriceDrafts((prev) => ({ ...prev, [child.id]: event.target.value }))}
                                          className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"
                                          placeholder="Birim fiyat"
                                        />
                                        <button type="button" onClick={() => updateProjectItemUnitPrice(child)} className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">
                                          Fiyatı Güncelle
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                  <select className="rounded-lg border border-slate-200 p-2 text-xs font-bold" value={child.status || "Bekliyor"} onChange={(e) => updateItemStatus(child.id, e.target.value)}>
                                    {lifecycleItemStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                                  </select>
                                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                                    childStock.tone === "green" ? "bg-green-100 text-green-700" :
                                    childStock.tone === "yellow" ? "bg-yellow-100 text-yellow-700" :
                                    childStock.tone === "red" ? "bg-red-100 text-red-700" :
                                    "bg-slate-100 text-slate-700"
                                  }`}>
                                    Stok: {childStock.available} · {childStock.text}
                                  </span>
                                  <button type="button" onClick={() => deleteProjectItem(child.id)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100">
                                    Sil
                                  </button>
                                  {childStockInfo.stockQuantity > 0 && (
                                    <button type="button" onClick={() => coverItemFromStock(child)} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
                                      Stoktan Karşıla
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {addingItemParentId === item.id && (
                            <form onSubmit={addProjectItem} className="mt-4 rounded-xl border border-indigo-100 bg-white p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-black text-slate-900">Bu ana ürüne malzeme ekle</div>
                                  <div className="text-xs text-slate-500">{item.product_name}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAddingItemParentId("");
                                    setItemForm(emptyItem);
                                  }}
                                  className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
                                >
                                  Vazgeç
                                </button>
                              </div>
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <input className="rounded-xl border border-slate-300 p-3" placeholder="Ürün kodu" value={itemForm.product_code} onChange={(e) => updateItemForm("product_code", e.target.value)} />
                                <input className="rounded-xl border border-slate-300 p-3" placeholder="Ürün adı" value={itemForm.product_name} onChange={(e) => updateItemForm("product_name", e.target.value)} />
                                <input className="rounded-xl border border-slate-300 p-3" placeholder="Birim" value={itemForm.unit} onChange={(e) => updateItemForm("unit", e.target.value)} />
                                <input type="number" className="rounded-xl border border-slate-300 p-3" placeholder="Miktar" value={itemForm.estimated_quantity} onChange={(e) => updateItemForm("estimated_quantity", e.target.value)} />
                                <input type="number" className="rounded-xl border border-slate-300 p-3" placeholder="Birim fiyat" value={itemForm.estimated_unit_price} onChange={(e) => updateItemForm("estimated_unit_price", e.target.value)} />
                                <select className="rounded-xl border border-slate-300 p-3" value={itemForm.status} onChange={(e) => updateItemForm("status", e.target.value)}>
                                  {lifecycleItemStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                                </select>
                                <textarea className="rounded-xl border border-slate-300 p-3 md:col-span-2" rows={2} placeholder="Not" value={itemForm.note} onChange={(e) => updateItemForm("note", e.target.value)} />
                              </div>
                              <button type="submit" className="mt-3 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700">
                                Malzemeyi Kaydet
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {parentItems.length === 0 && (
                  <div className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">Henüz tahmini malzeme yok.</div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "Ödemeler" && (
          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.3fr]">
            <form onSubmit={savePayment} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-slate-900">{editingPaymentId ? "Ödeme Düzenle" : "Ödeme Ekle"}</h2>
                {editingPaymentId && (
                  <button
                    type="button"
                    onClick={cancelPaymentEdit}
                    className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
                  >
                    Vazgeç
                  </button>
                )}
              </div>
              <div className="mt-5 space-y-4">
                <input type="date" className="w-full rounded-xl border border-slate-300 p-3" value={paymentForm.payment_date} onChange={(e) => updatePaymentForm("payment_date", e.target.value)} />
                <input type="number" className="w-full rounded-xl border border-slate-300 p-3" placeholder="Ödeme tutarı" value={paymentForm.amount} onChange={(e) => updatePaymentForm("amount", e.target.value)} />
                <select className="w-full rounded-xl border border-slate-300 p-3" value={paymentForm.currency} onChange={(e) => {
                  updatePaymentForm("currency", e.target.value);
                  updatePaymentForm("exchange_rate", getExchangeRate(e.target.value, companySettings));
                }}>
                  {currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}
                </select>
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs font-semibold text-blue-800">
                  Ödeme TL yapılacaksa para birimini TRY seçin; döviz ödeme yapılacaksa ilgili dövizi seçin. Kur alanı ödeme günündeki TL karşılığını ve kur farkı takibini hesaplamak için saklanır.
                </div>
                <input type="number" className="w-full rounded-xl border border-slate-300 p-3" placeholder="Kur" value={paymentForm.exchange_rate} onChange={(e) => updatePaymentForm("exchange_rate", e.target.value)} />
                <select className="w-full rounded-xl border border-slate-300 p-3" value={paymentForm.payment_type} onChange={(e) => updatePaymentForm("payment_type", e.target.value)}>
                  {paymentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <textarea className="w-full rounded-xl border border-slate-300 p-3" rows={3} placeholder="Açıklama" value={paymentForm.description} onChange={(e) => updatePaymentForm("description", e.target.value)} />
                <button type="submit" className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700">
                  {editingPaymentId ? "Değişiklikleri Kaydet" : "Ödemeyi Kaydet"}
                </button>
              </div>
            </form>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900">Ödeme Geçmişi</h2>
              <div className="mt-5 overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500">
                    <tr>
                      <th className="p-3">Tarih</th>
                      <th className="p-3">Tip</th>
                      <th className="p-3">Açıklama</th>
                      <th className="p-3 text-right">Tutar</th>
                      <th className="p-3 text-right">Base</th>
                      <th className="p-3 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id} className="border-t border-slate-100">
                        <td className="p-3 font-semibold text-slate-700">{formatDate(payment.payment_date)}</td>
                        <td className="p-3 font-bold text-slate-900">{payment.payment_type}</td>
                        <td className="p-3 text-slate-500">{payment.description || "-"}</td>
                        <td className="p-3 text-right font-black text-emerald-700">
                          {formatMoney(payment.amount, payment.currency || "TRY")}
                        </td>
                        <td className="p-3 text-right text-xs font-bold text-slate-500">
                          {payment.base_amount ? formatMoney(payment.base_amount, payment.base_currency || "TRY") : "-"}
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => editPayment(payment)}
                              className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                            >
                              Düzenle
                            </button>
                            <button
                              type="button"
                              onClick={() => deletePayment(payment)}
                              className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                            >
                              Sil
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {payments.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-4 text-sm text-slate-500">Henüz ödeme yok.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === "Talepler" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Proje Talepleri</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Bu projeden oluşturulan satınalma talepleri burada listelenir.
                </p>
              </div>
              <Link
                href="/dashboard/talepler"
                className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white hover:bg-blue-700"
              >
                Talepler Sayfasina Git
              </Link>
            </div>

            <div className="mt-5 space-y-3">
              {projectRequests.map((request) => {
                const requestItems = parseRequestItems(request);
                const isExpanded = expandedRequestIds.includes(request.id);

                return (
                  <div key={request.id} className="overflow-hidden rounded-xl border border-slate-100">
                    <div className="flex flex-col gap-3 p-4 hover:bg-slate-50 md:flex-row md:items-center md:justify-between">
                      <button
                        type="button"
                        onClick={() => toggleProjectRequest(request.id)}
                        className="flex min-w-0 flex-1 flex-col gap-3 text-left md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <div className="font-black text-slate-900">{request.ad || "Proje Talebi"}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatDate(request.created_at)} · {requestItems.length || request.totalitems || 0} icmal kalemi · Detayı görmek için tıkla
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-bold text-purple-700">
                            {request.durum || "Proje Talebi"}
                          </span>
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                            {isExpanded ? "Kapat" : "Aç"}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteProjectRequest(request)}
                        className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                      >
                        Talebi Sil
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50 p-4">
                        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-sm font-black text-slate-900">Talep Kalemleri</div>
                            <div className="text-xs text-slate-500">{requestItems.length} icmal kalemi listeleniyor. Aynı kodlar tek satırda toplandı.</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href="/dashboard/talepler"
                              className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-50"
                            >
                              Talepler Sayfasinda Ac
                            </Link>
                            <button
                              type="button"
                              onClick={() => downloadRequestItems(request, "xlsx")}
                              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
                            >
                              Excel indir
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadRequestItems(request, "pdf")}
                              className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-900"
                            >
                              PDF indir
                            </button>
                          </div>
                        </div>

                        <div className="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white">
                          <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-slate-100 text-slate-600">
                              <tr>
                                <th className="p-3">#</th>
                                <th className="p-3">Ürün Kodu</th>
                                <th className="p-3">Ürün / Açıklama</th>
                                <th className="p-3">Miktar</th>
                                <th className="p-3">Birim</th>
                                <th className="p-3">Birim Fiyat</th>
                                <th className="p-3">Toplam</th>
                                <th className="p-3">Not</th>
                              </tr>
                            </thead>
                            <tbody>
                              {requestItems.map((item, index) => (
                                <tr key={`${request.id}-${item.projectItemId || item.urunKodu || index}`} className="border-t border-slate-100">
                                  <td className="p-3 font-bold text-slate-500">{index + 1}</td>
                                  <td className="p-3 font-bold text-slate-900">{item.urunKodu || item.product_code || "-"}</td>
                                  <td className="p-3 font-semibold text-slate-900">
                                    <div>{item.urunAciklamasi || item.product_name || item.description || "-"}</div>
                                    {Number(item.sourceLineCount || 0) > 1 && (
                                      <div className="mt-1 text-[11px] font-bold text-emerald-700">
                                        {item.sourceLineCount} satır birleştirildi
                                      </div>
                                    )}
                                  </td>
                                  <td className="p-3 font-black text-blue-700">{item.talepEdilenAdet || item.quantity || item.estimated_quantity || 0}</td>
                                  <td className="p-3 text-slate-600">{item.birim || item.unit || "adet"}</td>
                                  <td className="p-3 font-bold text-emerald-700">{formatMoney(item.birimFiyat || item.unit_price || item.estimated_unit_price, item.paraBirimi || item.currency || "TRY")}</td>
                                  <td className="p-3 font-bold text-slate-900">{formatMoney(item.toplam || item.total || item.estimated_total, item.paraBirimi || item.currency || "TRY")}</td>
                                  <td className="p-3 text-slate-500">{item.not || item.note || "-"}</td>
                                </tr>
                              ))}
                              {requestItems.length === 0 && (
                                <tr>
                                  <td colSpan={8} className="p-4 text-center text-sm text-slate-500">
                                    Bu talep için kalem detayı bulunamadı.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}              {projectRequests.length === 0 && (
                <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Bu proje için henüz talep oluşturulmadı.
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "Revizyonlar" && (
          <section className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <SummaryCard title="Proje Başlangıç Toplamı" value={formatMoney(revisionSummary.initialTotal, projectCurrencyForDisplay())} text="Revizyon öncesi malzeme toplamı" />
              <SummaryCard title="Toplam Ek Maliyet" value={formatMoney(revisionSummary.addedCost, projectCurrencyForDisplay())} text="Eklenen/adedi veya fiyatı artan" tone="red" />
              <SummaryCard title="Toplam Düşülen Maliyet" value={formatMoney(revisionSummary.deductedCost, projectCurrencyForDisplay())} text="Çıkarılan/adedi veya fiyatı düşen" tone="green" />
              <SummaryCard title="Güncel Proje Toplamı" value={formatMoney(revisionSummary.currentTotal, projectCurrencyForDisplay())} text="Malzeme listesinin son hali" tone="blue" />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-900">Revizyon Geçmişi</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Kayıtlar malzeme listesinde yapılan ekleme, çıkarma, adet ve fiyat değişikliklerinden otomatik oluşur.
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{revisions.length} kayıt</span>
              </div>

              <div className="mt-5 space-y-3">
                {revisions.map((revision) => {
                  const impact = Number(revision.cost_impact ?? revision.cost_base_amount ?? revision.cost_amount ?? 0);
                  const isIncrease = impact >= 0;
                  const oldQuantity = revision.old_quantity ?? "-";
                  const newQuantity = revision.new_quantity ?? "-";
                  const quantityDelta = revision.quantity_delta ?? "-";
                  const oldUnitPrice = revision.old_unit_price ?? null;
                  const newUnitPrice = revision.new_unit_price ?? null;
                  const currency = revision.currency || getBaseCurrency(companySettings);

                  return (
                    <div key={revision.id} className="rounded-xl border border-slate-100 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-black text-slate-900">{revision.title}</div>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{revision.revision_type || "Malzeme Değişikliği"}</span>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{revision.status || "Uygulandı"}</span>
                          </div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            {formatDate(revision.revision_date)} ? {revision.performed_by_email || revision.performed_by || "Kullanıcı"}
                          </div>
                          <div className="mt-2 text-sm font-bold text-slate-700">
                            {revision.product_code ? `${revision.product_code} ? ` : ""}{revision.product_name || revision.description || "Malzeme"}
                          </div>
                          {revision.description && (
                            <div className="mt-1 text-xs font-semibold text-slate-500">{revision.description}</div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-stretch gap-2 md:items-end">
                          <div className={`rounded-xl px-4 py-3 text-right text-sm font-black ${isIncrease ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                            {isIncrease ? "+" : "-"} {formatMoney(Math.abs(impact), currency)}
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              disabled
                              title="Düzenleme akışı ileride eklenecek"
                              className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-400"
                            >
                              Düzenle
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteRevision(revision)}
                              className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                            >
                              Sil
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-5">
                        <div className="rounded-lg bg-slate-50 p-3">
                          <div className="font-bold text-slate-500">Eski Adet</div>
                          <div className="mt-1 font-black text-slate-900">{oldQuantity}</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <div className="font-bold text-slate-500">Yeni Adet</div>
                          <div className="mt-1 font-black text-slate-900">{newQuantity}</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <div className="font-bold text-slate-500">Adet Farkı</div>
                          <div className="mt-1 font-black text-slate-900">{quantityDelta}</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <div className="font-bold text-slate-500">Eski Fiyat</div>
                          <div className="mt-1 font-black text-slate-900">{oldUnitPrice === null ? "-" : formatMoney(oldUnitPrice, currency)}</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <div className="font-bold text-slate-500">Yeni Fiyat</div>
                          <div className="mt-1 font-black text-slate-900">{newUnitPrice === null ? "-" : formatMoney(newUnitPrice, currency)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {revisions.length === 0 && (
                  <div className="rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                    Bu projede henüz otomatik revizyon kaydı yok. Malzeme listesinden adet, fiyat, ekleme veya çıkarma yapıldığında burada görünecek.
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "Teklifler" && (
          <section className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <SummaryCard title="Analiz Edilen Teklif" value={projectOffers.length} text="Projeye bağlı tedarikçi teklifi" tone="blue" />
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm font-semibold text-slate-500">Teklif Toplamı</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {offerTotalsByCurrency.length > 0 ? offerTotalsByCurrency.map(([currency, amount]) => (
                    <span key={currency} className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-black text-slate-950">
                      {formatMoney(amount, currency)}
                    </span>
                  )) : <span className="text-2xl font-black text-slate-950">{formatMoney(0, projectCurrencyForDisplay())}</span>}
                </div>
                <div className="mt-2 text-sm text-slate-500">Para birimine göre ayrı toplam</div>
              </div>
              <SummaryCard title="Mukayese Raporu" value={projectReports.length} text="Karar bekleyen/sonuçlanan analiz" tone="green" />
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-900">Teklif ve Mukayese Takibi</h2>
                  <p className="mt-1 text-sm text-slate-500">Bu projeye bağlanan teklif dosyaları ve analiz raporları.</p>
                </div>
                <Link
                  href={`/dashboard/teklifler?projectId=${projectId}${projectRequests[0]?.id ? `&requestId=${projectRequests[0].id}` : ""}`}
                  className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white hover:bg-blue-700"
                >
                  Teklif Analizi Aç
                </Link>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-slate-100">
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-sm font-black text-slate-900">Tedarikçi Teklifleri</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {projectOffers.map((offer) => (
                      <div key={offer.id} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                        <div className="min-w-0">
                          <div className="truncate font-black text-slate-900" title={offer.firma_adi || offer.partner_name || "Tedarikçi"}>{offer.firma_adi || offer.partner_name || "Tedarikçi"}</div>
                          <div className="mt-1 truncate text-xs text-slate-500" title={offer.dosya_adi || "Teklif dosyası"}>{offer.dosya_adi || "Teklif dosyası"} · {offer.durum || "Analiz edildi"}</div>
                        </div>
                        <div className="text-left md:text-right">
                          <div className="whitespace-nowrap font-black text-slate-950">{formatMoney(offerAmount(offer), offer.para_birimi || offer.currency || projectCurrencyForDisplay())}</div>
                          <div className="text-xs font-bold text-slate-500">{offer.para_birimi || offer.currency || projectCurrencyForDisplay()}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteProjectOffer(offer)}
                          className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                        >
                          Sil
                        </button>
                      </div>
                    ))}
                    {projectOffers.length === 0 && (
                      <div className="p-6 text-center text-sm text-slate-500">Bu projeye bağlı teklif kaydı yok.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-100">
                  <div className="border-b border-slate-100 p-4">
                    <div className="text-sm font-black text-slate-900">Mukayese Raporları</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {projectReports.map((report) => (
                      <Link key={report.id} href={`/dashboard/raporlar/${report.id}`} className="block p-4 hover:bg-slate-50">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="font-black text-blue-700">{reportName(report)}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              Önerilen: {reportSupplier(report)} · {reportRows(report).length || report.totalgroups || 0} grup
                            </div>
                          </div>
                          <div className="text-left md:text-right">
                            <div className="font-black text-slate-950">{formatMoney(reportAmount(report), report.currency || projectCurrencyForDisplay())}</div>
                            <div className="text-xs font-bold text-slate-500">{report.durum || report.status || "Bekliyor"}</div>
                          </div>
                        </div>
                      </Link>
                    ))}
                    {projectReports.length === 0 && (
                      <div className="p-6 text-center text-sm text-slate-500">Bu projeye bağlı mukayese raporu yok.</div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </section>
        )}

        {activeTab === "Siparişler" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-900">Proje Siparişleri</h2>
                <p className="mt-1 text-sm text-slate-500">Satınalma kararından teslimata kadar bu projeye bağlı siparişler.</p>
              </div>
              <Link href="/dashboard/siparisler" className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white hover:bg-blue-700">
                Siparişleri Aç
              </Link>
            </div>

            <div className="mt-5 overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Sipariş</th>
                    <th className="p-3">İş Ortağı</th>
                    <th className="p-3">Termin</th>
                    <th className="p-3">Durum</th>
                    <th className="p-3 text-right">Tutar</th>
                    <th className="p-3 text-right">Kalem</th>
                  </tr>
                </thead>
                <tbody>
                  {projectOrders.map((order) => {
                    const lines = normalizeOrderItems(order);
                    return (
                      <tr key={order.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="p-3">
                          <Link href={`/dashboard/siparisler/${order.id}`} className="font-black text-blue-700 hover:underline">
                            {order.order_no || order.siparisNo || "Sipariş"}
                          </Link>
                          <div className="mt-1 text-xs text-slate-500">{formatDate(order.order_date || order.created_at)}</div>
                        </td>
                        <td className="p-3 font-bold text-slate-900">{order.partner_name || order.supplier_name || order.firma || "-"}</td>
                        <td className="p-3">{formatDate(order.termin_date || order.delivery_date)}</td>
                        <td className="p-3">
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{order.status || "Bekliyor"}</span>
                        </td>
                        <td className="p-3 text-right font-black text-slate-950">{formatMoney(overviewOrderAmount(order))}</td>
                        <td className="p-3 text-right text-xs font-bold text-slate-500">{lines.length || order.quantity || 0}</td>
                      </tr>
                    );
                  })}
                  {projectOrders.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-sm text-slate-500">Bu projeye bağlı sipariş yok.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "Stok Hareketleri" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-900">Proje Stok Hareketleri</h2>
                <p className="mt-1 text-sm text-slate-500">Projeye giren, rezerve edilen veya tamamlanan miktara bağlı kullanılan malzemeler.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {stockTotalsByCurrency.length > 0 ? stockTotalsByCurrency.map(([currency, amount]) => (
                  <span key={currency} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">
                    {formatMoney(amount, currency)}
                  </span>
                )) : (
                  <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">
                    Toplam değer: {formatMoney(0, projectCurrencyForDisplay())}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3">
              {stockMovements.map((movement) => {
                const currency = movement.currency || projectCurrencyForDisplay();
                const demo = isDemoMovement(movement);

                return (
                <div key={movement.id} className="rounded-xl border border-slate-100 p-4">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_160px_170px_110px] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate font-black text-slate-900" title={movement.product_name || "Stok kalemi"}>{movement.product_name || "Stok kalemi"}</div>
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700">{movementTypeLabel(movement)}</span>
                        {demo && <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">Demo/Test Verisi</span>}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500" title={movement.product_code || "-"}>
                        Kod: {movement.product_code || "-"} · Tarih: {formatDate(movement.movement_date || movement.created_at)}
                      </div>
                      <div className="mt-2 truncate text-xs font-bold text-slate-600" title={`${movement.partner_name || movement.supplier_name || "-"} · ${movement.source || "-"}`}>
                        Kaynak/Tedarikçi: {movement.partner_name || movement.supplier_name || "-"} · {movement.source || "-"}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500" title={movement.related_project_name || project?.project_name || ""}>
                        Bağlı proje: {movement.related_project_name || project?.project_name || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-500">Miktar</div>
                      <div className="mt-1 whitespace-nowrap font-black text-blue-700">{quantityText(movement.quantity, movement.unit)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-500">Birim / Toplam</div>
                      <div className="mt-1 whitespace-nowrap text-sm font-black text-slate-950">{formatMoney(movement.unit_price, currency)}</div>
                      <div className="whitespace-nowrap text-xs font-bold text-slate-500">{formatMoney(movementAmount(movement), currency)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteStockMovement(movement)}
                      className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                    >
                      Sil
                    </button>
                  </div>
                </div>
                );
              })}
              {stockMovements.length === 0 && (
                <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Bu proje için stok hareketi yok.</div>
              )}
            </div>
          </section>
        )}

        {activeTab === "Raporlar" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-900">Proje Raporları</h2>
                <p className="mt-1 text-sm text-slate-500">Mukayese, analiz ve karar kayıtları proje arşivinde tutulur.</p>
              </div>
              <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">
                Rapor toplamı: {formatMoney(projectReportTotal, projectCurrencyForDisplay())}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              {projectReports.map((report) => (
                <Link key={report.id} href={`/dashboard/raporlar/${report.id}`} className="rounded-xl border border-slate-100 p-4 transition hover:border-blue-200 hover:bg-blue-50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-blue-700">{reportName(report)}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDate(report.created_at || report.tarih)} · {report.tur || "Mukayese"}</div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{report.durum || "Bekliyor"}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-white p-3">
                      <div className="text-xs font-bold text-slate-500">Önerilen</div>
                      <div className="mt-1 font-black text-slate-900">{reportSupplier(report)}</div>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <div className="text-xs font-bold text-slate-500">Tutar</div>
                      <div className="mt-1 font-black text-slate-900">{formatMoney(reportAmount(report), report.currency || projectCurrencyForDisplay())}</div>
                    </div>
                  </div>
                </Link>
              ))}
              {projectReports.length === 0 && (
                <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500 md:col-span-2">Bu proje için rapor kaydı yok.</div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
