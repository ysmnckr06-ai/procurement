"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ProductCodeInput from "@/components/ProductCodeInput";
import { supabase } from "@/lib/supabase";
import { calculateBaseAmount, currencyOptions, getBaseCurrency, getExchangeRate } from "@/lib/currency";
import { fetchLiveTryRates, liveCurrencyOptions, liveRateFor, rateDiffPercent } from "@/lib/liveCurrency";
import { findOrCreateBusinessPartner, findPartnerMatches } from "@/lib/businessPartners";

const emptyForm = {
  orderNo: "",
  company: "",
  product: "",
  orderDate: "",
  dueDate: "",
  deliveryDate: "",
  status: "Taslak",
  projectId: "",
  items: [],
  totalAmount: 0,
  note: "",
  currency: "TRY",
  exchangeRate: 1,
  rateLocked: false,
  rateLockedAt: "",
  reportId: null,
};

const defaultCompanySettings = {
  default_currency: "TRY",
  base_currency: "TRY",
  usd_rate: 1,
  eur_rate: 1,
  gbp_rate: 1,
  exchange_rate_date: new Date().toISOString().slice(0, 10),
  default_payment_term: "60 gün",
  approval_required: true,
};

const statusOptions = [
  "Tümü",
  "Taslak",
  "Onay Bekliyor",
  "Sipariş Geçildi",
  "Tedarikçiden Bekleniyor",
  "Kısmi Teslim",
  "Tam Teslim",
  "Gecikti",
  "İptal",
];

const editableStatusOptions = statusOptions.filter((status) => status !== "Tümü");

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function createOrderNo(count = 0) {
  return `SIP-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;
}

function formatMoney(value, currency = "TRY") {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} ${currency}`;
}

function readNumberField(item, primaryKey, fallbackKey, defaultValue = 0) {
  const value = item?.[primaryKey] ?? item?.[fallbackKey] ?? defaultValue;

  if (value === "") return "";

  return Number(value || 0);
}

function createRowId(prefix = "order-item") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeItems(items) {
  return (items || []).map((item, index) => {
    const quantity = readNumberField(item, "quantity", "miktar");
    const unitPrice = readNumberField(item, "unitPrice", "birimFiyat");
    const discount = readNumberField(item, "discount", "iskonto");
    const quantityNumber = Number(quantity || 0);
    const unitPriceNumber = Number(unitPrice || 0);
    const discountNumber = Number(discount || 0);
    const netUnitPrice = Number(
      item.netUnitPrice ||
        unitPriceNumber - (unitPriceNumber * discountNumber) / 100,
    );
    const total = Number(item.total || quantityNumber * netUnitPrice);
    const deliveredQuantity = readNumberField(
      item,
      "deliveredQuantity",
      "delivered",
    );

    return {
      rowId:
        item.rowId ||
        item.id ||
        item.itemId ||
        `order-item-${index}-${item.productCode || item.urunKodu || ""}-${item.productName || item.urunAciklamasi || item.urunAdi || ""}`,
      productCode: item.productCode || item.urunKodu || "",
      productName:
        item.productName ||
        item.urunAciklamasi ||
        item.urunAdi ||
        item.name ||
        item.description ||
        item.product ||
      "",
      unit: item.unit || item.birim || "adet",
      quantity,
      deliveredQuantity,
      unitPrice,
      discount,
      netUnitPrice,
      total,
      paymentTerm: item.paymentTerm || item.vade || "",
      deliveryTerm: item.deliveryTerm || item.termin || "",
      currency: item.currency || "TRY",
      allocations: Array.isArray(item.allocations) ? item.allocations : [],
    
    };
  });
}

function calculateOrderTotal(items) {
  return normalizeItems(items).reduce(
    (sum, item) => sum + Number(item.total || 0),
    0,
  );
}

function calculateItemCounts(order) {
  const items = normalizeItems(order.items);
  const totalQuantity = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );
  const deliveredQuantity = items.reduce(
    (sum, item) => sum + Number(item.deliveredQuantity || 0),
    0,
  );

  return {
    itemCount: items.length || Number(order.quantity || 0),
    totalQuantity,
    deliveredQuantity,
    remainingQuantity: Math.max(totalQuantity - deliveredQuantity, 0),
  };
}

function getSmartStatus(order) {
  const status = order.status || "Taslak";
  if (
    status === "Tam Teslim" ||
    status === "Teslim Edildi" ||
    status === "İptal" ||
    status === "Kısmi Teslim"
  ) {
    return status === "Teslim Edildi" ? "Tam Teslim" : status;
  }

  if (
    order.termin_date &&
    !order.delivery_date &&
    new Date(order.termin_date) < new Date()
  ) {
    return "Gecikti";
  }

  return status;
}

function getStatusClass(status) {
  const classes = {
    Taslak: "bg-slate-100 text-slate-700",
    "Onay Bekliyor": "bg-orange-100 text-orange-700",
    "Sipariş Geçildi": "bg-blue-100 text-blue-700",
    "Tedarikçiden Bekleniyor": "bg-sky-100 text-sky-700",
    "Kısmi Teslim": "bg-amber-100 text-amber-700",
    "Tam Teslim": "bg-green-100 text-green-700",
    "Teslim Edildi": "bg-green-100 text-green-700",
    Gecikti: "bg-red-100 text-red-700",
    İptal: "bg-slate-200 text-slate-700",
  };

  return classes[status] || "bg-slate-100 text-slate-700";
}

function calculateDelayDays(order) {
  if (!order.termin_date) return 0;

  const due = new Date(order.termin_date);
  const endDate = order.delivery_date
    ? new Date(order.delivery_date)
    : new Date();
  const diff = Math.ceil((endDate - due) / (1000 * 60 * 60 * 24));

  return diff > 0 ? diff : 0;
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const today = new Date(getToday());
  const target = new Date(dateValue);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function normalizeOrderText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ");
}

function normalizeOrderCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function orderItemIdentity(item) {
  return {
    code: normalizeOrderCode(item.productCode || item.urunKodu || item.product_code),
    name: normalizeOrderText(item.productName || item.urunAciklamasi || item.urunAdi || item.product_name || item.name),
  };
}

function orderLineMatchesProjectItem(line, projectItem) {
  const left = orderItemIdentity(line);
  const right = orderItemIdentity({
    productCode: projectItem.product_code,
    productName: projectItem.product_name,
  });

  if (left.code && right.code && left.code === right.code) return true;
  return Boolean(left.name && right.name && left.name === right.name);
}

function productMatchesProjectItem(product, projectItem) {
  const productCode = normalizeOrderCode(product.product_code);
  const itemCode = normalizeOrderCode(projectItem.product_code);
  const productName = normalizeOrderText(product.product_name);
  const itemName = normalizeOrderText(projectItem.product_name);

  if (productCode && itemCode && productCode === itemCode) return true;
  return Boolean(productName && itemName && productName === itemName);
}

function StatCard({ title, value, text }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{text}</div>
    </div>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const isSubmittingRef = useRef(false);
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [formData, setFormData] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [message, setMessage] = useState("");
  const [companySettings, setCompanySettings] = useState(defaultCompanySettings);
  const [liveRates, setLiveRates] = useState(null);
  const [projectLinkOpen, setProjectLinkOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectOrderItems, setProjectOrderItems] = useState([]);
  const [projectStockProducts, setProjectStockProducts] = useState([]);
  const [stockProducts, setStockProducts] = useState([]);
  const [selectedProjectItemIds, setSelectedProjectItemIds] = useState([]);
  const [projectItemQuantities, setProjectItemQuantities] = useState({});
  const [showCompletedProjectItems, setShowCompletedProjectItems] = useState(false);
  const [projectItemsLoading, setProjectItemsLoading] = useState(false);
  const [projectItemsMessage, setProjectItemsMessage] = useState("");
  const [partnerChoice, setPartnerChoice] = useState(null);

  // Initial load should run once; these functions intentionally read current mount state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial page hydration only
  useEffect(() => {
    loadData();
    hydratePendingOrder();
    fetchLiveTryRates().then(setLiveRates).catch(() => setLiveRates(null));
  }, []);

  async function loadData() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setMessage("Siparişler yüklenemedi.");
      return;
    }

    const { data: supplierData } = await supabase
      .from("suppliers")
      .select("id,name,status,partner_type")
      .eq("user_id", user.id)
      .in("partner_type", ["Tedarikçi", "Taşeron", "Nakliye", "Hizmet Sağlayıcı", "Diğer"])
      .order("name", { ascending: true });

    const { data: projectData } = await supabase
      .from("projects")
      .select("id,project_code,project_name,status,customer_name,contract_currency,estimated_budget_currency")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    const { data: settingsData } = await supabase
      .from("company_settings")
      .select("*")
      .eq("user_id", user.id)
      .limit(1);

    const { data: stockProductData } = await supabase
      .from("products")
      .select("id,product_code,normalized_product_code,product_name,brand,unit,current_stock,reserved_stock")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("product_code", { ascending: true })
      .limit(5000);

    setOrders(data || []);
    setSuppliers(supplierData || []);
    setProjects(projectData || []);
    setStockProducts(stockProductData || []);
    if (settingsData?.[0]) {
      setCompanySettings({
        ...defaultCompanySettings,
        ...settingsData[0],
      });
    }
  }

  function hydratePendingOrder() {
    const pendingOrder = localStorage.getItem("pendingOrder");
    if (!pendingOrder) return;

    const parsedOrder = JSON.parse(pendingOrder);
    const items = normalizeItems(parsedOrder.items || []);

    setFormData({
      ...emptyForm,
      orderNo: parsedOrder.orderNo || createOrderNo(orders.length),
      company: parsedOrder.company || "",
      product: parsedOrder.reportName || "Karşılaştırma Raporu",
      orderDate: parsedOrder.orderDate || getToday(),
      dueDate: parsedOrder.dueDate || "",
      status: "Taslak",
      projectId: parsedOrder.projectId || "",
      reportId: parsedOrder.reportId || null,
      items,
      totalAmount: calculateOrderTotal(items),
      currency: parsedOrder.currency || companySettings.default_currency || "TRY",
      exchangeRate: liveRateFor(parsedOrder.currency || companySettings.default_currency || "TRY", liveRates) || getExchangeRate(parsedOrder.currency || companySettings.default_currency || "TRY", companySettings),
      rateLocked: false,
      rateLockedAt: "",
      note: parsedOrder.paymentTerm
        ? `Ödeme vadesi: ${parsedOrder.paymentTerm}`
        : "",
    });
    setShowForm(true);
    setEditingId(null);
    setMessage(
      "Rapor verileri otomatik olarak yüklendi. Kontrol edip siparişi oluşturabilirsiniz.",
    );
    localStorage.removeItem("pendingOrder");
  }

  const enrichedOrders = useMemo(() => {
    const projectMap = Object.fromEntries(projects.map((project) => [project.id, project]));
    return orders.map((order) => ({
      ...order,
      status: getSmartStatus(order),
      delayDays: calculateDelayDays(order),
      project: projectMap[order.project_id] || null,
      paidAmount: Number(order.paid_amount || 0),
      remainingPayment: Math.max(Number(order.total_amount || 0) - Number(order.paid_amount || 0), 0),
      ...calculateItemCounts(order),
    }));
  }, [orders, projects]);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return enrichedOrders.filter((order) => {
      const haystack = [order.order_no, order.partner_name || order.supplier_name, order.product_name]
        .join(" ")
        .toLowerCase();
      const searchMatch = needle ? haystack.includes(needle) : true;
      const statusMatch =
        statusFilter === "Tümü" ? true : order.status === statusFilter;

      return searchMatch && statusMatch;
    });
  }, [enrichedOrders, search, statusFilter]);

  const totalAmount = enrichedOrders.reduce(
    (sum, order) => sum + Number(order.total_amount || 0),
    0,
  );
  const waitingCount = enrichedOrders.filter(
    (order) => order.status === "Taslak" || order.status === "Onay Bekliyor",
  ).length;
  const deliveredCount = enrichedOrders.filter(
    (order) => order.status === "Tam Teslim" || order.status === "Teslim Edildi",
  ).length;
  const delayedCount = enrichedOrders.filter(
    (order) => order.status === "Gecikti",
  ).length;

  const projectSearchResults = useMemo(() => {
    const needle = normalizeOrderText(projectSearch);
    if (!needle) return projects.slice(0, 8);

    return projects
      .filter((project) =>
        normalizeOrderText([project.project_code, project.project_name, project.customer_name].join(" ")).includes(needle),
      )
      .slice(0, 12);
  }, [projects, projectSearch]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const projectOrderRows = useMemo(() => {
    if (!selectedProjectId) return [];
    return orders.filter((order) => order.project_id === selectedProjectId);
  }, [orders, selectedProjectId]);

  const projectOrderRowsByItem = useMemo(() => {
    const parentIdsWithChildren = new Set(projectOrderItems.map((item) => item.parent_item_id).filter(Boolean));

    return projectOrderItems
      .filter((item) => item.product_name && Number(item.estimated_quantity || 0) > 0)
      .filter((item) => !(parentIdsWithChildren.has(item.id) && item.item_type === "main"))
      .map((item) => {
        const orderedStats = projectOrderRows.reduce(
          (acc, order) => {
            normalizeItems(order.items || []).forEach((line) => {
              if (!orderLineMatchesProjectItem(line, item)) return;
              acc.ordered += Number(line.quantity || 0);
              acc.delivered += Number(line.deliveredQuantity || 0);
            });
            return acc;
          },
          { ordered: 0, delivered: 0 },
        );
        const needed = Number(item.estimated_quantity || 0);
        const remaining = Math.max(needed - orderedStats.ordered, 0);
        const stockQuantity = projectStockProducts
          .filter((product) => productMatchesProjectItem(product, item))
          .reduce((sum, product) => sum + Math.max(Number(product.current_stock || 0) - Number(product.reserved_stock || 0), 0), 0);
        const selectedQuantity = projectItemQuantities[item.id] ?? remaining;

        return {
          ...item,
          needed,
          orderedQuantity: orderedStats.ordered,
          deliveredQuantity: orderedStats.delivered,
          remainingQuantity: remaining,
          stockQuantity,
          addQuantity: selectedQuantity,
        };
      });
  }, [projectOrderItems, projectOrderRows, projectStockProducts, projectItemQuantities]);

  const visibleProjectOrderRows = useMemo(() => {
    return projectOrderRowsByItem.filter((item) => showCompletedProjectItems || item.remainingQuantity > 0);
  }, [projectOrderRowsByItem, showCompletedProjectItems]);

  function handleChange(event) {
    const { name, value, type, checked } = event.target;
    const nextValue = type === "checkbox" ? checked : value;
    setFormData((prev) => ({
      ...prev,
      [name]: nextValue,
      ...(name === "currency"
        ? { exchangeRate: liveRateFor(value, liveRates) || getExchangeRate(value, companySettings) }
        : {}),
      ...(name === "rateLocked" && checked
        ? {
            exchangeRate: liveRateFor(prev.currency, liveRates) || prev.exchangeRate || getExchangeRate(prev.currency, companySettings),
            rateLockedAt: new Date().toISOString(),
          }
        : {}),
    }));
  }

  function handleSupplierChange(event) {
    setFormData((prev) => ({ ...prev, company: event.target.value }));
    setPartnerChoice(null);
  }

  function updateOrderItem(index, field, value) {
    setFormData((prev) => {
      const items = normalizeItems(prev.items);
      items[index] = { ...items[index], [field]: value };

      const quantity = Number(items[index].quantity || 0);
      const unitPrice = Number(items[index].unitPrice || 0);
      const discount = Number(items[index].discount || 0);
      const deliveredQuantity = Number(items[index].deliveredQuantity || 0);
      const netUnitPrice = unitPrice - (unitPrice * discount) / 100;

      items[index].deliveredQuantity =
        items[index].deliveredQuantity === ""
          ? ""
          : Math.min(Math.max(deliveredQuantity, 0), quantity);
      items[index].netUnitPrice = netUnitPrice;
      items[index].total = quantity * netUnitPrice;

      return {
        ...prev,
        items,
        totalAmount: calculateOrderTotal(items),
      };
    });
  }

  function addOrderItem() {
    setFormData((prev) => {
      const items = [
        ...normalizeItems(prev.items),
        {
          productCode: "",
          rowId: createRowId(),
          productName: "",
          unit: "adet",
          quantity: 1,
          deliveredQuantity: 0,
          unitPrice: 0,
          discount: 0,
          netUnitPrice: 0,
          total: 0,
          paymentTerm: "",
          deliveryTerm: "",
          currency: prev.currency || "TRY",
        },
      ];

      return {
        ...prev,
        items,
        totalAmount: calculateOrderTotal(items),
      };
    });
  }

  function deleteOrderItem(index) {
    setFormData((prev) => {
      const items = normalizeItems(prev.items);
      items.splice(index, 1);

      return {
        ...prev,
        items,
        totalAmount: calculateOrderTotal(items),
      };
    });
  }

  function resetForm() {
    setFormData(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setMessage("");
    setPartnerChoice(null);
  }

  function startNewOrder() {
    setEditingId(null);
    setProjectLinkOpen(false);
    setFormData({
      ...emptyForm,
      orderNo: createOrderNo(orders.length),
      orderDate: getToday(),
      currency: companySettings.default_currency || "TRY",
      exchangeRate: liveRateFor(companySettings.default_currency || "TRY", liveRates) || getExchangeRate(companySettings.default_currency || "TRY", companySettings),
      rateLocked: false,
      rateLockedAt: "",
      note: companySettings.default_payment_term
        ? `Ödeme vadesi: ${companySettings.default_payment_term}`
        : "",
    });
    setShowForm(true);
    setMessage("");
    setPartnerChoice(null);
  }

  async function loadProjectItemsForOrder(projectId) {
    setSelectedProjectId(projectId);
    setProjectOrderItems([]);
    setProjectStockProducts([]);
    setSelectedProjectItemIds([]);
    setProjectItemQuantities({});
    setProjectItemsMessage("");

    if (!projectId) return;

    setProjectItemsLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data: itemData, error: itemError } = await supabase
      .from("project_items")
      .select("*")
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    const { data: productData, error: productError } = await supabase
      .from("products")
      .select("id,product_code,normalized_product_code,product_name,brand,current_stock,reserved_stock,unit")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .limit(5000);

    if (itemError) {
      setProjectItemsMessage(itemError.message || "Proje malzemeleri getirilemedi.");
      setProjectItemsLoading(false);
      return;
    }

    if (productError) {
      setProjectItemsMessage("Stok bilgisi okunamadı; stok miktarları 0 kabul edildi.");
    }

    setProjectOrderItems(itemData || []);
    setProjectStockProducts(productData || []);
    setProjectItemsLoading(false);
  }

  function toggleProjectOrderItem(itemId) {
    setSelectedProjectItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId],
    );
  }

  function toggleAllVisibleProjectItems() {
    const selectableIds = visibleProjectOrderRows
      .filter((item) => Number(projectItemQuantities[item.id] ?? item.remainingQuantity) > 0)
      .map((item) => item.id);

    setSelectedProjectItemIds((prev) => {
      const allSelected = selectableIds.length > 0 && selectableIds.every((id) => prev.includes(id));
      return allSelected
        ? prev.filter((id) => !selectableIds.includes(id))
        : Array.from(new Set([...prev, ...selectableIds]));
    });
  }

  function updateProjectItemQuantity(itemId, value) {
    setProjectItemQuantities((prev) => ({ ...prev, [itemId]: value }));
  }

  function transferProjectItemsToOrder() {
    if (!selectedProject) {
      setProjectItemsMessage("Önce proje seçin.");
      return;
    }

    const selectedRows = projectOrderRowsByItem
      .filter((item) => selectedProjectItemIds.includes(item.id))
      .map((item) => ({
        ...item,
        addQuantity: Number(projectItemQuantities[item.id] ?? item.remainingQuantity),
      }))
      .filter((item) => item.addQuantity > 0);

    if (selectedRows.length === 0) {
      setProjectItemsMessage("Siparişe aktarılacak en az bir ürün seçin.");
      return;
    }

    const projectCurrency = selectedProject.estimated_budget_currency || selectedProject.contract_currency || companySettings.default_currency || "TRY";
    const items = selectedRows.map((item) => normalizeItems([{
      rowId: createRowId("project-order-item"),
      productCode: item.product_code || "",
      productName: item.product_name || "",
      unit: item.unit || "adet",
      quantity: item.addQuantity,
      deliveredQuantity: 0,
      unitPrice: Number(item.estimated_unit_price || item.quote_unit_price || 0),
      discount: 0,
      paymentTerm: "",
      deliveryTerm: "",
      currency: projectCurrency,
      allocations: [
        {
          type: "project",
          projectId: selectedProject.id,
          projectCode: selectedProject.project_code || "",
          projectName: selectedProject.project_name || "",
          projectItemId: item.id,
          projectItemName: item.product_name || "",
          quantity: item.addQuantity,
          deliveredQuantity: 0,
        },
      ],
    }])[0]);

    setFormData({
      ...emptyForm,
      orderNo: createOrderNo(orders.length),
      company: "",
      product: `${selectedProject.project_code || ""} ${selectedProject.project_name || ""}`.trim() || "Proje Siparişi",
      orderDate: getToday(),
      status: "Taslak",
      projectId: selectedProject.id,
      items,
      totalAmount: calculateOrderTotal(items),
      currency: projectCurrency,
      exchangeRate: liveRateFor(projectCurrency, liveRates) || getExchangeRate(projectCurrency, companySettings),
      rateLocked: false,
      rateLockedAt: "",
      note: `Projeye bağlı sipariş: ${selectedProject.project_code || ""} ${selectedProject.project_name || ""}`.trim(),
    });
    setEditingId(null);
    setShowForm(true);
    setProjectLinkOpen(false);
    setMessage(`${items.length} proje kalemi sipariş formuna aktarıldı.`);
  }

  function startEdit(order) {
    setProjectLinkOpen(false);
    setFormData({
      ...emptyForm,
      orderNo: order.order_no || "",
      company: order.partner_name || order.supplier_name || "",
      product: order.product_name || "",
      orderDate: order.order_date || "",
      dueDate: order.termin_date || "",
      deliveryDate: order.delivery_date || "",
      status: order.status || "Taslak",
      projectId: order.project_id || "",
      reportId: order.report_id || null,
      items: normalizeItems(order.items || []),
      totalAmount: Number(order.total_amount || 0),
      note: order.note || "",
      currency: order.currency || "TRY",
      exchangeRate: Number(order.exchange_rate || 1),
      rateLocked: Boolean(order.rate_locked || order.exchange_rate),
      rateLockedAt: order.rate_locked_at || order.exchange_rate_date || "",
    });
    setEditingId(order.id);
    setShowForm(true);
    setMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    if (
      !formData.orderNo ||
      !formData.company ||
      !formData.product ||
      !formData.orderDate
    ) {
      setMessage("Sipariş no, iş ortağı, başlık ve sipariş tarihi zorunludur.");
      isSubmittingRef.current = false;
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const items = normalizeItems(formData.items);
    const partnerMatches = findPartnerMatches(suppliers, { name: formData.company });
    const selectedPartner = partnerChoice?.mode === "existing"
      ? suppliers.find((supplier) => supplier.id === partnerChoice.partnerId)
      : partnerMatches.find((match) => match.type === "exact")?.partner;
    let partner = selectedPartner || null;

    if (!partner && partnerChoice?.mode === "new") {
      partner = await findOrCreateBusinessPartner(supabase, user.id, {
        name: formData.company,
        partnerType: "Tedarikçi",
        allowCreate: true,
        forceCreate: true,
      });
    }

    if (!partner) {
      setMessage(
        partnerMatches.length > 0
          ? "Benzer iş ortağı bulundu. Mevcut firmayı kullanın veya yeni firma oluşturmayı açıkça seçin."
          : "Yeni iş ortağı oluşturmak için firma alanındaki onay seçeneğini kullanın.",
      );
      isSubmittingRef.current = false;
      return;
    }

    const orderTotal = Number(formData.totalAmount || calculateOrderTotal(items));
    const baseCurrency = getBaseCurrency(companySettings);
    const baseAmount = calculateBaseAmount(orderTotal, formData.currency, companySettings, formData.exchangeRate);
    const payload = {
      user_id: user.id,
      order_no: formData.orderNo,
      supplier_name: formData.company,
      partner_id: partner?.id || null,
      partner_name: partner?.name || formData.company,
      partner_type: partner?.partner_type || "Tedarikçi",
      product_name: formData.product,
      quantity: items.length || 1,
      order_date: formData.orderDate || null,
      termin_date: formData.dueDate || null,
      delivery_date: formData.deliveryDate || null,
      status: formData.status,
      project_id: formData.projectId || null,
      report_id: formData.reportId || null,
      items,
      total_amount: orderTotal,
      original_amount: orderTotal,
      order_total: orderTotal,
      exchange_rate: Number(formData.exchangeRate || getExchangeRate(formData.currency, companySettings)),
      exchange_rate_date: formData.orderDate || companySettings.exchange_rate_date || getToday(),
      rate_locked: Boolean(formData.rateLocked),
      rate_locked_at: formData.rateLocked ? (formData.rateLockedAt || new Date().toISOString()) : null,
      fixed_usd_rate: formData.rateLocked ? (liveRateFor("USD", liveRates) || Number(companySettings.usd_rate || 1)) : null,
      fixed_eur_rate: formData.rateLocked ? (liveRateFor("EUR", liveRates) || Number(companySettings.eur_rate || 1)) : null,
      fixed_gbp_rate: formData.rateLocked ? (liveRateFor("GBP", liveRates) || Number(companySettings.gbp_rate || 1)) : null,
      base_currency: baseCurrency,
      base_amount: baseAmount,
      order_total_base: baseAmount,
      remaining_amount: Math.max(orderTotal - Number(formData.paidAmount || 0), 0),
      remaining_amount_base: calculateBaseAmount(Math.max(orderTotal - Number(formData.paidAmount || 0), 0), formData.currency, companySettings, formData.exchangeRate),
      note: formData.note || "",
      currency: formData.currency || "TRY",
    };

    const totalQuantity = items.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0,
    );
    const deliveredQuantity = items.reduce(
      (sum, item) => sum + Number(item.deliveredQuantity || 0),
      0,
    );
    if (deliveredQuantity >= totalQuantity && totalQuantity > 0) {
      payload.status = "Tam Teslim";
      payload.delivery_date = payload.delivery_date || getToday();
    } else if (deliveredQuantity > 0) {
      payload.status = "Kısmi Teslim";
    }

    const saveOrder = (nextPayload) => editingId
      ? supabase
          .from("orders")
          .update(nextPayload)
          .eq("id", editingId)
          .eq("user_id", user.id)
          .select("id")
          .single()
      : supabase.from("orders").insert(nextPayload).select("id").single();

    let { data: savedOrder, error } = await saveOrder(payload);

    if (error && /rate_locked|fixed_usd_rate|fixed_eur_rate|fixed_gbp_rate/i.test(error.message || "")) {
      const {
        rate_locked: _rateLocked,
        rate_locked_at: _rateLockedAt,
        fixed_usd_rate: _fixedUsdRate,
        fixed_eur_rate: _fixedEurRate,
        fixed_gbp_rate: _fixedGbpRate,
        ...fallbackPayload
      } = payload;
      const fallbackResult = await saveOrder(fallbackPayload);
      savedOrder = fallbackResult.data;
      error = fallbackResult.error;
    }
    isSubmittingRef.current = false;

    if (error) {
      console.error(error);
      setMessage("Sipariş kaydedilemedi.");
      return;
    }

    if (savedOrder?.id) {
      router.push(`/dashboard/siparisler/${savedOrder.id}`);
      return;
    }

    resetForm();
    await loadData();
  }

  async function handleDelete(id) {
    const confirmed = window.confirm("Bu sipariş silinsin mi?");
    if (!confirmed) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { error } = await supabase
      .from("orders")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      setMessage("Sipariş silinemedi.");
      return;
    }

    setOrders((prev) => prev.filter((order) => order.id !== id));
  }

  return (
    <div className="bg-slate-100">
      <main className="p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-green-100 px-4 py-2 text-sm font-bold text-green-700">
                Sipariş Yönetimi
              </div>
              <h1 className="mt-3 text-4xl font-bold text-slate-900">
                Siparişler
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Raporlardan gelen veya manuel oluşturulan siparişleri durum,
                termin ve teslimat bilgileriyle takip edin.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={showForm ? resetForm : startNewOrder}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700"
              >
                {showForm ? "Formu Kapat" : "+ Yeni Sipariş"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setProjectLinkOpen((prev) => !prev);
                  setShowForm(false);
                  setEditingId(null);
                  setMessage("");
                }}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100"
              >
                Projeye Bağla
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <StatCard
              title="Toplam Sipariş"
              value={enrichedOrders.length}
              text="Kayıtlı sipariş"
            />
            <StatCard
              title="Toplam Tutar"
              value={formatMoney(totalAmount)}
              text="Tüm siparişler"
            />
            <StatCard
              title="Bekleyen"
              value={waitingCount}
              text="Aksiyon bekliyor"
            />
            <StatCard
              title="Teslim Edilen"
              value={deliveredCount}
              text="Tamamlandı"
            />
            <StatCard
              title="Geciken"
              value={delayedCount}
              text="Termin aşıldı"
            />
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-black text-blue-900">Canlı kur takibi</div>
                <div className="mt-1 text-xs font-semibold text-blue-700">
                  Sipariş tarihi sabit kur tarihi olarak saklanır; ödeme gününde TL/döviz tercihine göre canlı kur farkı izlenir.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {liveCurrencyOptions.map((currency) => (
                  <span key={currency} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-blue-900">
                    {currency}: {liveRateFor(currency, liveRates) ? formatMoney(liveRateFor(currency, liveRates), "TRY") : "Alınamadı"}
                  </span>
                ))}
                {liveRates?.date && (
                  <span className="rounded-xl bg-blue-100 px-3 py-2 text-xs font-bold text-blue-800">
                    {liveRates.date}
                  </span>
                )}
              </div>
            </div>
          </div>

          {message && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-900">
              {message}
            </div>
          )}

          {projectLinkOpen && (
            <ProjectOrderLinkPanel
              projects={projectSearchResults}
              projectSearch={projectSearch}
              selectedProject={selectedProject}
              selectedProjectId={selectedProjectId}
              rows={visibleProjectOrderRows}
              allRows={projectOrderRowsByItem}
              selectedIds={selectedProjectItemIds}
              quantities={projectItemQuantities}
              loading={projectItemsLoading}
              message={projectItemsMessage}
              showCompleted={showCompletedProjectItems}
              onSearchChange={setProjectSearch}
              onSelectProject={loadProjectItemsForOrder}
              onToggleCompleted={setShowCompletedProjectItems}
              onToggleItem={toggleProjectOrderItem}
              onToggleAll={toggleAllVisibleProjectItems}
              onQuantityChange={updateProjectItemQuantity}
              onTransfer={transferProjectItemsToOrder}
            />
          )}

          {showForm && (
            <OrderForm
              formData={formData}
              suppliers={suppliers}
              projects={projects}
              editingId={editingId}
              onChange={handleChange}
              onSupplierChange={handleSupplierChange}
              partnerChoice={partnerChoice}
              onPartnerChoice={setPartnerChoice}
              onItemChange={updateOrderItem}
              onAddItem={addOrderItem}
              onDeleteItem={deleteOrderItem}
              onCancel={resetForm}
              onSubmit={handleSubmit}
              liveRates={liveRates}
              stockProducts={stockProducts}
            />
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_220px_180px]">
              <input
                placeholder="Sipariş no, iş ortağı veya ürün ara..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm"
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm"
              >
                {statusOptions.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={startNewOrder}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white"
              >
                + Yeni Sipariş
              </button>
            </div>
          </div>

          <OrdersTable
            orders={filteredOrders}
            liveRates={liveRates}
            onView={(order) => router.push(`/dashboard/siparisler/${order.id}`)}
            onEdit={startEdit}
            onDelete={handleDelete}
          />

          <TerminTable orders={enrichedOrders} />
        </div>
      </main>
    </div>
  );
}

function ProjectOrderLinkPanel({
  projects,
  projectSearch,
  selectedProject,
  selectedProjectId,
  rows,
  allRows,
  selectedIds,
  quantities,
  loading,
  message,
  showCompleted,
  onSearchChange,
  onSelectProject,
  onToggleCompleted,
  onToggleItem,
  onToggleAll,
  onQuantityChange,
  onTransfer,
}) {
  const selectableCount = rows.filter((row) => Number(quantities[row.id] ?? row.remainingQuantity) > 0).length;
  const allVisibleSelected = selectableCount > 0
    && rows
      .filter((row) => Number(quantities[row.id] ?? row.remainingQuantity) > 0)
      .every((row) => selectedIds.includes(row.id));

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900">Projeye Bağlı Sipariş Oluştur</h2>
          <p className="mt-1 text-sm text-slate-500">
            Proje kalemlerinden eksik kalan ürünleri seçip mevcut sipariş formuna aktarın.
          </p>
        </div>
        <div className="rounded-xl bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700">
          {selectedIds.length} seçili
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-700">Proje ara</span>
            <input
              value={projectSearch}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Proje no, proje adı veya müşteri..."
              className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
            />
          </label>

          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelectProject(project.id)}
                className={`w-full rounded-xl border p-3 text-left text-sm transition ${selectedProjectId === project.id ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:border-blue-200"}`}
              >
                <div className="font-black text-slate-900">{project.project_code || "-"}</div>
                <div className="mt-1 line-clamp-2 text-xs font-semibold text-slate-600">{project.project_name || "-"}</div>
                <div className="mt-1 text-[11px] text-slate-500">{project.customer_name || "Müşteri yok"}</div>
              </button>
            ))}
            {projects.length === 0 && (
              <div className="rounded-xl bg-white p-4 text-sm text-slate-500">Aramaya uygun proje bulunamadı.</div>
            )}
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-slate-200">
          {!selectedProject && (
            <div className="p-8 text-center text-sm font-semibold text-slate-500">
              Proje seçildiğinde ürünler, eksikler, daha önce sipariş verilenler ve stok durumu burada listelenecek.
            </div>
          )}

          {selectedProject && (
            <>
              <div className="border-b border-slate-100 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-sm font-black text-slate-900">
                      {selectedProject.project_code} · {selectedProject.project_name}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {allRows.length} kalem bulundu · varsayılan görünümde sadece eksikler listelenir.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={showCompleted}
                        onChange={(event) => onToggleCompleted(event.target.checked)}
                      />
                      Tamamlananları göster
                    </label>
                    <button
                      type="button"
                      disabled={rows.length === 0}
                      onClick={onToggleAll}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      {allVisibleSelected ? "Seçimi Temizle" : "Görünenleri Seç"}
                    </button>
                    <button
                      type="button"
                      disabled={selectedIds.length === 0}
                      onClick={onTransfer}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:bg-slate-300"
                    >
                      Seçilenleri Siparişe Aktar
                    </button>
                  </div>
                </div>
                {message && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                    {message}
                  </div>
                )}
              </div>

              {loading ? (
                <div className="flex items-center gap-3 p-6 text-sm font-bold text-slate-600">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600" />
                  Proje kalemleri yükleniyor...
                </div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-sm font-semibold text-slate-500">
                  {showCompleted ? "Bu projede aktarılabilecek kalem bulunamadı." : "Eksik/kalan ihtiyaç bulunamadı. Tamamlananları göster seçeneğiyle tüm kalemleri görebilirsiniz."}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="p-3">Seç</th>
                        <th className="p-3">Ürün Kodu</th>
                        <th className="p-3">Ürün</th>
                        <th className="p-3">Birim</th>
                        <th className="p-3">İhtiyaç</th>
                        <th className="p-3">Sipariş</th>
                        <th className="p-3">Teslim</th>
                        <th className="p-3">Kalan</th>
                        <th className="p-3">Stok</th>
                        <th className="p-3">Eklenecek</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const quantityValue = quantities[row.id] ?? row.remainingQuantity;
                        return (
                          <tr key={row.id} className="border-t border-slate-100 align-top">
                            <td className="p-3">
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(row.id)}
                                disabled={Number(quantityValue || 0) <= 0}
                                onChange={() => onToggleItem(row.id)}
                                className="h-4 w-4"
                              />
                            </td>
                            <td className="p-3 font-bold text-slate-700">{row.product_code || "-"}</td>
                            <td className="p-3">
                              <div className="max-w-sm font-black text-slate-900">{row.product_name}</div>
                              {row.parent_name && <div className="mt-1 text-[11px] text-slate-500">{row.parent_name}</div>}
                            </td>
                            <td className="p-3">{row.unit || "adet"}</td>
                            <td className="p-3 font-bold">{row.needed}</td>
                            <td className="p-3 font-bold text-blue-700">{row.orderedQuantity}</td>
                            <td className="p-3 font-bold text-emerald-700">{row.deliveredQuantity}</td>
                            <td className={`p-3 font-black ${row.remainingQuantity > 0 ? "text-red-700" : "text-slate-500"}`}>{row.remainingQuantity}</td>
                            <td className="p-3 font-bold text-slate-700">{row.stockQuantity || 0}</td>
                            <td className="p-3">
                              <input
                                type="number"
                                min="0"
                                value={quantityValue}
                                onChange={(event) => onQuantityChange(row.id, event.target.value)}
                                className="w-24 rounded-lg border border-slate-300 px-2 py-1"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function OrderForm({
  formData,
  suppliers,
  projects,
  editingId,
  onChange,
  onSupplierChange,
  partnerChoice,
  onPartnerChoice,
  onItemChange,
  onAddItem,
  onDeleteItem,
  onCancel,
  onSubmit,
  liveRates,
  stockProducts = [],
}) {
  const items = useMemo(() => normalizeItems(formData.items), [formData.items]);
  const missingRequiredFields = [
    ["Sipariş No", formData.orderNo],
    ["İş Ortağı", formData.company],
    ["Sipariş Başlığı", formData.product],
    ["Sipariş Tarihi", formData.orderDate],
  ].filter(([, value]) => !String(value || "").trim());

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {editingId ? "Siparişi Düzenle" : "Sipariş Oluştur"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Rapor verileri geldiyse ürün kalemleri otomatik dolar; istersen elle
            de ekleyebilirsin.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700"
        >
          Vazgeç
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Input
          label="Sipariş No"
          name="orderNo"
          value={formData.orderNo}
          onChange={onChange}
          required
        />
        <SupplierInput
          label="İş Ortağı"
          name="company"
          value={formData.company}
          onChange={onSupplierChange}
          suppliers={suppliers}
          partnerChoice={partnerChoice}
          onPartnerChoice={onPartnerChoice}
          required
        />
        <Input
          label="Sipariş Başlığı"
          name="product"
          value={formData.product}
          onChange={onChange}
          required
        />
        <Select
          label="Durum"
          name="status"
          value={formData.status}
          onChange={onChange}
          options={editableStatusOptions}
        />
        <Select
          label="Proje"
          name="projectId"
          value={formData.projectId}
          onChange={onChange}
          options={[
            { label: "Proje yok", value: "" },
            ...projects.map((project) => ({
              label: `${project.project_code || ""} ${project.project_name || ""}`.trim(),
              value: project.id,
            })),
          ]}
        />
        <Input
          label="Sipariş Tarihi"
          name="orderDate"
          type="date"
          value={formData.orderDate}
          onChange={onChange}
          required
        />
        <Input
          label="Termin Tarihi"
          name="dueDate"
          type="date"
          value={formData.dueDate}
          onChange={onChange}
        />
        <Input
          label="Teslim Tarihi"
          name="deliveryDate"
          type="date"
          value={formData.deliveryDate}
          onChange={onChange}
          hint="Opsiyonel"
        />
        <Select
          label="Para Birimi"
          name="currency"
          value={formData.currency}
          onChange={onChange}
          options={currencyOptions}
        />
        <Input
          label="Kur"
          name="exchangeRate"
          type="number"
          value={formData.exchangeRate}
          onChange={onChange}
        />
      </div>

      <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-black text-blue-900">Sipariş kuru</div>
            <div className="mt-1 text-xs font-semibold text-blue-700">
              Sipariş kaydedildiğinde seçili kur hesaplamalarda sabit kur olarak kullanılabilir.
            </div>
          </div>
          <label className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-black text-blue-900 shadow-sm">
            <input
              type="checkbox"
              name="rateLocked"
              checked={Boolean(formData.rateLocked)}
              onChange={onChange}
              className="h-4 w-4"
            />
            Bu sipariş için kuru sabitle
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-blue-900">
          {["USD", "EUR", "GBP"].map((currency) => (
            <span key={currency} className="rounded-xl bg-white px-3 py-2">
              {currency}: {liveRateFor(currency, liveRates) ? formatMoney(liveRateFor(currency, liveRates), "TRY") : "Alınamadı"}
            </span>
          ))}
          {formData.rateLocked && (
            <span className="rounded-xl bg-blue-100 px-3 py-2 text-blue-800">
              Sabitlenen kur: {Number(formData.exchangeRate || 1).toLocaleString("tr-TR")}
            </span>
          )}
        </div>
      </div>

      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-bold text-slate-700">Not</span>
        <textarea
          name="note"
          value={formData.note}
          onChange={onChange}
          rows={2}
          className="w-full rounded-xl border border-slate-300 p-3 text-sm"
        />
      </label>

      {missingRequiredFields.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Zorunlu alanlar: {missingRequiredFields.map(([label]) => label).join(", ")}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Ürün Kalemleri</h3>
          <button
            type="button"
            onClick={onAddItem}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700"
          >
            + Ürün Ekle
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white text-slate-500">
              <tr>
                <th className="p-3">Ürün Kodu</th>
                <th className="p-3">Ürün / Rapor</th>
                <th className="p-3">Birim</th>
                <th className="p-3">Miktar</th>
                <th className="p-3">Gelen</th>
                <th className="p-3">Kalan</th>
                <th className="p-3">Birim Fiyat</th>
                <th className="p-3">İskonto</th>
                <th className="p-3">Tutar</th>
                <th className="p-3">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr
                  key={item.rowId}
                  className="border-t border-slate-200"
                >
                  <td className="p-3">
                    <ProductCodeInput
                      products={stockProducts}
                      value={item.productCode}
                      onChange={(value) => onItemChange(index, "productCode", value)}
                      onSelect={(product) => {
                        onItemChange(index, "productName", product.product_name || "");
                        onItemChange(index, "unit", product.unit || item.unit || "adet");
                      }}
                      placeholder="Kod"
                      className="w-28 rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-3">
                    <input
                      value={item.productName}
                      onChange={(event) =>
                        onItemChange(index, "productName", event.target.value)
                      }
                      className="w-full rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-3">
                    <input
                      value={item.unit}
                      onChange={(event) =>
                        onItemChange(index, "unit", event.target.value)
                      }
                      className="w-20 rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-3">
                    <input
                      type="number"
                      value={item.quantity}
                      onFocus={() => {
                        if (Number(item.quantity || 0) === 0) {
                          onItemChange(index, "quantity", "");
                        }
                      }}
                      onChange={(event) =>
                        onItemChange(index, "quantity", event.target.value)
                      }
                      className="w-24 rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max={item.quantity}
                        value={item.deliveredQuantity}
                        onFocus={() => {
                          if (Number(item.deliveredQuantity || 0) === 0) {
                            onItemChange(index, "deliveredQuantity", "");
                          }
                        }}
                        onChange={(event) =>
                          onItemChange(
                            index,
                            "deliveredQuantity",
                            event.target.value,
                          )
                        }
                        className="w-24 rounded border border-slate-300 px-2 py-1"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onItemChange(
                            index,
                            "deliveredQuantity",
                            item.quantity,
                          )
                        }
                        className="whitespace-nowrap rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-bold text-green-700"
                      >
                        Tamamı
                      </button>
                    </div>
                  </td>
                  <td className="p-3 font-semibold text-slate-700">
                    {Math.max(
                      Number(item.quantity || 0) -
                        Number(item.deliveredQuantity || 0),
                      0,
                    )}
                  </td>
                  <td className="p-3">
                    <div>
                      <input
                        type="number"
                        value={item.unitPrice}
                        onFocus={() => {
                          if (Number(item.unitPrice || 0) === 0) {
                            onItemChange(index, "unitPrice", "");
                          }
                        }}
                        onChange={(event) =>
                          onItemChange(index, "unitPrice", event.target.value)
                        }
                        className={`w-28 rounded border px-2 py-1 ${Number(item.unitPrice || 0) <= 0 ? "border-amber-300 bg-amber-50" : "border-slate-300"}`}
                      />
                      {Number(item.unitPrice || 0) <= 0 && (
                        <div className="mt-1 text-[11px] font-bold text-amber-700">Fiyat 0</div>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <input
                      type="number"
                      value={item.discount}
                      onFocus={() => {
                        if (Number(item.discount || 0) === 0) {
                          onItemChange(index, "discount", "");
                        }
                      }}
                      onChange={(event) =>
                        onItemChange(index, "discount", event.target.value)
                      }
                      className="w-20 rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-3 font-bold">
                    {formatMoney(item.total, formData.currency)}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => onDeleteItem(index)}
                      className="rounded bg-red-600 px-3 py-1 text-xs font-bold text-white"
                    >
                      Sil
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan="10" className="p-5 text-center text-slate-500">
                    Henüz ürün kalemi yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <div className="min-w-56 rounded-xl bg-white px-5 py-3 text-right shadow-sm">
            <div className="text-sm text-slate-500">Toplam Tutar</div>
            <div className="mt-1 text-xl font-black text-slate-900">
              {formatMoney(formData.totalAmount, formData.currency)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-slate-500">
          Teslim tarihi opsiyoneldir. Zorunlu alanlar yıldızla işaretlenir.
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border px-5 py-3 text-sm font-bold"
        >
          İptal
        </button>
        <button
          type="submit"
          className="rounded-xl bg-green-600 px-5 py-3 text-sm font-bold text-white hover:bg-green-700"
        >
          {editingId ? "Kaydet" : "Siparişi Oluştur"}
        </button>
        </div>
      </div>
    </form>
  );
}

function OrdersTable({ orders, liveRates, onView, onEdit, onDelete }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <h2 className="text-xl font-bold text-slate-900">Sipariş Listesi</h2>
        <p className="mt-1 text-sm text-slate-500">
          Durum ve termin odaklı sipariş görünümü.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-4">Sipariş No</th>
              <th className="p-4">Proje</th>
              <th className="p-4">Ana ürün / pano</th>
              <th className="p-4">İş Ortağı</th>
              <th className="p-4">Sipariş Tarihi</th>
              <th className="p-4">Termin</th>
              <th className="p-4">Toplam Tutar</th>
              <th className="p-4">Ödenen</th>
              <th className="p-4">Kalan Ödeme</th>
              <th className="p-4">Teslim</th>
              <th className="p-4">Durum</th>
              <th className="p-4">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-slate-100">
                <td className="p-4 font-bold text-slate-900">
                  {order.order_no}
                </td>
                <td className="p-4">
                  {order.project
                    ? `${order.project.project_code || ""} ${order.project.project_name || ""}`.trim()
                    : "-"}
                </td>
                <td className="p-4">{order.product_name || "-"}</td>
                <td className="p-4">{order.partner_name || order.supplier_name}</td>
                <td className="p-4">{order.order_date || "-"}</td>
                <td className="p-4">{order.termin_date || "-"}</td>
                <td className="p-4 font-semibold">
                  {formatMoney(order.total_amount, order.currency || "TRY")}
                  {order.currency && order.currency !== "TRY" && (
                    <div className="mt-1 text-[11px] font-bold text-slate-500">
                      Sabit kur: {Number(order.exchange_rate || 1).toLocaleString("tr-TR")} · Canlı: {liveRateFor(order.currency, liveRates) ? liveRateFor(order.currency, liveRates).toLocaleString("tr-TR", { maximumFractionDigits: 4 }) : "-"}
                      {liveRateFor(order.currency, liveRates) ? ` · Fark %${rateDiffPercent(order.exchange_rate, liveRateFor(order.currency, liveRates)).toFixed(1)}` : ""}
                    </div>
                  )}
                </td>
                <td className="p-4 font-semibold text-emerald-700">
                  {formatMoney(order.paidAmount, order.currency || "TRY")}
                </td>
                <td className="p-4 font-semibold text-orange-700">
                  {formatMoney(order.remainingPayment, order.currency || "TRY")}
                </td>
                <td className="p-4">
                  {order.deliveredQuantity}/{order.totalQuantity || 0}
                </td>
                <td className="p-4">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(order.status)}`}
                  >
                    {order.status}
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onView(order)}
                      className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700"
                    >
                      Detay
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(order)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold"
                    >
                      Düzenle
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(order.id)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600"
                    >
                      Sil
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan="12" className="p-8 text-center text-slate-500">
                  Henüz sipariş kaydı yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TerminTable({ orders }) {
  const dueOrders = [...orders]
    .filter(
      (order) => !["Teslim Edildi", "Tam Teslim", "İptal"].includes(order.status),
    )
    .sort(
      (a, b) =>
        new Date(a.termin_date || "2999-01-01") -
        new Date(b.termin_date || "2999-01-01"),
    )
    .slice(0, 6);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">
        Termin Takip Görünümü
      </h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3">Sipariş No</th>
              <th className="p-3">Firma</th>
              <th className="p-3">Termin</th>
              <th className="p-3">Kalan Süre</th>
              <th className="p-3">Durum</th>
            </tr>
          </thead>
          <tbody>
            {dueOrders.map((order) => {
              const remaining = daysUntil(order.termin_date);
              return (
                <tr key={order.id} className="border-t border-slate-100">
                  <td className="p-3 font-bold">{order.order_no}</td>
                  <td className="p-3">{order.partner_name || order.supplier_name}</td>
                  <td className="p-3">{order.termin_date || "-"}</td>
                  <td className="p-3">
                    {remaining === null
                      ? "-"
                      : <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            remaining < 0
                              ? "bg-red-100 text-red-700"
                              : remaining <= 7
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {remaining < 0
                            ? `${Math.abs(remaining)} gün geçti`
                            : `${remaining} gün kaldı`}
                        </span>}
                  </td>
                  <td className="p-3">{order.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Input({ label, name, value, onChange, type = "text", required = false, hint = "" }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
        {label}
        {required && <span className="text-red-600">*</span>}
        {hint && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{hint}</span>}
      </span>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        className={`w-full rounded-xl border p-3 text-sm ${required && !String(value || "").trim() ? "border-amber-300 bg-amber-50" : "border-slate-300"}`}
      />
    </label>
  );
}

function Select({ label, name, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">
        {label}
      </span>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-slate-300 p-3 text-sm"
      >
        {options.map((option) => {
          const item =
            typeof option === "string"
              ? { label: option, value: option }
              : option;
          return (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function SupplierInput({ label, name, value, onChange, suppliers, partnerChoice, onPartnerChoice, required = false }) {
  const matches = findPartnerMatches(suppliers, { name: value }, { threshold: 0.65, limit: 3 });

  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
        {label}
        {required && <span className="text-red-600">*</span>}
      </span>
      <input
        list="supplier-options"
        name={name}
        value={value}
        onChange={onChange}
        className={`w-full rounded-xl border p-3 text-sm ${required && !String(value || "").trim() ? "border-amber-300 bg-amber-50" : "border-slate-300"}`}
      />
      <datalist id="supplier-options">
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.name}>
            {supplier.status || "Aktif"}
          </option>
        ))}
      </datalist>
      {String(value || "").trim().length >= 2 && (
        <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
          <div className="text-xs font-black text-blue-900">Benzer iş ortakları</div>
          <div className="mt-2 space-y-2">
            {matches.map((match) => (
              <button
                key={match.partner.id}
                type="button"
                onClick={() => {
                  onChange({ target: { name, value: match.partner.name } });
                  onPartnerChoice({ mode: "existing", partnerId: match.partner.id });
                }}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs font-bold ${partnerChoice?.partnerId === match.partner.id ? "border-blue-500 bg-white text-blue-900" : "border-blue-100 bg-white/70 text-slate-700"}`}
              >
                <span>{match.partner.name}</span>
                <span>%{Math.round(match.score * 100)} · Mevcut firmayı kullan</span>
              </button>
            ))}
            {matches.length === 0 && <div className="text-xs text-slate-600">Benzer kayıt bulunamadı.</div>}
            <button
              type="button"
              onClick={() => onPartnerChoice({ mode: "new" })}
              className={`w-full rounded-lg border px-3 py-2 text-left text-xs font-black ${partnerChoice?.mode === "new" ? "border-amber-500 bg-amber-100 text-amber-900" : "border-amber-200 bg-white text-amber-800"}`}
            >
              Yeni firma oluştur
            </button>
          </div>
        </div>
      )}
    </label>
  );
}
