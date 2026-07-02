"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CORVIAN_PRODUCT_NAME, fetchCompanyBranding } from "@/lib/companyBranding";

const summaryModes = {
  missing: {
    title: "Satın Alma Gerekenler",
    shortTitle: "Satın alma",
    description: "Bu ekranda seçili projelerde stoktan karşılanamayan ürünlerden talep listesi oluşturabilirsiniz.",
    filePrefix: "satin-alma-gerekenler",
    emptyText: "Seçili projelerde satınalma gerektiren eksik malzeme bulunamadı.",
    nextStep: "Satın alınacak kalemleri seçin, ardından Talep Listesi Oluştur butonuyla Talepler modülüne aktarın.",
  },
  stock: {
    title: "Stoktan Karşılanacaklar",
    shortTitle: "Stoktan",
    description: "Bu ekranda stokta bulunan ürünleri seçili projelere güvenli şekilde ayırabilirsiniz.",
    filePrefix: "stoktan-karsilanacaklar",
    emptyText: "Seçili projelerde stoktan karşılanabilecek açık kalem bulunamadı.",
    nextStep: "Ürünleri seçip stoktan karşılayın. İşlem ürün stoğunu silmez; projeye ayrılan miktarı reserved_quantity olarak işler.",
  },
  all: {
    title: "Tüm Malzeme Listesi",
    shortTitle: "Tüm liste",
    description: "Seçili projelerdeki tüm malzemeleri, stok ve satınalma durumlarıyla birlikte görürsünüz.",
    filePrefix: "tum-malzeme-listesi",
    emptyText: "Seçili projelerde ihtiyaç kalemi bulunamadı.",
    nextStep: "Bu ekran kontrol amaçlıdır. Stoktan işlem için Stoktan Karşılanacaklar, satınalma için Satın Alma Gerekenler ekranını kullanın.",
  },
};

function number(value) {
  return Number(value || 0) || 0;
}

function normalizeCode(value) {
  return String(value || "").trim().toLocaleUpperCase("tr-TR");
}

function normalizeText(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function isProjectSeriesCode(value) {
  return /^PRJ-\d{3,}$/i.test(String(value || "").trim());
}

function stockProductCode(value) {
  const code = normalizeCode(value);
  return code && !isProjectSeriesCode(code) ? code : "";
}

function isAutoStockCode(value) {
  return /^CRVM\d{9}$/i.test(String(value || "").trim());
}

function normalizeProductIdentity(item) {
  const rawBrand = String(item?.brand || "").trim();
  let productName = String(item?.product_name || item?.description || "").trim();
  let brand = rawBrand && rawBrand !== "-" ? rawBrand : "";

  if (!brand && productName) {
    const leadingQuantityBrand = productName.match(/^\s*\d+(?:[.,]\d+)?\s+([A-Za-zÇĞİÖŞÜçğıöşü]{2,})\s+(.+)$/);
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

  return {
    brand: normalizeText(brand),
    productName: normalizeText(productName),
    unit: normalizeText(item?.unit || "adet"),
  };
}

function productIdentityKey(item) {
  const identity = normalizeProductIdentity(item);
  return `name:${identity.productName}|brand:${identity.brand}|unit:${identity.unit}`;
}

function looseProductIdentityKey(item) {
  const identity = normalizeProductIdentity(item);
  return `name:${identity.productName}|unit:${identity.unit}`;
}


function movementMatchesProduct(movement, product) {
  if (!movement || !product) return false;
  if (movement.product_id && movement.product_id === product.id) return true;

  const productCode = stockProductCode(product.normalized_product_code || product.product_code);
  const movementCode = stockProductCode(movement.product_code);
  if (productCode && movementCode) return productCode === movementCode;

  const productIdentity = normalizeProductIdentity(product);
  const movementIdentity = normalizeProductIdentity(movement);
  return productIdentity.productName === movementIdentity.productName
    && productIdentity.unit === movementIdentity.unit;
}

function productReservedFromMovements(product, movements) {
  if (!product) return 0;
  return (movements || [])
    .filter((movement) => movementMatchesProduct(movement, product))
    .reduce((sum, movement) => sum + number(movement.reserved_quantity), 0);
}

function safeFileName(value) {
  return String(value || "malzeme-listesi").replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ_-]+/g, "-");
}

function shortText(value, maxLength = 28) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function AllocationChip({ allocation, unit = "adet" }) {
  return (
    <div className="rounded-lg bg-slate-100 px-2.5 py-2 text-[11px] font-semibold leading-snug text-slate-700">
      <div className="flex min-w-0 items-center gap-1">
        <span className="shrink-0 font-black text-slate-950">{allocation.projectCode || "Proje"}</span>
        <span className="text-slate-400">·</span>
        <span className="truncate" title={allocation.projectName || ""}>
          {shortText(allocation.projectName || "-", 22)}
        </span>
      </div>
      <div className="mt-1 text-slate-600">
        Gerekli {number(allocation.quantity)} · Stoktan {number(allocation.stockCoverableQuantity)} · Alinacak {number(allocation.purchaseQuantity)} {unit}
      </div>
      {allocation.parentItemName ? (
        <div className="mt-1 truncate text-slate-500" title={allocation.parentItemName}>
          Ana ürün: {shortText(allocation.parentItemName, 24)}
        </div>
      ) : null}
    </div>
  );
}

function orderAllocationQuantities(orders) {
  const quantities = new Map();
  (orders || [])
    .filter((order) => !["İptal", "Tam Teslim"].includes(order.status))
    .forEach((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      items.forEach((item) => {
        (Array.isArray(item.allocations) ? item.allocations : []).forEach((allocation) => {
          if (!allocation.projectItemId) return;
          const remaining = Math.max(number(allocation.quantity) - number(allocation.receivedQuantity), 0);
          quantities.set(allocation.projectItemId, number(quantities.get(allocation.projectItemId)) + remaining);
        });
      });
    });
  return quantities;
}

function stockMovementReservedQuantities(movements) {
  const quantities = new Map();
  (movements || []).forEach((movement) => {
    if (!movement.project_item_id) return;
    quantities.set(
      movement.project_item_id,
      number(quantities.get(movement.project_item_id)) + number(movement.reserved_quantity),
    );
  });
  return quantities;
}

function requestItemsArray(request) {
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

function requestAllocationQuantities(requests) {
  const quantities = new Map();
  (requests || [])
    .filter((request) => !["İptal", "Iptal", "Tamamlandı"].includes(request.durum || request.status))
    .forEach((request) => {
      requestItemsArray(request).forEach((item) => {
        const allocations = Array.isArray(item.allocations) ? item.allocations : [];
        const directIds = [
          item.projectItemId,
          item.project_item_id,
          ...(item.projectItemIds || []),
          ...(item.project_item_ids || []),
        ].filter(Boolean);
        if (allocations.length === 0) {
          directIds.forEach((projectItemId) => {
            const quantity = number(item.purchase_quantity || item.purchaseQuantity || item.quantity || item.talepEdilenAdet);
            quantities.set(String(projectItemId), number(quantities.get(String(projectItemId))) + quantity);
          });
        }
        allocations.forEach((allocation) => {
          const projectItemId = allocation.projectItemId || allocation.project_item_id;
          if (!projectItemId) return;
          const quantity = number(allocation.purchaseQuantity || allocation.purchase_quantity || allocation.quantity);
          quantities.set(String(projectItemId), number(quantities.get(String(projectItemId))) + quantity);
        });
      });
    });
  return quantities;
}

function buildSummary(projects, projectItems, products, orders, stockMovements = [], requests = []) {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const itemsById = new Map(projectItems.map((item) => [item.id, item]));
  const orderedByProjectItem = orderAllocationQuantities(orders);
  const reservedByProjectItem = stockMovementReservedQuantities(stockMovements);
  const requestedByProjectItem = requestAllocationQuantities(requests);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const productsByCode = new Map(
    products
      .map((product) => [stockProductCode(product.normalized_product_code || product.product_code), product])
      .filter(([code]) => code),
  );
  const productsByIdentity = new Map(
    products
      .map((product) => [productIdentityKey(product), product])
      .filter(([key]) => !key.includes("name:|")),
  );
  const productsByLooseIdentity = new Map(
    products
      .map((product) => [looseProductIdentityKey(product), product])
      .filter(([key]) => !key.includes("name:|")),
  );
  const grouped = new Map();

  projectItems
    .filter((item) => item.item_type !== "main")
    .forEach((item) => {
      const estimated = number(item.estimated_quantity);
      const received = number(item.received_quantity);
      const projectReserved = Math.max(
        number(item.reserved_quantity ?? item.reserved_child_quantity),
        number(reservedByProjectItem.get(item.id)),
      );
      const alreadyOrdered = number(orderedByProjectItem.get(item.id));
      const alreadyRequested = number(requestedByProjectItem.get(String(item.id)));
      const openQuantity = Math.max(estimated - received - projectReserved - alreadyOrdered, 0);
      if (estimated <= 0 && openQuantity <= 0 && received <= 0 && projectReserved <= 0 && alreadyOrdered <= 0) return;

      const itemStockCode = stockProductCode(item.product_code);
      const matchedProduct = productsById.get(item.product_id)
        || productsByCode.get(itemStockCode)
        || productsByIdentity.get(productIdentityKey(item))
        || productsByLooseIdentity.get(looseProductIdentityKey(item));
      const normalizedProductCode = normalizeCode(
        matchedProduct?.normalized_product_code || matchedProduct?.product_code || itemStockCode,
      );
      const normalizedUnit = normalizeText(item.unit || matchedProduct?.unit || "adet");
      const resolvedProductId = matchedProduct?.id || item.product_id || null;
      const identityKey = looseProductIdentityKey({ ...item, unit: normalizedUnit });
      const shouldGroupByIdentity = isAutoStockCode(itemStockCode) || isAutoStockCode(normalizedProductCode) || !itemStockCode;
      const key = shouldGroupByIdentity
        ? identityKey
        : resolvedProductId
        ? `product:${resolvedProductId}`
        : normalizedProductCode
          ? `code:${normalizedProductCode}`
          : identityKey;
      const project = projectsById.get(item.project_id);
      const parent = itemsById.get(item.parent_item_id);

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          productId: resolvedProductId,
          normalizedProductCode,
          productCode: matchedProduct?.product_code || itemStockCode || "",
          productName: matchedProduct?.product_name || item.product_name || "",
          brand: matchedProduct?.brand || item.brand || "",
          unit: matchedProduct?.unit || item.unit || "adet",
          sourceUnits: new Set(),
          requestedQuantity: 0,
          totalNeed: 0,
          receivedQuantity: 0,
          reservedQuantity: 0,
          orderedQuantity: 0,
          allocations: [],
          currentStock: number(matchedProduct?.current_stock),
          reservedStock: number(matchedProduct?.reserved_stock) + productReservedFromMovements(matchedProduct, stockMovements),
        });
      }

      const row = grouped.get(key);
      if (!row.productId && resolvedProductId) row.productId = resolvedProductId;
      if (!row.normalizedProductCode && normalizedProductCode) row.normalizedProductCode = normalizedProductCode;
      if (!row.productCode && (matchedProduct?.product_code || itemStockCode)) {
        row.productCode = matchedProduct?.product_code || itemStockCode || "";
      }
      if (!row.productName && (matchedProduct?.product_name || item.product_name)) {
        row.productName = matchedProduct?.product_name || item.product_name || "";
      }
      if (!row.brand && (matchedProduct?.brand || item.brand)) {
        row.brand = matchedProduct?.brand || item.brand || "";
      }
      row.sourceUnits.add(normalizeText(item.unit || matchedProduct?.unit || "adet"));
      row.requestedQuantity += estimated;
      row.totalNeed += openQuantity;
      row.receivedQuantity += received;
      row.reservedQuantity += projectReserved;
      row.orderedQuantity += alreadyOrdered;
      row.allocations.push({
        type: "project",
        projectId: item.project_id,
        projectCode: project?.project_code || "",
        projectName: project?.project_name || "",
        projectItemId: item.id,
        parentItemId: item.parent_item_id || null,
        parentItemName: parent?.product_name || "",
        itemType: item.item_type || "sub",
        quantity: openQuantity,
        requestedQuantity: estimated,
        estimatedQuantity: estimated,
        receivedQuantity: received,
        reservedQuantity: projectReserved,
        orderedQuantity: alreadyOrdered,
        requestedPurchaseQuantity: alreadyRequested,
        productId: resolvedProductId,
      });
    });

  return Array.from(grouped.values()).map((row) => {
    const availableStock = Math.max(row.currentStock - row.reservedStock, 0);
    const stockCoverable = Math.min(row.totalNeed, availableStock);
    const missingQuantity = Math.max(row.totalNeed - stockCoverable, 0);
    const sourceUnits = Array.from(row.sourceUnits);
    let remainingStockToAllocate = stockCoverable;
    const allocations = row.allocations.map((allocation) => {
      const allocationStockCoverable = Math.min(number(allocation.quantity), remainingStockToAllocate);
      remainingStockToAllocate -= allocationStockCoverable;
      const allocationMissing = Math.max(number(allocation.quantity) - allocationStockCoverable, 0);
      const allocationRequested = Math.min(number(allocation.requestedPurchaseQuantity), allocationMissing);
      const allocationPurchaseQuantity = Math.max(allocationMissing - allocationRequested, 0);
      const statusLabel = number(allocation.quantity) <= 0
        ? "Tamamlandı"
        : allocationPurchaseQuantity <= 0 && allocationRequested > 0
          ? "Talep oluşturuldu"
        : allocationStockCoverable >= number(allocation.quantity)
          ? "Stoktan karşılanabilir"
        : allocationStockCoverable > 0
            ? "Kısmen stoktan"
            : "Satınalma gerekli";
      return {
        ...allocation,
        stockCoverableQuantity: allocationStockCoverable,
        requestedPurchaseQuantity: allocationRequested,
        purchaseQuantity: allocationPurchaseQuantity,
        statusLabel,
      };
    });
    const purchaseQuantity = allocations.reduce((sum, allocation) => sum + number(allocation.purchaseQuantity), 0);
    const statusLabel = row.totalNeed <= 0
      ? "Tamamlandı"
      : purchaseQuantity <= 0 && allocations.some((allocation) => number(allocation.requestedPurchaseQuantity) > 0)
        ? "Talep oluşturuldu"
      : stockCoverable >= row.totalNeed
        ? "Stoktan karşılanabilir"
        : stockCoverable > 0
          ? "Kısmen stoktan"
          : "Satınalma gerekli";
    return {
      ...row,
      allocations,
      sourceUnits,
      unitConflict: sourceUnits.length > 1,
      availableStock,
      stockCoverable,
      missingQuantity,
      purchaseQuantity,
      statusLabel,
    };
  });
}

function filterRowsByMode(rows, mode) {
  if (mode === "stock") return rows.filter((row) => row.stockCoverable > 0);
  if (mode === "all") return rows;
  return rows.filter((row) => row.purchaseQuantity > 0);
}

function allocationProjectLabel(allocation) {
  return [allocation.projectCode, allocation.projectName].filter(Boolean).join(" - ") || "Proje";
}

function formatDistributionSummary(row) {
  const projects = new Map();
  (row.allocations || []).forEach((allocation) => {
    const key = allocation.projectId || allocationProjectLabel(allocation);
    const current = projects.get(key) || {
      label: allocation.projectCode || allocationProjectLabel(allocation),
      parentNames: new Set(),
    };
    if (allocation.parentItemName) current.parentNames.add(allocation.parentItemName);
    projects.set(key, current);
  });

  return Array.from(projects.values()).map((project) => {
    const parentNames = Array.from(project.parentNames).filter(Boolean);
    if (parentNames.length === 0) return project.label;
    const visibleParents = parentNames.slice(0, 3).join("; ");
    const hiddenCount = Math.max(parentNames.length - 3, 0);
    return hiddenCount > 0
      ? `${project.label}: ${visibleParents}; +${hiddenCount} ana ürün`
      : `${project.label}: ${visibleParents}`;
  }).join(" | ");
}

function exportRows(rows, mode) {
  return rows.map((row, index) => {
    const base = {
      "Sira": index + 1,
      "Urun Kodu": row.productCode || row.normalizedProductCode || "-",
      "Urun Aciklamasi": row.productName,
      "Marka": row.brand || "-",
      "Birim": row.unit,
      "Gerekli": row.totalNeed,
    };

    if (mode !== "missing") {
      base["Stokta"] = row.availableStock;
      base["Stoktan Ayrilacak"] = row.stockCoverable;
    }

    if (mode !== "stock") {
      base["Satin Alinacak"] = row.purchaseQuantity;
    }

    base["Durum"] = row.statusLabel;
    base["Proje Dagilimi"] = formatDistributionSummary(row);
    return base;
  });
}


function purchaseAllocations(allocations, purchaseQuantity) {
  const source = (allocations || []).filter((allocation) => number(allocation.quantity) > 0);
  const total = source.reduce((sum, allocation) => sum + number(allocation.quantity), 0);
  let allocated = 0;
  return source.map((allocation, index) => {
    const quantity = index === source.length - 1
      ? Math.max(purchaseQuantity - allocated, 0)
      : Math.min(Number((purchaseQuantity * number(allocation.quantity) / total).toFixed(6)), Math.max(purchaseQuantity - allocated, 0));
    allocated += quantity;
    return { ...allocation, quantity };
  }).filter((allocation) => allocation.quantity > 0);
}

export default function ProcurementSummaryPage() {
  const router = useRouter();
  const [mode, setMode] = useState("missing");
  const modeConfig = summaryModes[mode];
  const [projects, setProjects] = useState([]);
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [reservingStock, setReservingStock] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [lastCreatedRequestId, setLastCreatedRequestId] = useState("");
  const [allocationDetailRow, setAllocationDetailRow] = useState(null);

  async function loadSummaryData(nextMessage = "") {
    setLoading(true);
    let selectedIds = [];
    try {
      selectedIds = JSON.parse(localStorage.getItem("procurementSummaryProjectIds") || "[]");
    } catch {
      selectedIds = [];
    }
    if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
      setMessage("Malzeme listesi için proje seçimi bulunamadı.");
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const [projectResult, itemResult, productResult, orderResult, movementResult, requestResult] = await Promise.all([
      supabase.from("projects").select("id,project_code,project_name,status").eq("user_id", user.id).in("id", selectedIds),
      supabase.from("project_items").select("*").eq("user_id", user.id).in("project_id", selectedIds),
      supabase.from("products").select("id,product_code,normalized_product_code,product_name,brand,unit,current_stock,reserved_stock").eq("user_id", user.id).is("archived_at", null),
      supabase.from("orders").select("id,status,items").eq("user_id", user.id),
      supabase.from("stock_movements").select("id,project_item_id,product_id,product_code,product_name,unit,reserved_quantity").eq("user_id", user.id),
      supabase.from("requests").select("id,project_id,durum,items").eq("user_id", user.id),
    ]);
    const error = projectResult.error || itemResult.error || productResult.error || orderResult.error || movementResult.error || requestResult.error;
    if (error) {
      setMessage(`Malzeme listesi yüklenemedi: ${error.message}`);
      setLoading(false);
      return;
    }
    const tenantProjects = projectResult.data || [];
    setProjects(tenantProjects);
    const selectedRequests = (requestResult.data || []).filter((request) => {
      if (request.project_id && selectedIds.includes(request.project_id)) return true;
      return requestItemsArray(request).some((item) =>
        (Array.isArray(item.allocations) ? item.allocations : []).some((allocation) =>
          selectedIds.includes(allocation.projectId || allocation.project_id)
        )
      );
    });
    setAllRows(buildSummary(tenantProjects, itemResult.data || [], productResult.data || [], orderResult.data || [], movementResult.data || [], selectedRequests));
    setMessage(nextMessage);
    setLoading(false);
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      const nextMode = new URLSearchParams(window.location.search).get("mode");
      setMode(summaryModes[nextMode] ? nextMode : "missing");
    }
    loadSummaryData();
  }, [router]);

  const rows = useMemo(() => filterRowsByMode(allRows, mode), [allRows, mode]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedRowKeys.includes(row.key)),
    [rows, selectedRowKeys],
  );

  useEffect(() => {
    const visibleKeys = new Set(rows.map((row) => row.key));
    setSelectedRowKeys((current) => current.filter((key) => visibleKeys.has(key)));
  }, [rows]);

  const totals = useMemo(() => rows.reduce((summary, row) => ({
    requested: summary.requested + row.requestedQuantity,
    need: summary.need + row.totalNeed,
    stock: summary.stock + row.stockCoverable,
    purchase: summary.purchase + row.purchaseQuantity,
  }), { requested: 0, need: 0, stock: 0, purchase: 0 }), [rows]);

  function toggleRowSelection(rowKey) {
    setSelectedRowKeys((current) =>
      current.includes(rowKey)
        ? current.filter((key) => key !== rowKey)
        : [...current, rowKey],
    );
  }

  function toggleAllRows() {
    const visibleKeys = rows.map((row) => row.key);
    const allSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedRowKeys.includes(key));
    setSelectedRowKeys(allSelected ? [] : visibleKeys);
  }

  function rowsForAction(selectedOnly = false) {
    return selectedOnly && selectedRows.length > 0 ? selectedRows : rows;
  }

  async function downloadExcel() {
    const { companyName } = await fetchCompanyBranding(supabase);
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.aoa_to_sheet([
      [companyName], [CORVIAN_PRODUCT_NAME], [modeConfig.title, new Date().toLocaleString("tr-TR")], [],
    ]);
    XLSX.utils.sheet_add_json(summarySheet, exportRows(rows, mode), { origin: "A5" });
    XLSX.utils.book_append_sheet(workbook, summarySheet, modeConfig.shortTitle);
    const distribution = rows.flatMap((row) => row.allocations.map((allocation) => ({
      "Ürün Kodu": row.productCode || row.normalizedProductCode,
      "Ürün": row.productName,
      "Marka": row.brand || "-",
      "Proje Kodu": allocation.projectCode,
      "Proje": allocation.projectName,
      "Proje Kalemi": allocation.projectItemId,
      "Ana Ürün": allocation.parentItemName || "-",
      "Toplam İhtiyaç": allocation.requestedQuantity,
      "Açık İhtiyaç": allocation.quantity,
      "Stoktan Karşılanabilir": allocation.stockCoverableQuantity,
      "Satın Alınacak": allocation.purchaseQuantity,
      "Durum": allocation.statusLabel,
      "Birim": row.unit,
    })));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(distribution), "Proje Dağılımı");
    XLSX.writeFile(workbook, `${safeFileName(`${modeConfig.filePrefix}-${new Date().toISOString().slice(0, 10)}`)}.xlsx`);
  }

  async function downloadPdf() {
    const { companyName } = await fetchCompanyBranding(supabase);
    const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(16); doc.text(companyName, 40, 34);
    doc.setFontSize(9); doc.setTextColor(90); doc.text(`${CORVIAN_PRODUCT_NAME} · ${modeConfig.title} · ${new Date().toLocaleString("tr-TR")}`, 40, 50);
    autoTable(doc, {
      startY: 66,
      head: [["Kod", "Urun", "Birim", "Gerekli", "Stokta", "Stoktan", "Alinacak", "Durum", "Proje dagilimi"]],
      body: rows.map((row) => [row.productCode || "-", row.productName, row.unit, row.totalNeed, row.availableStock, row.stockCoverable, row.purchaseQuantity, row.statusLabel, formatDistributionSummary(row)]),
      styles: { fontSize: 7, cellPadding: 4 }, headStyles: { fillColor: [30, 64, 175] },
    });
    doc.save(`${safeFileName(`${modeConfig.filePrefix}-${new Date().toISOString().slice(0, 10)}`)}.pdf`);
  }

  async function createRequestForOffers(selectedOnly = false) {
    const actionRows = rowsForAction(selectedOnly).filter((row) => row.purchaseQuantity > 0);
    if (creatingRequest || actionRows.length === 0) {
      setMessage("Talep listesi oluşturmak için satın alınacak miktarı olan kalem seçin.");
      return;
    }
    const conflicts = actionRows.filter((row) => row.unitConflict);
    if (conflicts.length > 0) {
      setMessage(`${conflicts.length} ürün kodunda birim çakışması var. Proje kalemlerinin birimleri düzeltilmeden teklif akışı başlatılmadı.`);
      return;
    }
    setCreatingRequest(true);
    setLastCreatedRequestId("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    const requester = window.prompt("Talebi açan kişi kim?") || "";
    const department = window.prompt("Talebi açan birim / departman nedir?") || "";
    const items = actionRows.map((row) => ({
      product_id: row.productId,
      product_code: row.productCode,
      normalized_product_code: row.normalizedProductCode,
      product_name: row.productName,
      brand: row.brand,
      unit: row.unit,
      quantity: row.purchaseQuantity,
      talepEdilenAdet: row.purchaseQuantity,
      current_stock: row.currentStock,
      reserved_stock: row.reservedStock,
      stock_coverable_quantity: row.stockCoverable,
      purchase_quantity: row.purchaseQuantity,
      allocations: purchaseAllocations(row.allocations, row.purchaseQuantity),
      request_meta: {
        source: "project",
        requester: requester.trim(),
        department: department.trim(),
        priority: "Normal",
        createdBy: user.email || user.id,
      },
    }));
    if (items.length === 0) {
      setMessage("Satın alınacak açık miktar bulunmuyor.");
      setCreatingRequest(false);
      return;
    }
    const { data, error } = await supabase.from("requests").insert({
      user_id: user.id,
      project_id: projects.length === 1 ? projects[0].id : null,
      ad: `${modeConfig.title} · ${new Date().toLocaleDateString("tr-TR")}`,
      durum: "Teklif Bekliyor",
      totalitems: items.length,
      items,
    }).select("id").single();
    setCreatingRequest(false);
    if (error) { setMessage(`Talep oluşturulamadı: ${error.message}`); return; }
    setLastCreatedRequestId(data.id);
    await loadSummaryData(`Talep listesi oluşturuldu. ${items.length} kalem Talepler modülüne aktarıldı.`);
  }

  async function reserveVisibleStockRows(selectedOnly = false) {
    const actionRows = rowsForAction(selectedOnly).filter((row) => row.stockCoverable > 0);
    if (reservingStock || actionRows.length === 0) {
      setMessage("Stoktan karşılamak için stoktan ayrılabilir kalem seçin.");
      return;
    }
    const allocations = actionRows.flatMap((row) =>
      row.allocations
        .filter((allocation) => row.productId && allocation.projectItemId && allocation.stockCoverableQuantity > 0)
        .map((allocation) => ({
          product_id: row.productId,
          project_id: allocation.projectId,
          project_item_id: allocation.projectItemId,
          parent_item_id: allocation.parentItemId,
          quantity: allocation.stockCoverableQuantity,
          product_code: row.productCode || row.normalizedProductCode || "",
          product_name: row.productName || "",
          unit: row.unit || "adet",
          notes: `${allocation.projectCode || allocation.projectName || "Proje"} için çok projeli stok listesinden ayrıldı`,
        })),
    );

    if (allocations.length === 0) {
      setMessage("Stoktan ayrılabilecek uygun kalem bulunamadı.");
      return;
    }

    const approved = window.confirm(`${allocations.length} proje kalemi için stoktan ayrım yapılacak. Devam edilsin mi?`);
    if (!approved) return;

    setReservingStock(true);
    setMessage("Seçili proje listesi stoktan karşılanıyor...");
    const { data, error } = await supabase.rpc("reserve_project_items_from_stock", {
      p_allocations: allocations,
    });
    setReservingStock(false);

    if (error) {
      setMessage(`Stoktan karşılama tamamlanamadı: ${error.message}`);
      return;
    }

    const result = data || {};
    const failed = Array.isArray(result.failed) ? result.failed : [];
    const processed = Number(result.processed || 0);
    const reservedQuantity = Number(result.reserved_quantity || 0);
    setMessage(
      failed.length > 0
        ? `${processed} kalem stoktan ayrıldı (${reservedQuantity} ${rows[0]?.unit || "adet"}). ${failed.length} kalem işlenemedi: ${failed.slice(0, 3).map((item) => item.reason).join(" | ")}`
        : `${processed} kalem stoktan ayrıldı. Toplam ayrılan miktar: ${reservedQuantity}.`,
    );
    await loadSummaryData(
      failed.length > 0
        ? `${processed} kalem stoktan ayrıldı (${reservedQuantity}). ${failed.length} kalem işlenemedi.`
        : `${processed} kalem stoktan ayrıldı. Toplam ayrılan miktar: ${reservedQuantity}.`,
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8">
      <main className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl">
          <Link href="/dashboard/projeler" className="text-sm font-bold text-blue-200">← Projelere dön</Link>
          <h1 className="mt-3 text-3xl font-black">{modeConfig.title}</h1>
          <p className="mt-2 text-sm text-slate-300">{modeConfig.description}</p>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/10 p-4 text-sm font-semibold text-blue-50">
            Sıradaki adım: {modeConfig.nextStep}
          </div>
          <p className="mt-2 text-xs font-semibold text-slate-400">{projects.map((project) => `${project.project_code} · ${project.project_name}`).join(" | ")}</p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Metric label="Kalem sayisi" value={rows.length} />
            <Metric label="Gerekli" value={totals.need} />
            {mode !== "missing" && <Metric label="Stoktan" value={totals.stock} />}
            {mode !== "stock" && <Metric label="Alinacak" value={totals.purchase} />}
          </div>
        </div>
        {message && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 font-semibold text-amber-900">{message}</div>}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-black text-slate-900">{rows.length} ürün listeleniyor</div>
              <div className="text-sm font-semibold text-slate-500">
                {selectedRows.length > 0 ? `${selectedRows.length} ürün seçili.` : "İşlem yapmak için ürün seçebilir veya tüm listeyi kullanabilirsiniz."}
              </div>
            </div>
            <button type="button" onClick={toggleAllRows} disabled={!rows.length} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700 disabled:bg-slate-100">
              {rows.length > 0 && rows.every((row) => selectedRowKeys.includes(row.key)) ? "Seçimi Temizle" : "Tümünü Seç"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={downloadExcel} disabled={!rows.length} className="rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:bg-slate-300">İndir</button>
          {mode === "stock" ? (
            <>
              <button
                type="button"
                onClick={() => reserveVisibleStockRows(false)}
                disabled={!rows.length || reservingStock}
                className="rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:bg-slate-300"
              >
                {reservingStock ? "Stoktan ayrılıyor..." : "Tümünü Stoktan Karşıla"}
              </button>
              <button
                type="button"
                onClick={() => reserveVisibleStockRows(true)}
                disabled={selectedRows.length === 0 || reservingStock}
                className="rounded-xl bg-slate-900 px-4 py-3 font-bold text-white disabled:bg-slate-300"
              >
                Seçili Ürünleri Stoktan Karşıla
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => createRequestForOffers(false)} disabled={!rows.length || creatingRequest || totals.purchase <= 0} className="rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:bg-slate-300">{creatingRequest ? "Hazırlanıyor..." : "Talep Listesi Oluştur"}</button>
              <button type="button" onClick={() => createRequestForOffers(true)} disabled={selectedRows.length === 0 || creatingRequest} className="rounded-xl bg-slate-900 px-4 py-3 font-bold text-white disabled:bg-slate-300">Seçili Kalemlerden Talep Oluştur</button>
              {lastCreatedRequestId && (
                <>
                  <button type="button" onClick={() => router.push(`/dashboard/talepler?createdRequestId=${lastCreatedRequestId}`)} className="rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">
                    Talepler Modülünde Gör
                  </button>
                  <button type="button" onClick={() => router.push(`/dashboard/teklifler?requestId=${lastCreatedRequestId}`)} className="rounded-xl bg-purple-700 px-4 py-3 font-bold text-white">
                    Teklif Toplamaya Geç
                  </button>
                </>
              )}
            </>
          )}
          </div>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
              <th className="p-3">Sec</th><th className="p-3">Kod / Urun</th><th className="p-3">Marka</th><th className="p-3">Birim</th><th className="p-3">Gerekli</th><th className="p-3">Stokta</th>{mode !== "missing" && <th className="p-3">Stoktan</th>}{mode !== "stock" && <th className="p-3">Alinacak</th>}<th className="p-3">Durum</th><th className="p-3">Proje dagilimi</th>
            </tr></thead>
            <tbody>{rows.map((row) => <tr key={row.key} className="border-t align-top">
              <td className="p-3">
                <input
                  type="checkbox"
                  checked={selectedRowKeys.includes(row.key)}
                  onChange={() => toggleRowSelection(row.key)}
                  aria-label={`${row.productCode || row.productName} seç`}
                />
              </td>
              <td className="p-3"><div className="font-black text-blue-800">{row.productCode || "Kodsuz"}</div><div>{row.productName}</div>{row.unitConflict && <div className="mt-1 font-bold text-red-700">Birim kontrolü: {row.sourceUnits.join(" / ")}</div>}</td>
              <td className="p-3">{row.brand || "-"}</td><td className="p-3">{row.unit}</td><td className="p-3 font-bold">{row.totalNeed}</td><td className="p-3">{row.availableStock}</td>{mode !== "missing" && <td className="p-3 font-black text-emerald-700">{row.stockCoverable}</td>}{mode !== "stock" && <td className="p-3 font-black text-red-700">{row.purchaseQuantity}</td>}<td className="p-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{row.statusLabel}</span></td>
              <td className="p-3">
                <div className="max-w-[260px] space-y-1.5">
                  {row.allocations.slice(0, 2).map((allocation, allocationIndex) => (
                    <AllocationChip
                      key={allocation.projectItemId || `${row.key}-${allocationIndex}`}
                      allocation={allocation}
                      unit={row.unit}
                    />
                  ))}
                  {row.allocations.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setAllocationDetailRow(row)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-black text-blue-700 hover:bg-blue-50"
                    >
                      + {row.allocations.length - 2} dağılım daha
                    </button>
                  )}
                </div>
              </td>
            </tr>)}</tbody>
          </table>
          {!loading && rows.length === 0 && <div className="p-8 text-center text-slate-500">{modeConfig.emptyText}</div>}
          {loading && <div className="p-8 text-center text-slate-500">Malzeme listesi hazırlanıyor...</div>}
        </div>

        {allocationDetailRow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-wide text-blue-700">Proje dağılımı</div>
                  <h2 className="mt-1 truncate text-xl font-black text-slate-900" title={allocationDetailRow.productName}>
                    {allocationDetailRow.productCode || "Kodsuz"} · {allocationDetailRow.productName}
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {allocationDetailRow.allocations.length} dağılım · {allocationDetailRow.unit || "adet"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAllocationDetailRow(null)}
                  className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-200"
                >
                  Kapat
                </button>
              </div>
              <div className="max-h-[65vh] overflow-y-auto p-5">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {allocationDetailRow.allocations.map((allocation, allocationIndex) => (
                    <AllocationChip
                      key={allocation.projectItemId || `${allocationDetailRow.key}-modal-${allocationIndex}`}
                      allocation={allocation}
                      unit={allocationDetailRow.unit}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="rounded-2xl bg-white/10 p-4"><div className="text-xs font-bold text-slate-300">{label}</div><div className="mt-2 text-2xl font-black">{value}</div></div>;
}
