"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CORVIAN_PRODUCT_NAME, fetchCompanyBranding } from "@/lib/companyBranding";
import { matchProduct } from "@/lib/productMatching";
import ProductCodeInput from "@/components/ProductCodeInput";
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

function requestProjectItemIds(request) {
  const ids = new Set();
  getRequestItems(request).forEach((item) => {
    if (item?.projectItemId) ids.add(item.projectItemId);
    if (item?.project_item_id) ids.add(item.project_item_id);
    (Array.isArray(item?.projectItemIds) ? item.projectItemIds : []).forEach((id) => ids.add(id));
    (Array.isArray(item?.project_item_ids) ? item.project_item_ids : []).forEach((id) => ids.add(id));
    (Array.isArray(item?.allocations) ? item.allocations : []).forEach((allocation) => {
      if (allocation?.projectItemId) ids.add(allocation.projectItemId);
      if (allocation?.project_item_id) ids.add(allocation.project_item_id);
    });
  });
  return Array.from(ids).filter(Boolean);
}

function getRequestMeta(request) {
  const items = getRequestItems(request);
  return items.find((item) => item?.request_meta)?.request_meta || {};
}

function requestSourceLabel(request) {
  const meta = getRequestMeta(request);
  if (meta.source === "manual") return "Manuel talep";
  if (request?.project_id || getRequestItems(request).some((item) => Array.isArray(item.allocations) && item.allocations.length > 0)) {
    return "Projeden aktarıldı";
  }
  return "Dosyadan oluşturuldu";
}

function requestProjectSummary(request) {
  const items = getRequestItems(request);
  const names = new Set();
  items.forEach((item) => {
    (Array.isArray(item.allocations) ? item.allocations : []).forEach((allocation) => {
      const label = allocation.projectCode || allocation.projectName;
      if (label) names.add(label);
    });
  });
  if (names.size === 0) return request?.project_id ? "Proje bağlantılı" : "Proje bağımsız";
  const values = Array.from(names);
  return values.join(" / ");
}

function requestOwnerSummary(request) {
  const meta = getRequestMeta(request);
  return [meta.requester || meta.createdBy, meta.department].filter(Boolean).join(" / ") || "Sistem kullanıcısı";
}

function requestPriority(request) {
  return getRequestMeta(request).priority || "Normal";
}

function requestQuantityLocked(request) {
  const status = String(request?.durum || "").trim();
  return Boolean(status && status !== "Yeni Talep");
}

function requestProcessInfo(request) {
  const meta = getRequestMeta(request);
  if (!meta.processedBy && !meta.processedAt) return "";
  return [meta.processedBy, meta.processedDepartment, meta.processedAt ? new Date(meta.processedAt).toLocaleDateString("tr-TR") : ""]
    .filter(Boolean)
    .join(" · ");
}

function requestSequenceLabel(index, total) {
  return `TLB-${String(Math.max(total - index, 1)).padStart(5, "0")}`;
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

function compactRequestText(value, maxLength = 18) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatAllocationQuantity(value) {
  const amount = Number(value || 0);
  if (!amount) return "";

  return amount.toLocaleString("tr-TR", {
    maximumFractionDigits: 2,
  });
}

function requestAllocationQuantity(allocation) {
  return Number(
    allocation?.purchaseQuantity ??
    allocation?.purchase_quantity ??
    allocation?.quantity ??
    allocation?.qty ??
    allocation?.openQuantity ??
    allocation?.open_quantity ??
    0
  ) || 0;
}

function RequestAllocationChips({ allocations, unit = "adet", limit = 2 }) {
  if (!Array.isArray(allocations) || allocations.length === 0) return null;

  const visibleAllocations = allocations.slice(0, limit);
  const hiddenCount = Math.max(allocations.length - visibleAllocations.length, 0);

  return (
    <div className="flex max-w-[190px] flex-wrap gap-1">
      {visibleAllocations.map((allocation, allocationIndex) => {
        const projectCode = allocation.projectCode || allocation.project_code || allocation.projectName || allocation.project_name || "Proje";
        const projectName = allocation.projectName || allocation.project_name || "";
        const quantity = requestAllocationQuantity(allocation);
        const formattedQuantity = formatAllocationQuantity(quantity);
        const title = [
          projectCode,
          projectName,
          formattedQuantity ? `${formattedQuantity} ${unit || "adet"}` : "",
        ].filter(Boolean).join(" · ");

        return (
          <span
            key={`${allocation.projectItemId || allocation.project_item_id || allocationIndex}`}
            title={title}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600"
          >
            <span className="truncate">{compactRequestText(projectCode, 14)}</span>
            {formattedQuantity && (
              <>
                <span className="text-slate-400">·</span>
                <span>{formattedQuantity} {unit || "adet"}</span>
              </>
            )}
          </span>
        );
      })}

      {hiddenCount > 0 && (
        <span className="inline-flex rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">
          + {hiddenCount} proje dağılımı
        </span>
      )}
    </div>
  );
}

function normalizeRequestProductCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeRequestProductName(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

async function fetchTenantStockProducts(userId) {
  const products = [];
  let page = 0;

  while (true) {
    const from = page * 1000;
    const { data, error } = await supabase
      .from("products")
      .select("id,product_code,product_name,brand,unit,current_stock,reserved_stock")
      .eq("user_id", userId)
      .is("archived_at", null)
      .range(from, from + 999);

    if (error) throw error;
    products.push(...(data || []));
    if (!data || data.length < 1000) break;
    page += 1;
  }

  return products;
}

function buildStockAwareRequestExportRows(requests, products) {
  const remainingStock = new Map();
  const rowsByRequest = new Map();

  (requests || []).forEach((request) => {
    const rows = getRequestItems(request).map((item, index) => {
    const quantity = readItemField(item, ["talepEdilenAdet", "quantity", "qty", "estimated_quantity"], 0);
    const currency = readItemField(item, ["paraBirimi", "currency"], "TRY");
    const productCode = readItemField(item, ["urunKodu", "product_code", "code"], "");
    const productName = readItemField(item, ["urunAciklamasi", "product_name", "description", "name"], "");
    const normalizedCode = normalizeRequestProductCode(productCode);
    const normalizedName = normalizeRequestProductName(productName);
    const matchingProducts = (products || []).filter((product) => {
      if (normalizedCode) return normalizeRequestProductCode(product.product_code) === normalizedCode;
      return normalizedName && normalizeRequestProductName(product.product_name) === normalizedName;
    });
    const matchKey = normalizedCode ? `code:${normalizedCode}` : `name:${normalizedName}`;
    const currentStock = matchingProducts.reduce((sum, product) => sum + Number(product.current_stock || 0), 0);
    const reservedStock = matchingProducts.reduce((sum, product) => sum + Number(product.reserved_stock || 0), 0);
    const initialAvailableStock = Math.max(currentStock - reservedStock, 0);
    const availableStock = matchingProducts.length > 0
      ? remainingStock.has(matchKey) ? remainingStock.get(matchKey) : initialAvailableStock
      : 0;
    const requestedQuantity = Number(quantity || 0);
    const missingQuantity = matchingProducts.length > 0
      ? Math.max(requestedQuantity - availableStock, 0)
      : requestedQuantity;
    const allocatedQuantity = Math.min(requestedQuantity, availableStock);

    if (matchingProducts.length > 0) {
      remainingStock.set(matchKey, Math.max(availableStock - allocatedQuantity, 0));
    }

    const stockStatus = matchingProducts.length === 0
      ? "Ürün kartı bulunamadı"
      : missingQuantity === 0
        ? "Stoktan karşılanabilir"
        : availableStock > 0
          ? "Kısmi stok var"
          : "Stokta yok";
    const matchedProduct = matchingProducts.length > 0
      ? matchingProducts
          .map((product) => `${product.product_code || "Kodsuz"} · ${product.product_name || "Ürün kartı"}`)
          .join(" | ")
      : "-";

    return {
      "Sıra": index + 1,
      "Ürün Kodu": productCode,
      "Marka": readItemField(item, ["marka", "brand"], ""),
      "Açıklama": productName,
      "Mevcut Stok": currentStock,
      "Ayrılmış Stok": reservedStock,
      "Boşta Stok": availableStock,
      "Talep Edilen Miktar": requestedQuantity,
      "Eksik Miktar": missingQuantity,
      "Stok Durumu": stockStatus,
      "Eşleşen Ürün Kodu / Kartı": matchedProduct,
      "Birim": readItemField(item, ["birim", "unit"], "adet"),
      "Birim Fiyat": Number(readItemField(item, ["birimFiyat", "unit_price", "estimated_unit_price"], 0) || 0),
      "Toplam": Number(readItemField(item, ["toplam", "total", "estimated_total"], 0) || 0),
      "Para Birimi": currency,
      "Not": cleanRequestNote(readItemField(item, ["not", "note"], "")),
    };
    });
    rowsByRequest.set(request, rows);
  });

  return rowsByRequest;
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

function addStockSimulation(rows, products) {
  return (rows || []).map((row) => {
    const normalizedCode = String(row.productCode || "").trim().toLocaleUpperCase("tr-TR");
    const normalizedName = String(row.productName || "")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/\s+/g, " ");
    const matchingProducts = (products || []).filter((product) => {
      if (normalizedCode) {
        return String(product.product_code || "").trim().toLocaleUpperCase("tr-TR") === normalizedCode;
      }

      return normalizedName && String(product.product_name || "")
        .trim()
        .toLocaleLowerCase("tr-TR")
        .replace(/\s+/g, " ") === normalizedName;
    });
    const currentStock = matchingProducts.reduce(
      (sum, product) => sum + Number(product.current_stock || 0),
      0,
    );
    const reservedStock = matchingProducts.reduce(
      (sum, product) => sum + Number(product.reserved_stock || 0),
      0,
    );
    const freeStock = currentStock - reservedStock;
    const purchaseQuantity = Math.max(Number(row.totalQuantity || 0) - freeStock, 0);
    const stockStatus = freeStock >= Number(row.totalQuantity || 0)
      ? "available"
      : freeStock > 0
        ? "partial"
        : "required";

    return {
      ...row,
      currentStock,
      reservedStock,
      freeStock,
      purchaseQuantity,
      stockStatus,
    };
  });
}

function buildPendingOrderItems(rows) {
  return (rows || [])
    .filter((row) => Number(row.purchaseQuantity || 0) > 0)
    .map((row) => {
      const purchaseQuantity = Number(row.purchaseQuantity || 0);
      const projectDistribution = (row.projectDistribution || []).filter(
        (project) => project.projectId && Number(project.quantity || 0) > 0,
      );
      const projectTotal = projectDistribution.reduce(
        (sum, project) => sum + Number(project.quantity || 0),
        0,
      );
      const sourceRequestIds = Array.from(row.requestIds || []);
      let allocatedQuantity = 0;
      const allocations = projectTotal > 0
        ? projectDistribution.map((project, index) => {
            const isLast = index === projectDistribution.length - 1;
            const remainingQuantity = Math.max(purchaseQuantity - allocatedQuantity, 0);
            const proportionalQuantity = isLast
              ? remainingQuantity
              : Math.min(
                  Number((purchaseQuantity * (Number(project.quantity || 0) / projectTotal)).toFixed(6)),
                  remainingQuantity,
                );
            allocatedQuantity += proportionalQuantity;

            return {
              type: "project",
              projectId: project.projectId,
              quantity: proportionalQuantity,
              sourceRequestIds,
            };
          })
        : [];

      return {
        rowId: `merged-request-${row.groupKey}`,
        productCode: row.productCode || "",
        productName: row.productName || "",
        unit: row.unit || "adet",
        quantity: purchaseQuantity,
        deliveredQuantity: 0,
        unitPrice: 0,
        discount: 0,
        netUnitPrice: 0,
        total: 0,
        currency: "TRY",
        allocations,
      };
    });
}

function MergedPurchasePreview({ rows, onCreateOrder }) {
  return (
    <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Birleşik Satınalma Önizlemesi</h2>
          <p className="text-sm text-slate-500">Seçili talep listelerindeki aynı ürünler bir araya getirilmiştir.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-blue-700">
            {rows.length} birleşik kalem
          </span>
          <button
            type="button"
            onClick={onCreateOrder}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
          >
            Satınalma Siparişi Oluştur
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs font-bold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Ürün kodu</th>
              <th className="px-3 py-3">Açıklama</th>
              <th className="px-3 py-3">Birim</th>
              <th className="px-3 py-3 text-right">Toplam ihtiyaç</th>
              <th className="px-3 py-3 text-right">Mevcut stok</th>
              <th className="px-3 py-3 text-right">Ayrılmış stok</th>
              <th className="px-3 py-3 text-right">Boşta stok</th>
              <th className="px-3 py-3 text-right">Satın alınacak</th>
              <th className="px-3 py-3">Stok durumu</th>
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
                <td className="px-3 py-3 text-right font-semibold text-slate-700">{row.currentStock}</td>
                <td className="px-3 py-3 text-right font-semibold text-slate-700">{row.reservedStock}</td>
                <td className="px-3 py-3 text-right font-bold text-emerald-700">{row.freeStock}</td>
                <td className="px-3 py-3 text-right font-black text-red-700">{row.purchaseQuantity}</td>
                <td className="px-3 py-3">
                  {row.stockStatus === "available" && (
                    <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                      Stoktan karşılanabilir
                    </span>
                  )}
                  {row.stockStatus === "partial" && (
                    <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                      Kısmi stok var
                    </span>
                  )}
                  {row.stockStatus === "required" && (
                    <span className="inline-flex rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                      Satınalma gerekli
                    </span>
                  )}
                </td>
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
  const [createdUploadRequestId, setCreatedUploadRequestId] = useState("");
  const [uploadRequestModal, setUploadRequestModal] = useState({
    open: false,
    requester: "",
    department: "",
    priority: "Normal",
  });
  const [uploadRequestError, setUploadRequestError] = useState("");
  const [uploadMatchDecisions, setUploadMatchDecisions] = useState({});
  const [resolvingUploadMatchIndex, setResolvingUploadMatchIndex] = useState(null);
  const [savedRequests, setSavedRequests] = useState([]);
  const [stockProducts, setStockProducts] = useState([]);
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState("");
  const [selectedRequestIds, setSelectedRequestIds] = useState([]);
  const [quantityDrafts, setQuantityDrafts] = useState({});
  const [requestRelations, setRequestRelations] = useState({});
  const [creatingManualRequest, setCreatingManualRequest] = useState(false);
  const [activeRequestTab, setActiveRequestTab] = useState("pool");
  const [processModal, setProcessModal] = useState({
    request: null,
    processor: "",
    department: "",
    priority: "Normal",
  });
  const [manualRequest, setManualRequest] = useState({
    subject: "",
    requester: "",
    department: "",
    priority: "Orta",
    note: "",
    productCode: "",
    brand: "",
    productName: "",
    quantity: "1",
    unit: "adet",
  });
  const isAnalyzingRef = useRef(false);

  const totalQty = useMemo(() => {
    return rows.reduce((sum, r) => sum + Number(r.talepEdilenAdet || 0), 0);
  }, [rows]);

  const uploadProductMatches = useMemo(() => rows.map((row) => matchProduct(stockProducts, {
    product_code: row.urunKodu,
    product_name: row.urunAciklamasi,
    brand: row.marka,
    unit: row.birim,
  })), [rows, stockProducts]);

  const pendingUploadMatchCount = useMemo(() => uploadProductMatches.reduce((count, result, index) => {
    const needsDecision = result.type === "probable" || result.type === "conflict";
    return count + (needsDecision && !uploadMatchDecisions[index] ? 1 : 0);
  }, 0), [uploadProductMatches, uploadMatchDecisions]);

  const visibleSavedRequests = useMemo(() => {
    return showAllRequests ? savedRequests : savedRequests.slice(0, 5);
  }, [savedRequests, showAllRequests]);

  const selectedRequests = useMemo(() => {
    return savedRequests.filter((request) => selectedRequestIds.includes(request.id));
  }, [savedRequests, selectedRequestIds]);

  const requestStats = useMemo(() => {
    const openStatuses = new Set(["Yeni Talep", "Teklif Bekliyor", "Teklif Toplanıyor", "Oluşturuldu", "Bekliyor"]);
    return {
      total: savedRequests.length,
      manual: savedRequests.filter((request) => getRequestMeta(request).source === "manual").length,
      project: savedRequests.filter((request) => requestSourceLabel(request) === "Projeden aktarıldı").length,
      open: savedRequests.filter((request) => openStatuses.has(request.durum || "Bekliyor")).length,
    };
  }, [savedRequests]);

  const mergedPurchasePreview = useMemo(
    () => addStockSimulation(buildMergedPurchasePreview(selectedRequests), stockProducts),
    [selectedRequests, stockProducts],
  );
    useEffect(() => {
      loadRequests();
      loadStockProducts();
      if (typeof window !== "undefined") {
        const createdRequestId = new URLSearchParams(window.location.search).get("createdRequestId");
        if (createdRequestId) {
          setExpandedRequestId(createdRequestId);
          setMessage("Talep listesi oluşturuldu. Kalemleri kontrol edip teklif toplama sürecine geçebilirsiniz.");
        }
      }
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

      const requests = data || [];
      setSavedRequests(requests);
      await loadRequestRelations(user.id, requests);
    } catch (err) {
      console.error(err);
    }
  };

  const loadRequestRelations = async (userId, requests = savedRequests) => {
    const requestIds = (requests || []).map((request) => request.id).filter(Boolean);
    if (requestIds.length === 0) {
      setRequestRelations({});
      return;
    }

    const [offerResult, reportResult] = await Promise.all([
      supabase.from("offers").select("id,request_id,dosya_adi,firma_adi,durum,created_at").eq("user_id", userId).in("request_id", requestIds),
      supabase.from("reports").select("id,ad,durum,created_at,reportpath,report_storage_bucket,report_storage_path").eq("user_id", userId).limit(500),
    ]);

    if (offerResult.error) {
      console.error("Talep teklif bağlantıları okunamadı:", offerResult.error);
      setMessage(`Talep teklif bağlantıları okunamadı: ${offerResult.error.message || "Bilinmeyen sorgu hatası"}`);
      return;
    }

    if (reportResult.error) {
      console.error("Talep rapor bağlantıları okunamadı:", reportResult.error);
    }

    const nextRelations = {};
    requestIds.forEach((id) => { nextRelations[id] = { offers: [], reports: [] }; });
    (offerResult.data || []).forEach((offer) => {
      if (!nextRelations[offer.request_id]) nextRelations[offer.request_id] = { offers: [], reports: [] };
      nextRelations[offer.request_id].offers.push(offer);
    });
    (reportResult.data || []).filter((report) => report.request_id).forEach((report) => {
      if (!nextRelations[report.request_id]) nextRelations[report.request_id] = { offers: [], reports: [] };
      nextRelations[report.request_id].reports.push(report);
    });
    setRequestRelations(nextRelations);
  };

  const loadStockProducts = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    try {
      const data = await fetchTenantStockProducts(user.id);
      setStockProducts(data);
    } catch (error) {
      console.error("Stok simülasyonu için ürünler yüklenemedi:", error);
    }
  };

  const getStockProductsForExport = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return stockProducts;

    try {
      const products = await fetchTenantStockProducts(user.id);
      setStockProducts(products);
      return products;
    } catch (error) {
      console.error("Export için güncel stok bilgisi yüklenemedi:", error);
      return stockProducts;
    }
  };

  function createOrderFromMergedRequests() {
    const items = buildPendingOrderItems(mergedPurchasePreview);

    if (items.length === 0) {
      setMessage("Satın alınacak miktarı bulunan birleşik talep kalemi yok.");
      return;
    }

    const projectIds = Array.from(
      new Set(selectedRequests.map((request) => request.project_id).filter(Boolean)),
    );
    const today = new Date();
    const orderDate = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");
    const pendingOrder = {
      source: "merged-requests",
      reportName: "Birleşik Satınalma Talebi",
      orderDate,
      projectId: projectIds.length === 1 ? projectIds[0] : "",
      items,
    };

    localStorage.setItem("pendingOrder", JSON.stringify(pendingOrder));
    router.push("/dashboard/siparisler");
  }

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

  const updateManualRequest = (field, value) => {
    setManualRequest((current) => ({ ...current, [field]: value }));
  };

  const findManualProductByCode = (code) => {
    const normalizedCode = normalizeRequestProductCode(code);
    if (!normalizedCode) return null;
    return stockProducts.find(
      (product) => normalizeRequestProductCode(product.product_code) === normalizedCode,
    ) || null;
  };

  const updateManualProductCode = (value) => {
    const product = findManualProductByCode(value);
    setManualRequest((current) => ({
      ...current,
      productCode: value,
      brand: product?.brand || current.brand,
      productName: product?.product_name || current.productName,
      unit: product?.unit || current.unit || "adet",
    }));
  };

  async function createManualRequest() {
    const productName = manualRequest.productName.trim();
    const quantity = Number(manualRequest.quantity || 0);
    if (!productName || quantity <= 0) {
      setMessage("Manuel talep için ürün açıklaması ve 0'dan büyük miktar girin.");
      return;
    }

    setCreatingManualRequest(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const subject = manualRequest.subject.trim() || `Manuel Talep - ${productName}`;
    const item = {
      urunKodu: manualRequest.productCode.trim(),
      product_code: manualRequest.productCode.trim(),
      marka: manualRequest.brand.trim(),
      brand: manualRequest.brand.trim(),
      urunAciklamasi: productName,
      product_name: productName,
      talepEdilenAdet: quantity,
      quantity,
      purchase_quantity: quantity,
      birim: manualRequest.unit.trim() || "adet",
      unit: manualRequest.unit.trim() || "adet",
      note: manualRequest.note.trim(),
      request_meta: {
        source: "manual",
        requester: manualRequest.requester.trim(),
        department: manualRequest.department.trim(),
        priority: manualRequest.priority,
        createdBy: user.email || user.id,
      },
    };

    const { data, error } = await supabase.from("requests").insert({
      user_id: user.id,
      project_id: null,
      ad: subject,
      durum: "Yeni Talep",
      totalitems: 1,
      items: [item],
    }).select("id").single();

    setCreatingManualRequest(false);
    if (error) {
      setMessage(`Manuel talep oluşturulamadı: ${error.message}`);
      return;
    }

    setManualRequest({ subject: "", requester: "", department: "", priority: "Orta", note: "", productCode: "", brand: "", productName: "", quantity: "1", unit: "adet" });
    setExpandedRequestId(data.id);
    setActiveRequestTab("pool");
    setMessage("Manuel talep oluşturuldu ve talep havuzuna eklendi.");
    await loadRequests();
  }

  async function updateRequestStatus(request, status) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("requests").update({ durum: status }).eq("id", request.id).eq("user_id", user.id);
    if (error) {
      setMessage(`Talep durumu güncellenemedi: ${error.message}`);
      return;
    }
    setSavedRequests((current) => current.map((item) => item.id === request.id ? { ...item, durum: status } : item));
    setMessage("Talep durumu güncellendi.");
  }

  function openProcessModal(request) {
    setProcessModal({
      request,
      processor: "",
      department: "",
      priority: requestPriority(request),
    });
  }

  function closeProcessModal() {
    setProcessModal({
      request: null,
      processor: "",
      department: "",
      priority: "Normal",
    });
  }

  function updateProcessModal(field, value) {
    setProcessModal((current) => ({ ...current, [field]: value }));
  }

  async function takeRequestIntoProcess() {
    const request = processModal.request;
    const processor = processModal.processor.trim();
    if (!request || !processor) {
      setMessage("Talebi işleme alan kişi zorunlu.");
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const processedAt = new Date().toISOString();
    const items = getRequestItems(request).map((item) => ({
      ...item,
      request_meta: {
        ...(item.request_meta || {}),
        processedBy: processor,
        processedDepartment: processModal.department.trim(),
        priority: processModal.priority,
        processedAt,
      },
    }));

    const { error } = await supabase
      .from("requests")
      .update({ durum: "İşleme alındı", items })
      .eq("id", request.id)
      .eq("user_id", user.id);

    if (error) {
      setMessage(`Talep işleme alınamadı: ${error.message}`);
      return;
    }

    setSavedRequests((current) => current.map((item) => (
      item.id === request.id ? { ...item, durum: "İşleme alındı", items } : item
    )));
    closeProcessModal();
    setMessage("Talep işleme alındı.");
  }

  async function startOfferCollection(request) {
    await updateRequestStatus(request, "Teklif Toplanıyor");
    router.push(`/dashboard/teklifler?requestId=${request.id}${request.project_id ? `&projectId=${request.project_id}` : ""}`);
  }

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files || []));
    setCreatedUploadRequestId("");
    setUploadMatchDecisions({});
    setRows([]);
  };

  const openUploadRequestModal = () => {
    if (files.length === 0) {
      setMessage("Lütfen dosya yükleyin.");
      return;
    }
    setUploadRequestError("");
    setUploadRequestModal((current) => ({ ...current, open: true }));
  };

  const closeUploadRequestModal = () => {
    if (isLoading) return;
    setUploadRequestError("");
    setUploadRequestModal((current) => ({ ...current, open: false }));
  };

  const updateUploadRequestModal = (field, value) => {
    setUploadRequestModal((current) => ({ ...current, [field]: value }));
  };

  const handleAnalyze = async () => {
    if (isAnalyzingRef.current) return;
    isAnalyzingRef.current = true;

    if (files.length === 0) {
      setMessage("Lütfen dosya yükleyin.");
      isAnalyzingRef.current = false;
      return;
    }

    if (!uploadRequestModal.requester.trim()) {
      setUploadRequestError("Talebi açan kişi bilgisini girin.");
      isAnalyzingRef.current = false;
      return;
    }

    setIsLoading(true);
    setMessage("");
    setUploadRequestError("");

    const {
    data: { session },
    } = await supabase.auth.getSession();

    const token = session?.access_token;

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    formData.append("requester", uploadRequestModal.requester.trim());
    formData.append("department", uploadRequestModal.department.trim());
    formData.append("priority", uploadRequestModal.priority || "Normal");



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

      const uploadedRows = data.rows || [];
      const similarMatchCount = uploadedRows.reduce((count, row) => {
        const result = matchProduct(stockProducts, {
          product_code: row.urunKodu,
          product_name: row.urunAciklamasi,
          brand: row.marka,
          unit: row.birim,
        });
        return count + (result.type === "probable" || result.type === "conflict" ? 1 : 0);
      }, 0);
      setRows(uploadedRows);
      setUploadMatchDecisions({});
      setReportPath(data.reportPath);
      setCreatedUploadRequestId(data.requestId || "");
      if (data.requestId) {
        setExpandedRequestId(data.requestId);
        await loadRequests();
        setUploadRequestModal({ open: false, requester: "", department: "", priority: "Normal" });
        setMessage(similarMatchCount > 0
          ? `${data.totalRows || uploadedRows.length || 0} kalem okundu. ${similarMatchCount} benzer ürün için onayınız gerekiyor.`
          : `${data.totalRows || uploadedRows.length || 0} kalemli talep oluşturuldu ve talep havuzuna eklendi ✅`);
      } else {
        setMessage("Dosya analiz edildi ancak talep havuzuna kaydedilemedi.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Backend bağlantı hatası ❌");
    } finally {
      setIsLoading(false);
      isAnalyzingRef.current = false;
    }
  };

  const resolveUploadProductMatch = async (rowIndex, productMatch, decision) => {
    const product = productMatch?.match?.product;
    if (!createdUploadRequestId || !product?.id) {
      setMessage("Eşleştirme için kayıtlı talep ve stok kartı bulunamadı.");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setMessage("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
      return;
    }

    setResolvingUploadMatchIndex(rowIndex);
    try {
      const response = await fetch(`${API_URL}/requests/${createdUploadRequestId}/product-match`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          itemIndex: rowIndex,
          productId: product.id,
          decision,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setMessage(data.detail || "Ürün eşleştirme kararı kaydedilemedi.");
        return;
      }

      setUploadMatchDecisions((current) => ({ ...current, [rowIndex]: decision }));
      if (decision === "confirm" && data.item) {
        setRows((current) => current.map((row, index) => (
          index === rowIndex ? { ...row, ...data.item } : row
        )));
      }
      if (Array.isArray(data.items)) {
        setSavedRequests((current) => current.map((request) => (
          request.id === createdUploadRequestId ? { ...request, items: data.items } : request
        )));
      }

      const decisionMessage = decision === "confirm"
        ? `Kalem mevcut stok kartına bağlandı: ${product.product_code || "Kodsuz"} · ${product.product_name}`
        : "Kalem farklı ürün olarak bırakıldı.";
      setMessage(data.warning ? `${decisionMessage} ${data.warning}` : decisionMessage);
    } catch (error) {
      console.error(error);
      setMessage("Ürün eşleştirme sırasında bağlantı hatası oluştu.");
    } finally {
      setResolvingUploadMatchIndex(null);
    }
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

    const { companyName } = await fetchCompanyBranding(supabase);
    const exportProducts = await getStockProductsForExport();
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const exportRowsByRequest = buildStockAwareRequestExportRows(requestsToDownload, exportProducts);

    requestsToDownload.forEach((request, index) => {
      const rowsForSheet = exportRowsByRequest.get(request) || [];
      const rowsToWrite = rowsForSheet.length > 0 ? rowsForSheet : [{ Bilgi: "Kalem detayı bulunamadı." }];
      const worksheet = XLSX.utils.aoa_to_sheet([
        [companyName],
        [CORVIAN_PRODUCT_NAME],
        [`Rapor: ${request.ad || "Talep Listesi"}`, `Oluşturma tarihi: ${formatDateTime(request.created_at || request.tarih)}`],
        [],
      ]);
      XLSX.utils.sheet_add_json(worksheet, rowsToWrite, { origin: "A5" });
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

    const { companyName } = await fetchCompanyBranding(supabase);
    const exportProducts = await getStockProductsForExport();
    const [{ jsPDF }, autoTableModule] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const exportRowsByRequest = buildStockAwareRequestExportRows(requestsToDownload, exportProducts);

    requestsToDownload.forEach((request, index) => {
      if (index > 0) doc.addPage();

      const title = request.ad || "Talep Listesi";
      doc.setFontSize(13);
      doc.text(companyName, 40, 32);
      doc.setFontSize(8);
      doc.text(CORVIAN_PRODUCT_NAME, 40, 44);
      doc.setFontSize(12);
      doc.text(title, 40, 62);
      doc.setFontSize(8);
      doc.text(`Oluşturma tarihi: ${formatDateTime(request.created_at || request.tarih)}`, 40, 76);

      const rowsForPdf = exportRowsByRequest.get(request) || [];
      const rowsToWrite = rowsForPdf.length > 0 ? rowsForPdf : [{ Bilgi: "Kalem detayi bulunamadi." }];
      const headers = Object.keys(rowsToWrite[0]);
      const body = rowsToWrite.map((row) => headers.map((header) => row[header] ?? ""));

      autoTable(doc, {
        head: [headers],
        body,
        startY: 90,
        styles: { fontSize: 5.5, cellPadding: 2.5, overflow: "linebreak" },
        headStyles: { fillColor: [15, 23, 42] },
        columnStyles: {
          3: { cellWidth: 110 },
          10: { cellWidth: 105 },
          15: { cellWidth: 75 },
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

  function quantityDraftKey(requestId, itemIndex) {
    return `${requestId}:${itemIndex}`;
  }

  function requestItemQuantity(requestId, itemIndex, item) {
    const draftKey = quantityDraftKey(requestId, itemIndex);
    if (quantityDrafts[draftKey] !== undefined) return quantityDrafts[draftKey];
    return readItemField(item, ["purchase_quantity", "talepEdilenAdet", "quantity", "qty", "estimated_quantity"], 0);
  }

  async function saveRequestItemQuantity(request, itemIndex, nextQuantity) {
    if (requestQuantityLocked(request)) {
      setMessage("Talep oluşturulduktan sonra miktar değiştirilemez.");
      return;
    }

    const quantity = Number(nextQuantity || 0);
    if (quantity < 0) {
      setMessage("Talep miktarı negatif olamaz.");
      return;
    }

    const items = getRequestItems(request).map((item, index) => {
      if (index !== itemIndex) return item;
      const unitPrice = Number(readItemField(item, ["birimFiyat", "unit_price", "estimated_unit_price"], 0) || 0);
      return {
        ...item,
        quantity,
        talepEdilenAdet: quantity,
        purchase_quantity: quantity,
        total: unitPrice > 0 ? Number((unitPrice * quantity).toFixed(2)) : item.total,
      };
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage("Oturum bulunamadı. Talep miktarını güncellemek için lütfen tekrar giriş yapın.");
      return;
    }

    const { error } = await supabase
      .from("requests")
      .update({ items, totalitems: items.length })
      .eq("id", request.id)
      .eq("user_id", user.id);

    if (error) {
      setMessage(`Talep miktarı güncellenemedi: ${error.message}`);
      return;
    }

    setSavedRequests((current) =>
      current.map((savedRequest) =>
        savedRequest.id === request.id
          ? { ...savedRequest, items, totalitems: items.length }
          : savedRequest,
      ),
    );
    setMessage("Talep kalemi güncellendi.");
  }

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

    const requestToDelete = savedRequests.find((request) => request.id === requestId);
    const deletedProjectItemIds = requestProjectItemIds(requestToDelete);
    const remainingProjectItemIds = new Set(
      savedRequests
        .filter((request) => request.id !== requestId)
        .flatMap(requestProjectItemIds),
    );
    const projectItemIdsToUnlock = deletedProjectItemIds.filter((id) => !remainingProjectItemIds.has(id));

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

    if (projectItemIdsToUnlock.length > 0) {
      const { error: itemError } = await supabase
        .from("project_items")
        .update({ status: "Satınalma gerekli", updated_at: new Date().toISOString() })
        .in("id", projectItemIdsToUnlock)
        .eq("user_id", user.id)
        .eq("status", "Talep oluşturuldu");

      if (itemError) {
        console.warn("Talep silindi ama proje kalemi durumları güncellenemedi:", itemError);
      }
    }

    setSavedRequests((prev) => prev.filter((r) => r.id !== requestId));
    setSelectedRequestIds((prev) => prev.filter((id) => id !== requestId));
    setMessage("Talep silindi. Bağlı proje kalemleri yeniden satınalma gerekli durumuna alındı.");
  }

  return (
    <div className="bg-slate-100">

      <main className="p-6">
        <div className={`mx-auto space-y-6 ${activeRequestTab === "pool" ? "max-w-[1600px]" : "max-w-7xl"}`}>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-100 text-3xl">
              📚
            </div>

            <div>
              <h1 className="text-3xl font-bold text-slate-900">Talepler</h1>
              <p className="mt-1 text-sm text-slate-600">
                Projelerden gelen satınalma listelerini kontrol edin, miktarları revize edin ve teklif toplama sürecine aktarın.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard icon="📥" title="Talep Havuzu" value={requestStats.total} text="Manuel ve proje talepleri" />
            <StatCard icon="🏗️" title="Projeden Gelen" value={requestStats.project} text="Proje bağlantılı talep" />
            <StatCard icon="✍️" title="Manuel" value={requestStats.manual} text="Proje bağımsız talep" />
            <StatCard icon="⏳" title="Açık Süreç" value={requestStats.open} text="Teklif/satınalma bekliyor" />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              {[
                { id: "pool", title: "Talep Havuzu", text: "Tüm talep listelerini takip et", icon: "📥" },
                { id: "upload", title: "Dosya Yükle", text: "Excel, PDF ve görselden talep çıkar", icon: "📎" },
                { id: "manual", title: "Manuel Oluştur", text: "Tek kalem veya hızlı talep ekle", icon: "✍️" },
              ].map((tab) => {
                const active = activeRequestTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveRequestTab(tab.id)}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left transition ${
                      active
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${active ? "bg-white/15" : "bg-white"}`}>
                      {tab.icon}
                    </span>
                    <span>
                      <span className="block text-sm font-black">{tab.title}</span>
                      <span className={`mt-0.5 block text-xs font-semibold ${active ? "text-blue-50" : "text-slate-500"}`}>
                        {tab.text}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {activeRequestTab === "upload" && (
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
              <button type="button"
                onClick={openUploadRequestModal}
                disabled={isLoading}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isLoading ? "Talep listesi oluşturuluyor..." : "Talep Listesi Oluştur"}
              </button>

            </div>

            {message && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                {message}
              </div>
            )}
          </div>
          )}

          {activeRequestTab === "manual" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Manuel Talep Oluştur</h2>
                <p className="mt-1 text-sm text-slate-500">Projeye bağlı olmayan, satın almacıya doğrudan gelen ihtiyaçları buradan talep havuzuna ekleyin.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">Proje bağımsız</span>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
              <input value={manualRequest.subject} onChange={(e) => updateManualRequest("subject", e.target.value)} placeholder="Talep konusu" className="rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              <input value={manualRequest.requester} onChange={(e) => updateManualRequest("requester", e.target.value)} placeholder="Talebi açan kişi" className="rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              <input value={manualRequest.department} onChange={(e) => updateManualRequest("department", e.target.value)} placeholder="Birim / departman" className="rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              <select value={manualRequest.priority} onChange={(e) => updateManualRequest("priority", e.target.value)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm">
                <option>Düşük</option><option>Orta</option><option>Yüksek</option><option>Kritik</option>
              </select>
              <ProductCodeInput
                products={stockProducts}
                value={manualRequest.productCode}
                onChange={updateManualProductCode}
                placeholder="Ürün kodu (opsiyonel)"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
              />
              <input value={manualRequest.brand} onChange={(e) => updateManualRequest("brand", e.target.value)} placeholder="Marka" className="rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              <input value={manualRequest.productName} onChange={(e) => updateManualRequest("productName", e.target.value)} placeholder="Ürün / hizmet açıklaması" className="rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              <input type="number" min="0" value={manualRequest.quantity} onChange={(e) => updateManualRequest("quantity", e.target.value)} placeholder="Miktar" className="rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              <input value={manualRequest.unit} onChange={(e) => updateManualRequest("unit", e.target.value)} placeholder="Birim" className="rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              <textarea value={manualRequest.note} onChange={(e) => updateManualRequest("note", e.target.value)} placeholder="Not / açıklama" className="md:col-span-2 min-h-24 rounded-xl border border-slate-300 px-4 py-3 text-sm" />
            </div>

            <button type="button" onClick={createManualRequest} disabled={creatingManualRequest} className="mt-4 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-300">
              {creatingManualRequest ? "Kaydediliyor..." : "Manuel Talep Ekle"}
            </button>
          </div>
          )}

          {activeRequestTab === "pool" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Talep Havuzu</h2>
                <p className="text-sm text-slate-500">Projelerden, dosyadan ve manuel oluşturulan talepler kayıt defteri düzeninde izlenir.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
                  {savedRequests.length} kayıt
                </span>
                {savedRequests.length > 0 && (
                  <>
                    <button type="button"
                      onClick={toggleVisibleRequestSelection}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      {visibleSavedRequests.every((req) => selectedRequestIds.includes(req.id))
                        ? "Görünen seçimi temizle"
                        : "Görünenleri seç"}
                    </button>
                    <button type="button"
                      onClick={() => downloadRequestsAsExcel(selectedRequests)}
                      disabled={selectedRequests.length === 0}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      Seçilenleri indir ({selectedRequests.length})
                    </button>
                  </>
                )}
              </div>
            </div>

            {savedRequests.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Henüz talep kaydı yok. Projelerden aktarabilir veya manuel talep oluşturabilirsiniz.
              </div>
            ) : (
              <div className="space-y-1 overflow-x-auto">
                <div className="hidden min-w-[1280px] grid-cols-[34px_110px_minmax(260px,1.5fr)_minmax(160px,1fr)_150px_90px_130px_250px] gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-black uppercase text-slate-500 xl:grid">
                  <span>Seç</span>
                  <span>No</span>
                  <span>Kaynak</span>
                  <span>Açan / Birim</span>
                  <span>Tarih</span>
                  <span>Aciliyet</span>
                  <span>Durum</span>
                  <span>İşlem</span>
                </div>
                {visibleSavedRequests.map((req, index) => {
                  const requestItems = getRequestItems(req);
                  const isExpanded = expandedRequestId === req.id;
                  const isSelected = selectedRequestIds.includes(req.id);
                  const relations = requestRelations[req.id] || { offers: [], reports: [] };
                  const sourceLabel = requestSourceLabel(req);
                  const ownerLabel = requestOwnerSummary(req);
                  const projectLabel = requestProjectSummary(req);
                  const priorityLabel = requestPriority(req);
                  const processInfo = requestProcessInfo(req);
                  const quantityLocked = requestQuantityLocked(req);
                  const isInProcess = req.durum === "İşleme alındı" || Boolean(processInfo);

                  return (
                    <div
                      key={req.id}
                      className={`min-w-[1280px] rounded-lg border bg-white px-3 py-2 text-[13px] ${isSelected ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"}`}
                    >
                      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[34px_110px_minmax(260px,1.5fr)_minmax(160px,1fr)_150px_90px_130px_250px] xl:items-center">
                        <div className="xl:pt-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRequestSelection(req.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            aria-label={`${req.ad || "Talep Listesi"} seç`}
                          />
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-500 xl:hidden">No</div>
                          <div className="font-black text-slate-900">{requestSequenceLabel(index, savedRequests.length)}</div>
                        </div>

                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-500 xl:hidden">Kaynak</div>
                          <div className="truncate font-black text-slate-900">{projectLabel}</div>
                          <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-semibold">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{sourceLabel}</span>
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">{req.totalitems || requestItems.length || 0} kalem</span>
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-500 xl:hidden">Açan / Birim</div>
                          <div className="truncate font-bold text-slate-800">{ownerLabel}</div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-500 xl:hidden">Tarih</div>
                          <div className="text-[12px] font-bold text-slate-800">{formatDateTime(req.created_at || req.tarih)}</div>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-500 xl:hidden">Aciliyet</div>
                          <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700">{priorityLabel}</span>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-slate-500 xl:hidden">Durum</div>
                          <div className="font-black text-slate-900">{req.durum || "Bekliyor"}</div>
                          {processInfo && <div className="mt-1 text-xs font-semibold text-slate-500">{processInfo}</div>}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
                          <button type="button"
                            onClick={() => setExpandedRequestId(isExpanded ? "" : req.id)}
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            {isExpanded ? "Detayı Gizle" : "Detay"}
                          </button>

                          {req.filepath && (
                            <button type="button"
                              onClick={() => handleSavedRequestDownload(req.filepath)}
                              className="rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-bold text-white"
                            >
                              Orijinal Excel
                            </button>
                          )}

                          <button type="button"
                            onClick={() => downloadRequestsAsExcel([req])}
                            className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                          >
                            İndir
                          </button>

                          {isInProcess ? (
                            <span className="rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-black text-slate-600">
                              İşlemde
                            </span>
                          ) : (
                            <button type="button"
                              onClick={() => openProcessModal(req)}
                              className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                            >
                              İşleme Al
                            </button>
                          )}
                          <button type="button"
                            onClick={() => deleteRequest(req.id)}
                            className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-bold text-white"
                          >
                            sil
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="text-sm font-bold text-slate-900">Talep Detayı</div>
                              <div className="text-xs font-medium text-slate-500">
                                {quantityLocked
                                  ? "Talep oluşturulduğu için miktarlar kilitlidir; ekleme veya çıkarma yapılamaz."
                                  : "Ürün, stok bilgisi, satın alınacak miktar ve proje dağılımı burada görünür. Gerekirse satın alınacak miktarı revize edebilirsiniz."}
                              </div>
                            </div>
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">
                              {requestItems.length} kalem
                            </span>
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr]">
                            <label className="text-xs font-bold text-slate-600">
                              Talep durumu
                              <select value={req.durum || "Yeni Talep"} onChange={(event) => updateRequestStatus(req, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800">
                                <option>Yeni Talep</option>
                                <option>Teklif Bekliyor</option>
                                <option>Teklif Toplanıyor</option>
                                <option>Teklifler Geldi</option>
                                <option>Rapor Oluşturuldu</option>
                                <option>Siparişe Aktarıldı</option>
                                <option>Kapandı</option>
                              </select>
                            </label>
                            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
                              <div className="font-black text-slate-900">Talep zinciri</div>
                              <div className="mt-1">Talep → Teklif ({relations.offers.length}) → Mukayese raporu ({relations.reports.length})</div>
                              {relations.reports.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {relations.reports.map((report) => (
                                    <button key={report.id} type="button" onClick={() => router.push(`/dashboard/raporlar/${report.id}`)} className="rounded-lg bg-emerald-50 px-3 py-2 font-bold text-emerald-700 hover:bg-emerald-100">
                                      Raporu aç
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
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
                                    <th className="px-3 py-3 text-right">Satın alınacak</th>
                                    <th className="px-3 py-3 text-right">Stoktan</th>
                                    <th className="px-3 py-3 text-right">Mevcut stok</th>
                                    <th className="px-3 py-3">Birim</th>
                                    <th className="px-3 py-3 text-right">Birim fiyat</th>
                                    <th className="px-3 py-3 text-right">Toplam</th>
                                    <th className="px-3 py-3">Proje</th>
                                    <th className="px-3 py-3">İşlem</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {requestItems.map((item, itemIndex) => {
                                    const currency = readItemField(item, ["paraBirimi", "currency"], "TRY");
                                    const draftQuantity = requestItemQuantity(req.id, itemIndex, item);
                                    const stockCoverable = readItemField(item, ["stock_coverable_quantity", "stockCoverableQuantity"], 0);
                                    const currentStock = readItemField(item, ["current_stock", "currentStock"], 0);
                                    const allocations = Array.isArray(item.allocations) ? item.allocations : [];
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
                                          {quantityLocked ? (
                                            <span className="inline-flex rounded-lg bg-slate-100 px-3 py-1 text-sm font-black text-slate-700">
                                              {Number(draftQuantity || 0).toLocaleString("tr-TR")}
                                            </span>
                                          ) : (
                                            <input
                                              type="number"
                                              min="0"
                                              value={draftQuantity}
                                              onChange={(event) => setQuantityDrafts((current) => ({
                                                ...current,
                                                [quantityDraftKey(req.id, itemIndex)]: event.target.value,
                                              }))}
                                              className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right font-bold text-blue-700"
                                              aria-label="Satın alınacak miktar"
                                            />
                                          )}
                                        </td>
                                        <td className="px-3 py-3 text-right font-semibold text-emerald-700">
                                          {Number(stockCoverable || 0).toLocaleString("tr-TR")}
                                        </td>
                                        <td className="px-3 py-3 text-right font-semibold text-slate-700">
                                          {Number(currentStock || 0).toLocaleString("tr-TR")}
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
                                        <td className="max-w-[220px] px-3 py-3 text-xs font-medium text-slate-500">
                                          {allocations.length > 0 ? (
                                            <RequestAllocationChips
                                              allocations={allocations}
                                              unit={readItemField(item, ["birim", "unit"], "adet")}
                                            />
                                          ) : cleanRequestNote(readItemField(item, ["not", "note"], "")) || "-"}
                                        </td>
                                        <td className="px-3 py-3">
                                          {quantityLocked ? (
                                            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-500">
                                              Talep kilitli
                                            </span>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={() => saveRequestItemQuantity(req, itemIndex, draftQuantity)}
                                              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                                            >
                                              Miktarı Kaydet
                                            </button>
                                          )}
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
  <button type="button"
    onClick={() => setShowAllRequests(!showAllRequests)}
    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100"
  >
    {showAllRequests ? "Daha az göster" : "Tüm talepleri göster"}
  </button>
</div>      
            </div>
          )}
        </div>
          )}

          {activeRequestTab === "pool" && selectedRequests.length > 0 && (
            <MergedPurchasePreview
              rows={mergedPurchasePreview}
              onCreateOrder={createOrderFromMergedRequests}
            />
          )}

          {activeRequestTab === "upload" && rows.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 p-5">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">
                    Talep Listesi Önizleme
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Sistem tarafından oluşturulan talep listesi.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {createdUploadRequestId && (
                    <button
                      type="button"
                      disabled={pendingUploadMatchCount > 0}
                      onClick={() => {
                        setExpandedRequestId(createdUploadRequestId);
                        setActiveRequestTab("pool");
                      }}
                      title={pendingUploadMatchCount > 0 ? "Önce benzer ürün eşleştirmelerini yanıtlayın." : "Talebi havuzda görüntüle"}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      Talep Havuzunda Gör
                    </button>
                  )}
                  <span className="rounded-full bg-green-100 px-4 py-2 text-sm font-bold text-green-700">
                    {createdUploadRequestId ? pendingUploadMatchCount > 0 ? "Eşleştirme bekliyor · " : "Havuza kaydedildi · " : ""}{rows.length} kalem
                  </span>
                </div>
              </div>

              {pendingUploadMatchCount > 0 && (
                <div className="mx-5 mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="font-black">
                    {pendingUploadMatchCount} benzer kalem için onay gerekiyor
                  </div>
                  <p className="mt-1 font-semibold">
                    Sistem benzer stok kartları buldu. Her satırda aynı ürün olup olmadığını seçin; onaylanan kalem mevcut stok kartı üzerinden ilerler ve yeni kart açılmaz.
                  </p>
                </div>
              )}

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
                    {rows.map((r, i) => {
                      const productMatch = uploadProductMatches[i] || { type: "new", match: null };
                      const matchDecision = uploadMatchDecisions[i];
                      const needsDecision = productMatch.type === "probable" || productMatch.type === "conflict";
                      const matchedProduct = productMatch.match?.product;
                      return (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-4 font-medium text-slate-600">{i + 1}</td>
                        <td className="p-4 font-bold text-slate-800">{r.urunKodu || "-"}</td>
                        <td className="p-4 text-slate-700">
                          {r.urunAciklamasi || "-"}
                          {productMatch.type !== "new" && productMatch.match?.product && (
                            <div className={`mt-2 rounded-lg border px-3 py-2 text-xs font-bold ${productMatch.type === "exact" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : productMatch.type === "conflict" ? "border-red-200 bg-red-50 text-red-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
                              <div>
                                {productMatch.type === "exact" ? "Eşleşen kart" : productMatch.type === "conflict" ? "Kod çakışması" : "Benzer kart"}: %{Math.round((productMatch.match.score || 0) * 100)} · {matchedProduct.product_code || "Kodsuz"} · {matchedProduct.product_name}
                              </div>
                              {needsDecision && !matchDecision && (
                                <div className="mt-2 rounded-lg bg-white/80 p-2">
                                  <div className="text-slate-800">
                                    Bu kalem stoktaki bu ürünle aynı ürün mü?
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      disabled={resolvingUploadMatchIndex !== null}
                                      onClick={() => resolveUploadProductMatch(i, productMatch, "confirm")}
                                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                      Evet, bu stok kartı
                                    </button>
                                    <button
                                      type="button"
                                      disabled={resolvingUploadMatchIndex !== null}
                                      onClick={() => resolveUploadProductMatch(i, productMatch, "reject")}
                                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      Hayır, farklı ürün
                                    </button>
                                  </div>
                                </div>
                              )}
                              {matchDecision === "reject" && (
                                <div className="mt-2 text-slate-600">Farklı ürün olarak bırakıldı.</div>
                              )}
                              {matchDecision === "confirm" && (
                                <div className="mt-2 text-emerald-700">Mevcut stok kartına bağlandı.</div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="p-4 font-bold text-slate-800">{r.talepEdilenAdet || 0}</td>
                        <td className="p-4 text-slate-600">{r.birim || "-"}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </main>
      {uploadRequestModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleAnalyze();
            }}
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div className="text-xs font-black uppercase tracking-wide text-blue-700">Talep bilgisi</div>
            <h2 className="mt-1 text-xl font-black text-slate-950">Talebi açan kişi kim?</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              Bu bilgiler talep havuzunda ve satın alma sürecinde gösterilir.
            </p>

            {uploadRequestError && (
              <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
                {uploadRequestError}
              </div>
            )}

            <label className="mt-5 block text-sm font-bold text-slate-700">
              Talebi açan kişi
              <input
                autoFocus
                value={uploadRequestModal.requester}
                onChange={(event) => updateUploadRequestModal("requester", event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Ad soyad"
              />
            </label>

            <label className="mt-4 block text-sm font-bold text-slate-700">
              Birim / departman
              <input
                value={uploadRequestModal.department}
                onChange={(event) => updateUploadRequestModal("department", event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Satın alma, şantiye, depo..."
              />
            </label>

            <label className="mt-4 block text-sm font-bold text-slate-700">
              Aciliyet
              <select
                value={uploadRequestModal.priority}
                onChange={(event) => updateUploadRequestModal("priority", event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option>Normal</option>
                <option>Acil</option>
                <option>Kritik</option>
                <option>Düşük</option>
              </select>
            </label>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeUploadRequestModal}
                disabled={isLoading}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={isLoading || !uploadRequestModal.requester.trim()}
                className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isLoading ? "Oluşturuluyor..." : "Talep Listesi Oluştur"}
              </button>
            </div>
          </form>
        </div>
      )}
      {processModal.request && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">Talebi İşleme Al</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  Talebi kimin işleme aldığını, ilgili birimi ve aciliyet seviyesini kaydedin.
                </p>
              </div>
              <button
                type="button"
                onClick={closeProcessModal}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-600 hover:bg-slate-50"
              >
                Kapat
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-black text-slate-700">
                İşleme alan kişi
                <input
                  value={processModal.processor}
                  onChange={(event) => updateProcessModal("processor", event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="Ad soyad"
                  autoFocus
                />
              </label>

              <label className="block text-sm font-black text-slate-700">
                Birim / departman
                <input
                  value={processModal.department}
                  onChange={(event) => updateProcessModal("department", event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="Satınalma, ÜR-GE, Şantiye..."
                />
              </label>

              <label className="block text-sm font-black text-slate-700">
                Aciliyet
                <select
                  value={processModal.priority}
                  onChange={(event) => updateProcessModal("priority", event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option>Normal</option>
                  <option>Düşük</option>
                  <option>Orta</option>
                  <option>Yüksek</option>
                  <option>Kritik</option>
                </select>
              </label>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeProcessModal}
                className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600 hover:bg-slate-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={!processModal.processor.trim()}
                onClick={takeRequestIntoProcess}
                className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                İşleme Al
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
