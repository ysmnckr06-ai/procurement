"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CORVIAN_PRODUCT_NAME, fetchCompanyBranding } from "@/lib/companyBranding";
import { matchProduct, productMatchLabel } from "@/lib/productMatching";
import {
  analyzeStockMatrix,
  STOCK_IMPORT_ACCEPT,
  STOCK_IMPORT_FIELDS,
  stockImportExpectedColumns,
} from "@/lib/stockImport";
import { analyzeStockFile } from "@/lib/fileAnalyzer";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const PRODUCT_TYPES = {
  MAIN: "main_product",
  COMPONENT: "component",
};
const STOCK_VIEW_FILTERS = {
  ALL: "all",
  DEPOT: "depot",
  AVAILABLE: "available",
  RESERVED: "reserved",
  PRODUCTION: "production",
  LOW: "low",
};

function productTypeOf(product) {
  const categoryHint = normalizeStockText(product?.category);
  return product?.product_type === PRODUCT_TYPES.MAIN || categoryHint === "ana urun" || categoryHint === "ana ürün"
    ? PRODUCT_TYPES.MAIN
    : PRODUCT_TYPES.COMPONENT;
}

function isMainProduct(product) {
  return productTypeOf(product) === PRODUCT_TYPES.MAIN;
}

function MoneyValue({ value, currency = "TRY", tone = "text-slate-900" }) {
  const amount = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

  return (
    <span className="block min-w-0 max-w-full leading-tight" title={`${amount} ${currency || "TRY"}`}>
      <span className={`block max-w-full break-words text-sm font-black ${tone}`}>{amount}</span>
      <span className="block text-[11px] font-black uppercase text-slate-500">{currency || "TRY"}</span>
    </span>
  );
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("tr-TR");
}

function safeFileName(value) {
  return String(value || "stok-raporu")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function exportDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

async function downloadExcelWorkbook(fileName, sheets, companyName) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  sheets.forEach((sheet) => {
    const rows = sheet.rows.length > 0 ? sheet.rows : [{ Bilgi: "Kayit bulunamadi" }];
    const worksheet = XLSX.utils.aoa_to_sheet([
      [companyName],
      [CORVIAN_PRODUCT_NAME],
      [`Rapor: ${sheet.name}`, `Oluşturma tarihi: ${new Date().toLocaleString("tr-TR")}`],
      [],
    ]);
    XLSX.utils.sheet_add_json(worksheet, rows, { origin: "A5" });
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  });

  XLSX.writeFile(workbook, `${safeFileName(fileName)}.xlsx`);
}

async function downloadPdfTable(fileName, title, rows, companyName) {
  const { jsPDF } = await import("jspdf");
  const autoTableModule = await import("jspdf-autotable");
  const autoTable = autoTableModule.default || autoTableModule.autoTable;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const columns = Object.keys(rows[0] || { Bilgi: "Kayit bulunamadi" });
  const body = (rows.length > 0 ? rows : [{ Bilgi: "Kayit bulunamadi" }]).map((row) =>
    columns.map((column) => String(row[column] ?? "")),
  );

  doc.setFontSize(13);
  doc.text(companyName, 40, 32);
  doc.setFontSize(8);
  doc.text(CORVIAN_PRODUCT_NAME, 40, 44);
  doc.setFontSize(12);
  doc.text(title, 40, 62);
  doc.setFontSize(8);
  doc.text(`Oluşturma tarihi: ${formatDate(new Date())}`, 40, 76);
  autoTable(doc, {
    startY: 90,
    head: [columns],
    body,
    styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [15, 23, 42] },
    margin: { left: 30, right: 30 },
  });
  doc.save(`${safeFileName(fileName)}.pdf`);
}

function normalizeStockText(value) {
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

function normalizeStockCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeProductIdentity(product) {
  const rawBrand = String(product?.brand || "").trim();
  let productName = String(product?.product_name || product?.description || "").trim();
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

  return {
    ...product,
    brand,
    product_name: productName,
  };
}

function productGroupKey(product) {
  const normalized = normalizeProductIdentity(product);
  const code = normalizeStockCode(normalized.product_code);
  const name = normalizeStockText(normalized.product_name);

  if (code) return `code__${code}`;
  return `name__${name}`;
}

function productMatchesWithoutCode(product, candidate) {
  if (normalizeStockCode(product?.product_code) || normalizeStockCode(candidate?.product_code)) return false;

  const productIdentity = normalizeProductIdentity(product);
  const candidateIdentity = normalizeProductIdentity(candidate);
  return normalizeStockText(productIdentity.product_name) === normalizeStockText(candidateIdentity.product_name)
    && normalizeStockText(productIdentity.brand) === normalizeStockText(candidateIdentity.brand)
    && normalizeStockText(productIdentity.unit || "adet") === normalizeStockText(candidateIdentity.unit || "adet");
}

function stockCriticalLimit(product) {
  return Math.max(
    Number(product.min_stock || 0),
    Number(product.critical_stock || 0),
    Number(product.minimum_stock || 0),
  );
}

function mergeProductGroups(items) {
  const grouped = new Map();

  items.forEach((product) => {
    const normalizedProduct = normalizeProductIdentity(product);
    const key = productGroupKey(normalizedProduct);
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...normalizedProduct,
        groupKey: key,
        duplicateIds: [normalizedProduct.id],
        duplicateCount: 1,
        current_stock: Number(normalizedProduct.current_stock || 0),
        reserved_stock: Number(normalizedProduct.reserved_stock || 0),
        product_type: productTypeOf(normalizedProduct),
      });
      return;
    }

    const existingDate = new Date(existing.updated_at || existing.created_at || 0).getTime();
    const productDate = new Date(normalizedProduct.updated_at || normalizedProduct.created_at || 0).getTime();
    const base = productDate > existingDate ? { ...existing, ...normalizedProduct } : existing;

    grouped.set(key, {
      ...base,
      groupKey: key,
      duplicateIds: [...existing.duplicateIds, normalizedProduct.id],
      duplicateCount: existing.duplicateCount + 1,
      is_virtual_project_main: Boolean(existing.is_virtual_project_main && normalizedProduct.is_virtual_project_main),
      current_stock: Number(existing.current_stock || 0) + Number(normalizedProduct.current_stock || 0),
      reserved_stock: Number(existing.reserved_stock || 0) + Number(normalizedProduct.reserved_stock || 0),
      product_type: isMainProduct(existing) || isMainProduct(normalizedProduct) ? PRODUCT_TYPES.MAIN : PRODUCT_TYPES.COMPONENT,
      last_supplier: normalizedProduct.last_supplier || existing.last_supplier,
      last_unit_price: Number(normalizedProduct.last_unit_price || 0) || existing.last_unit_price,
      last_currency: normalizedProduct.last_currency || existing.last_currency,
      last_movement_at: normalizedProduct.last_movement_at || existing.last_movement_at,
    });
  });

  return Array.from(grouped.values()).sort((a, b) =>
    String(a.product_name || "").localeCompare(String(b.product_name || ""), "tr-TR"),
  );
}

function projectMainItemsAsProducts(projectItems = [], productRows = []) {
  const existingKeys = new Set(productRows.map((product) => productGroupKey(normalizeProductIdentity(product))));
  const parentIdsWithChildren = new Set(projectItems.map((item) => item.parent_item_id).filter(Boolean));
  const grouped = new Map();

  projectItems.forEach((item) => {
    const isParent = item.item_type === "main" || parentIdsWithChildren.has(item.id);
    const productName = String(item.product_name || item.description || "").trim();
    if (!isParent || !productName) return;

    const virtualProduct = normalizeProductIdentity({
      id: item.product_id || `project-main-${item.id}`,
      product_code: item.product_code || item.code || "",
      brand: item.brand || "",
      product_name: productName,
      unit: item.unit || "adet",
      category: item.category || "Ana Ürün",
      product_type: PRODUCT_TYPES.MAIN,
      current_stock: 0,
      reserved_stock: 0,
      source: "Proje ana kalemi",
      notes: "Proje malzeme listesinden gelen ana ürün",
      created_at: item.created_at,
      updated_at: item.updated_at || item.created_at,
      is_virtual_project_main: true,
    });
    const key = productGroupKey(virtualProduct);
    if (existingKeys.has(key)) return;

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...virtualProduct,
        groupKey: key,
        duplicateIds: [virtualProduct.id],
        duplicateCount: 1,
        virtualProjectItemIds: [item.id],
      });
      return;
    }

    grouped.set(key, {
      ...existing,
      duplicateIds: [...existing.duplicateIds, virtualProduct.id],
      duplicateCount: existing.duplicateCount + 1,
      virtualProjectItemIds: [...existing.virtualProjectItemIds, item.id],
    });
  });

  return Array.from(grouped.values());
}

function movementStatus(movement) {
  const source = normalizeStockText(movement.source || movement.notes || "");
  if (source.includes("projeye") || Number(movement.reserved_quantity || 0) > 0) return "Projeye Ayrıldı";
  if (source.includes("uretim") || Number(movement.issued_to_production_quantity || 0) > 0) return "Üretime Verildi";
  if (source.includes("montaj")) return "Montaja Verildi";
  if (source.includes("sevk")) return "Sevk Edildi";
  if (source.includes("iade")) return "İade";
  if (source.includes("fire") || source.includes("hatal")) return "Fire / Hatalı";
  return movement.movement_type === "out" ? "Projeye Ayrıldı" : "Depoya Giriş";
}

function movementStatusClass(status) {
  const classes = {
    "Depoya Giriş": "bg-green-100 text-green-700",
    "Projeye Ayrıldı": "bg-blue-100 text-blue-700",
    "Üretime Verildi": "bg-purple-100 text-purple-700",
    "Montaja Verildi": "bg-orange-100 text-orange-700",
    "Sevk Edildi": "bg-slate-900 text-white",
    İade: "bg-cyan-100 text-cyan-700",
    "Fire / Hatalı": "bg-red-100 text-red-700",
  };

  return classes[status] || "bg-slate-100 text-slate-700";
}

function movementPartnerName(movement) {
  return movement.partner_name || movement.supplier_name || movement.vendor_name || movement.customer_name || movement.company_name || "-";
}

function movementReference(movement) {
  return movement.order_code
    || movement.order_number
    || movement.purchase_order_code
    || movement.delivery_number
    || movement.request_code
    || movement.invoice_number
    || movement.source_file
    || movement.reference
    || movement.document_no
    || "-";
}

function movementFlowInfo(movement, project = null) {
  const source = movement.source || movement.notes || "";
  const normalizedSource = normalizeStockText(source);
  const isOut = movement.movement_type === "out";
  const partner = movementPartnerName(movement);
  const projectName = project ? projectDisplayName(project) : "";

  if (isOut) {
    let target = projectName ? `Proje çıkışı: ${projectName}` : "Stoktan çıkış";
    if (normalizedSource.includes("sevk")) target = projectName ? `Sevk: ${projectName}` : "Sevk edilen";
    if (normalizedSource.includes("fire") || normalizedSource.includes("hatal")) target = "Fire / hatalı ürün çıkışı";
    if (normalizedSource.includes("iade")) target = partner !== "-" ? `İade: ${partner}` : "İade çıkışı";

    return {
      direction: "Çıkış",
      source: "Depo / mevcut stok",
      target,
      partner,
      reference: movementReference(movement),
      detail: source || target,
    };
  }

  let entrySource = "Depoya giriş";
  if (normalizedSource.includes("sayim") || normalizedSource.includes("sayım")) entrySource = "Depo sayımı";
  if (normalizedSource.includes("manuel")) entrySource = "Manuel stok girişi";
  if (normalizedSource.includes("siparis") || normalizedSource.includes("sipariş") || movement.order_id || movement.purchase_order_id) {
    entrySource = "Sipariş teslimatı";
  }
  if (normalizedSource.includes("toplu") || normalizedSource.includes("dosya")) entrySource = "Toplu dosya aktarımı";
  if (normalizedSource.includes("iade")) entrySource = "İade girişi";

  return {
    direction: "Giriş",
    source: partner !== "-" ? `${entrySource}: ${partner}` : entrySource,
    target: "Depo stoğu",
    partner,
    reference: movementReference(movement),
    detail: source || entrySource,
  };
}

function stockBreakdown(product, movements) {
  const matchedMovements = movements.filter((movement) => movementMatchesProduct(movement, product));
  const reserved = Number(product.reserved_stock || 0) + matchedMovements.reduce(
    (sum, movement) => sum + Number(movement.reserved_quantity || 0),
    0,
  );
  const production = matchedMovements.reduce(
    (sum, movement) => sum + Number(movement.issued_to_production_quantity || 0),
    0,
  );
  const montage = matchedMovements
    .filter((movement) => movementStatus(movement) === "Montaja Verildi")
    .reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);
  const inProcess = production + montage;
  const shipped = matchedMovements
    .filter((movement) => movementStatus(movement) === "Sevk Edildi")
    .reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);
  const total = Number(product.current_stock || 0);

  return {
    total,
    reserved,
    production: inProcess,
    montage: 0,
    shipped,
    available: Math.max(total - reserved - inProcess, 0),
  };
}

function productProjectAllocations(product, projectItems, projects, movements) {
  if (!product) return { rows: [], projectRows: [], allocatedTotal: 0, missingTotal: 0, freeStock: 0 };

  const projectById = new Map((projects || []).map((project) => [project.id, project]));
  const itemById = new Map((projectItems || []).map((item) => [item.id, item]));
  const relatedItems = (projectItems || [])
    .filter((item) => projectItemMatchesProduct(item, product))
    .filter((item) => Number(item.estimated_quantity || 0) > 0)
    .sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0));

  let remainingStock = Number(stockBreakdown(product, movements).total || 0);
  const rows = relatedItems.map((item) => {
    const project = projectById.get(item.project_id);
    const need = Number(item.estimated_quantity || 0);
    const consumed = Number(item.consumed_child_quantity || item.issued_to_production_quantity || 0);
    const openNeed = Math.max(need - consumed, 0);
    const allocated = Math.min(remainingStock, openNeed);
    remainingStock -= allocated;
    const missing = Math.max(openNeed - allocated, 0);
    const movementRows = (movements || []).filter((movement) =>
      movementMatchesProduct(movement, product) && movement.project_id === item.project_id
    );
    const parent = item.parent_item_id ? itemById.get(item.parent_item_id) : null;

    return {
      item,
      parent,
      project,
      need,
      consumed,
      openNeed,
      allocated,
      missing,
      movementRows,
    };
  });

  const groupedProjects = new Map();
  rows.forEach((row) => {
    const key = row.item.project_id || "no-project";
    const current = groupedProjects.get(key) || {
      key,
      project: row.project,
      rows: [],
      need: 0,
      consumed: 0,
      allocated: 0,
      missing: 0,
      movementCount: 0,
      lastDate: null,
    };

    current.rows.push(row);
    current.need += row.need;
    current.consumed += row.consumed;
    current.allocated += row.allocated;
    current.missing += row.missing;
    current.movementCount += row.movementRows.length;
    const rowDate = row.item.created_at || row.item.updated_at;
    if (rowDate && (!current.lastDate || new Date(rowDate) > new Date(current.lastDate))) {
      current.lastDate = rowDate;
    }
    groupedProjects.set(key, current);
  });

  const projectRows = [...groupedProjects.values()].map((projectRow) => {
    const parentGroups = new Map();
    projectRow.rows.forEach((row) => {
      const parentKey = row.parent?.id || row.item.id;
      const parentName = row.parent?.product_name || row.parent?.description || (row.parent ? "Ana kalem" : "Bağımsız kalem");
      const current = parentGroups.get(parentKey) || {
        key: parentKey,
        parent: row.parent,
        parentName,
        rows: [],
        need: 0,
        consumed: 0,
        allocated: 0,
        missing: 0,
      };

      current.rows.push(row);
      current.need += row.need;
      current.consumed += row.consumed;
      current.allocated += row.allocated;
      current.missing += row.missing;
      parentGroups.set(parentKey, current);
    });

    return {
      ...projectRow,
      parentGroups: [...parentGroups.values()].sort((left, right) => right.need - left.need),
    };
  });

  return {
    rows,
    projectRows,
    allocatedTotal: rows.reduce((sum, row) => sum + row.allocated, 0),
    missingTotal: rows.reduce((sum, row) => sum + row.missing, 0),
    freeStock: Math.max(remainingStock, 0),
  };
}

function mainProductProjectStats(product, projectItems, movements) {
  if (!product) {
    return { projectCount: 0, projectQuantity: 0, inProcess: 0, shipped: 0, remainingShipment: 0 };
  }

  const relatedItems = (projectItems || [])
    .filter((item) => projectItemMatchesProduct(item, product) || (item.item_type === "main" && normalizeStockText(item.product_name) === normalizeStockText(product.product_name)));
  const projectIds = new Set(relatedItems.map((item) => item.project_id).filter(Boolean));
  const projectCount = projectIds.size || (relatedItems.length > 0 ? 1 : 0);
  const projectQuantity = relatedItems.reduce((sum, item) => sum + Number(item.estimated_quantity || 0), 0);
  const inProcess = relatedItems.reduce(
    (sum, item) => sum + Number(item.produced_parent_quantity || item.issued_to_production_quantity || 0),
    0,
  );
  const shipped = (movements || [])
    .filter((movement) => movementMatchesProduct(movement, product))
    .filter((movement) => movement.movement_type === "out" || normalizeStockText(movement.source).includes("sevk"))
    .reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);

  return {
    projectCount,
    projectQuantity,
    inProcess,
    shipped,
    remainingShipment: Math.max(projectQuantity - shipped, 0),
  };
}

function movementMatchesProduct(movement, product) {
  if (!product) return false;

  const ids = product.duplicateIds || [product.id];
  if (movement.product_id && ids.includes(movement.product_id)) return true;

  const productCode = normalizeStockCode(product.product_code);
  const movementCode = normalizeStockCode(movement.product_code);
  const productName = normalizeStockText(product.product_name);
  const movementName = normalizeStockText(movement.product_name);

  if (productCode && movementCode && productCode === movementCode && productName === movementName) {
    return true;
  }

  return !productCode && productName && productName === movementName;
}

function projectItemMatchesProduct(item, product) {
  if (!product || !item) return false;

  const ids = product.duplicateIds || [product.id];
  if (item.product_id && ids.includes(item.product_id)) return true;

  const productCode = normalizeStockCode(product.product_code);
  const itemCode = normalizeStockCode(item.product_code);
  const productName = normalizeStockText(product.product_name);
  const itemName = normalizeStockText(item.product_name || item.description);

  if (productCode && itemCode && productCode === itemCode && productName === itemName) return true;
  return !productCode && productName && productName === itemName;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function projectDisplayName(project) {
  const company = project?.customer_name || project?.customer || project?.client_name || project?.client || project?.firma || project?.firmaAdi || project?.musteri_adi || project?.musteriAdi || "";
  const projectName = project?.project_name || project?.name || project?.title || project?.proje_adi || project?.projeAdi || project?.project_code || "Proje";

  if (company && normalizeStockText(company) !== normalizeStockText(projectName)) {
    return `${company} - ${projectName}`;
  }

  return projectName;
}

function StatCard({ title, value, text, active = false, onClick }) {
  const Component = onClick ? "button" : "div";

  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-2xl border p-5 text-left shadow-sm transition ${
        active
          ? "border-blue-300 bg-blue-50 ring-2 ring-blue-100"
          : "border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50"
      }`}
    >
      <div className="text-sm font-semibold text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{text}</div>
    </Component>
  );
}

function buildProductExportRows(productList, movements, projectItems, projects) {
  return productList.map((product) => {
    const breakdown = stockBreakdown(product, movements);
    const allocation = productProjectAllocations(product, projectItems, projects, movements);
    const lastPrice = Number(product.last_unit_price || product.manual_unit_price || 0);
    return {
      "Urun kodu": product.product_code || "-",
      Marka: product.brand || "-",
      "Urun aciklamasi": product.product_name || "-",
      Birim: product.unit || "adet",
      "Mevcut stok": breakdown.total,
      "Projeye ayrilan": allocation.allocatedTotal,
      "Bosta kullanilabilir": allocation.freeStock,
      "Alinmasi gereken": allocation.missingTotal,
      "Rezerve": breakdown.reserved,
      "Islenen / uygulamadaki": breakdown.production + breakdown.montage,
      "Sevk edilen": breakdown.shipped,
      "Minimum stok": product.min_stock ?? product.minimum_stock ?? 0,
      "Kritik stok": product.critical_stock ?? 0,
      "Son alis fiyati": lastPrice,
      "Para birimi": product.last_currency || "TRY",
      "Son is ortagi": product.last_supplier || "-",
      "Proje sayisi": allocation.projectRows.length,
      "Kaynak / not": product.notes || product.source || "-",
    };
  });
}

function buildMovementExportRows(movementList, projects, fallbackProduct = null) {
  return movementList.map((movement) => {
    const project = projects.find((item) => item.id === movement.project_id);
    const flow = movementFlowInfo(movement, project);
    const quantity = Number(movement.quantity || 0);
    const unitPrice = Number(movement.unit_price || movement.purchase_unit_price || movement.price || movement.unit_cost || 0);
    const total = Number(movement.total_amount || movement.total || quantity * unitPrice || 0);
    return {
      "Hareket tarihi": formatDate(movement.movement_date || movement.created_at),
      "Kayit tarihi": formatDate(movement.created_at),
      "Urun kodu": movement.product_code || fallbackProduct?.product_code || "-",
      "Urun aciklamasi": movement.product_name || fallbackProduct?.product_name || "-",
      Yon: flow.direction,
      "Hareket tipi": movementStatus(movement),
      "Giris kaynagi": flow.source,
      "Cikis hedefi": flow.target,
      Firma: flow.partner,
      "Belge / referans": flow.reference,
      Miktar: quantity,
      Birim: movement.unit || fallbackProduct?.unit || "adet",
      "Birim fiyat": unitPrice,
      "Toplam tutar": total,
      "Para birimi": movement.currency || fallbackProduct?.last_currency || "TRY",
      Proje: project ? projectDisplayName(project) : "-",
      Aciklama: flow.detail,
    };
  });
}

function buildProductUsageExportRows(product, allocation) {
  if (!product) return [];

  return allocation.projectRows.flatMap((projectRow) => {
    const projectName = projectDisplayName(projectRow.project);
    const projectSummary = {
      Seviye: "Proje toplam",
      Proje: projectName,
      "Ana kalem": "-",
      "Urun kodu": product.product_code || "-",
      "Urun aciklamasi": product.product_name || "-",
      Ihtiyac: projectRow.need,
      Kullanilan: projectRow.consumed,
      Ayrilan: projectRow.allocated,
      Eksik: projectRow.missing,
      "Hareket sayisi": projectRow.movementCount,
      "Son tarih": formatDate(projectRow.lastDate),
    };
    const parentRows = projectRow.parentGroups.map((parentGroup) => ({
      Seviye: "Ana kalem",
      Proje: projectName,
      "Ana kalem": parentGroup.parentName,
      "Urun kodu": product.product_code || "-",
      "Urun aciklamasi": product.product_name || "-",
      Ihtiyac: parentGroup.need,
      Kullanilan: parentGroup.consumed,
      Ayrilan: parentGroup.allocated,
      Eksik: parentGroup.missing,
      "Hareket sayisi": parentGroup.rows.reduce((sum, row) => sum + row.movementRows.length, 0),
      "Son tarih": formatDate(projectRow.lastDate),
    }));

    return [projectSummary, ...parentRows];
  });
}

export default function StockPage() {
  const router = useRouter();
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [projectItems, setProjectItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [expandedProjectKeys, setExpandedProjectKeys] = useState([]);
  const [productForm, setProductForm] = useState({
    brand: "",
    min_stock: "",
    critical_stock: "",
    manual_unit_price: "",
    notes: "",
  });
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [stockImportApplying, setStockImportApplying] = useState(false);
  const [stockImportPreview, setStockImportPreview] = useState(null);
  const [stockImportResult, setStockImportResult] = useState(null);
  const [activeProductType, setActiveProductType] = useState(PRODUCT_TYPES.COMPONENT);
  const [stockViewFilter, setStockViewFilter] = useState(STOCK_VIEW_FILTERS.ALL);
  const [showArchivedProducts, setShowArchivedProducts] = useState(false);
  const [stockImportType, setStockImportType] = useState(PRODUCT_TYPES.COMPONENT);
  const [selectedProductKeys, setSelectedProductKeys] = useState([]);
  const [selectedMovementIds, setSelectedMovementIds] = useState([]);
  const [bulkDeletingProducts, setBulkDeletingProducts] = useState(false);
  const [bulkDeletingMovements, setBulkDeletingMovements] = useState(false);
  const [movementDeleteModalOpen, setMovementDeleteModalOpen] = useState(false);
  const [productDeleteModalOpen, setProductDeleteModalOpen] = useState(false);
  const [productDeleteAnalysis, setProductDeleteAnalysis] = useState(null);
  const [productDeleteResult, setProductDeleteResult] = useState(null);
  const [analyzingProductDeletion, setAnalyzingProductDeletion] = useState(false);
  const [productDeleteBlockKey, setProductDeleteBlockKey] = useState("");
  const movementSectionRef = useRef(null);

  useEffect(() => {
    loadStock();
  }, [showArchivedProducts]);

  useEffect(() => {
    setProductPage(1);
  }, [search, stockViewFilter, activeProductType]);

  useEffect(() => {
    if (!selectedProduct) {
      setProductForm({ brand: "", min_stock: "", critical_stock: "", manual_unit_price: "", notes: "" });
      return;
    }

    setProductForm({
      brand: selectedProduct.brand || "",
      min_stock: String(selectedProduct.min_stock ?? selectedProduct.minimum_stock ?? ""),
      critical_stock: String(selectedProduct.critical_stock ?? ""),
      manual_unit_price: String(selectedProduct.manual_unit_price ?? ""),
      notes: selectedProduct.notes || "",
    });
  }, [selectedProduct]);

  async function loadStock() {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    console.log("Stock page session user", {
      userId: user.id,
      email: user.email || null,
    });

    let productQuery = supabase
      .from("products")
      .select("*", { count: "exact" })
      .eq("user_id", user.id);
    productQuery = showArchivedProducts
      ? productQuery.not("archived_at", "is", null)
      : productQuery.is("archived_at", null);
    const { data: productData, error: productError, count: productCount } = await productQuery
      .order("updated_at", { ascending: false });

    const { data: movementData, error: movementError, count: movementCount } = await supabase
      .from("stock_movements")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(2000);

    const { data: projectItemData, error: projectItemError } = await supabase
      .from("project_items")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(5000);

    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", user.id)
      .limit(1000);

    console.log("Stock products query result", {
      table: "products",
      filter: { user_id: user.id },
      returned: productData?.length || 0,
      count: productCount,
      error: productError?.message || null,
      sampleUserIds: Array.from(new Set((productData || []).map((product) => product.user_id))).slice(0, 5),
    });

    console.log("Stock movements query result", {
      table: "stock_movements",
      filter: { user_id: user.id },
      returned: movementData?.length || 0,
      count: movementCount,
      error: movementError?.message || null,
    });

    if (productError || movementError || projectItemError || projectError) {
      setMessage("Stok tabloları hazır değil. Supabase şemasındaki products ve stock_movements bölümlerini çalıştırın.");
    }

    setProducts(productData || []);
    setMovements(movementData || []);
    setProjectItems(projectItemData || []);
    setProjects(projectData || []);
    setLoading(false);
  }

  async function restoreArchivedProduct(product) {
    if (!product?.id) return;
    const approved = window.confirm(`${product.product_name} ürün kartı aktif stok listesine geri alınsın mı?`);
    if (!approved) return;
    const { error } = await supabase.rpc("restore_archived_product", {
      target_product_id: product.id,
    });
    if (error) {
      setMessage(error.message || "Ürün geri yüklenemedi.");
      return;
    }
    setSelectedProduct(null);
    setMessage("Ürün aktif stok listesine geri yüklendi.");
    await loadStock();
  }

  async function deleteProductGroup(product) {
    if (!product) return;

    if (product.is_virtual_project_main) {
      setMessage("Bu ana ürün proje malzeme listesinden geliyor. Silmek için ilgili proje kalemini düzenleyin.");
      return;
    }

    const productIds = (product.duplicateIds || [product.id]).filter(isUuid);

    const approved = window.confirm(`${product.product_name} ürün kartını silmek istiyor musunuz?`);
    if (!approved) return;

    setDeleting(true);
    setMessage("");

    const result = await deleteProductsWithStockRecords(productIds);

    if (result.error) {
      setMessage("Ürün kartı silinirken hata oluştu.");
      setDeleting(false);
      return;
    }

    const deletedProductCount = Number(result.deletedProductCount || 0);
    const failedProductCount = Number(result.failedProductCount || 0);
    setMessage(`${deletedProductCount} ürün silindi. ${failedProductCount} ürün silinemedi.`);
    setProductDeleteBlockKey("");
    if (deletedProductCount > 0) {
      setSelectedProduct(null);
      if (typeof window !== "undefined") window.localStorage.removeItem("stock-selected-product-key");
    }
    setDeleting(false);
    await loadStock();
  }

  async function deleteProductsWithStockRecords(productIds) {
    const safeProductIds = [...new Set((productIds || []).filter(isUuid))];
    if (safeProductIds.length === 0) {
      return { deletedProductCount: 0, failedProductCount: 0, failedProductIds: [] };
    }

    const { data, error } = await supabase.rpc("bulk_delete_products_with_stock_records", {
      target_product_ids: safeProductIds,
    });

    if (!error) {
      return {
        deletedProductCount: Number(data?.deletedProductCount || 0),
        failedProductCount: Number(data?.failedProductCount || 0),
        failedProductIds: data?.failedProductIds || [],
      };
    }

    console.warn("Toplu ürün silme RPC kullanılamadı, doğrudan silme deneniyor:", error);

    let deletedProductCount = 0;
    const deletedProductIds = [];
    for (let offset = 0; offset < safeProductIds.length; offset += 100) {
      const chunk = safeProductIds.slice(offset, offset + 100);

      const { error: movementDeleteError } = await supabase
        .from("stock_movements")
        .delete()
        .in("product_id", chunk);

      if (movementDeleteError) {
        console.warn("Ürün stok hareketleri temizlenemedi, ürün silme deneniyor:", movementDeleteError);
      }

      const { data: deletedRows, error: productDeleteError } = await supabase
        .from("products")
        .delete()
        .in("id", chunk)
        .select("id");

      if (productDeleteError) {
        return {
          error: productDeleteError,
          deletedProductCount,
          failedProductCount: safeProductIds.length - deletedProductCount,
          failedProductIds: safeProductIds.filter((id) => !deletedProductIds.includes(id)),
        };
      }

      const rows = deletedRows || [];
      deletedProductCount += rows.length;
      deletedProductIds.push(...rows.map((row) => row.id));
    }

    const failedProductIds = safeProductIds.filter((id) => !deletedProductIds.includes(id));
    return {
      deletedProductCount,
      failedProductCount: failedProductIds.length,
      failedProductIds,
    };
  }

  async function analyzeSelectedProductsForDeletion() {
    const selectedGroups = productGroups.filter((product) => selectedProductKeys.includes(product.groupKey));
    if (selectedGroups.length === 0 || analyzingProductDeletion) return;

    setAnalyzingProductDeletion(true);
    setProductDeleteResult(null);
    setProductDeleteAnalysis(null);
    setProductDeleteModalOpen(true);
    setMessage("");

    try {
      const productIds = selectedGroups.flatMap((product) => product.duplicateIds || [product.id]).filter(isUuid);
      setProductDeleteAnalysis({
        productIds,
        selectedProductCount: selectedGroups.length,
      });
    } catch (_error) {
      setProductDeleteModalOpen(false);
      setMessage("Silme hazırlığı tamamlanamadı.");
    } finally {
      setAnalyzingProductDeletion(false);
    }
  }

  async function executeAnalyzedProductDeletion() {
    if (!productDeleteAnalysis || bulkDeletingProducts) return;
    setBulkDeletingProducts(true);
    setProductDeleteResult(null);
    setMessage("");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setProductDeleteModalOpen(false);
        router.push("/login");
        return;
      }

      const result = await deleteProductsWithStockRecords(productDeleteAnalysis.productIds || []);

      if (result.error) {
        setMessage("Toplu ürün silme işlemi tamamlanamadı.");
        return;
      }

      const failedProductIds = new Set(result.failedProductIds || []);
      const failedKeys = productGroups
        .filter((product) => (product.duplicateIds || [product.id]).some((id) => failedProductIds.has(id)))
        .map((product) => product.groupKey);
      setSelectedProductKeys(failedKeys);
      if (selectedProduct && !failedKeys.includes(selectedProduct.groupKey)) setSelectedProduct(null);
      setProductDeleteBlockKey("");
      setProductDeleteResult({
        deletedProductCount: Number(result.deletedProductCount || 0),
        failedProductCount: Number(result.failedProductCount || 0),
      });
      setMessage(`${Number(result.deletedProductCount || 0)} ürün silindi. ${Number(result.failedProductCount || 0)} ürün silinemedi.`);
      await loadStock();
    } catch (_error) {
      setMessage("Toplu ürün silme işlemi tamamlanamadı.");
    } finally {
      setBulkDeletingProducts(false);
    }
  }

  async function deleteSelectedMovements() {
    const selectedRows = movements.filter(
      (movement) =>
        selectedMovementIds.includes(movement.id) &&
        (!selectedProduct || movementMatchesProduct(movement, selectedProduct)),
    );
    if (selectedRows.length === 0) return;

    setMovementDeleteModalOpen(false);
    setBulkDeletingMovements(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setBulkDeletingMovements(false);
      router.push("/login");
      return;
    }

    const deletedIds = [];
    const failedRows = [];

    for (const movement of selectedRows) {
      const { error } = await supabase.rpc("delete_stock_movement_with_reversal", {
        target_movement_id: movement.id,
      });

      if (error) {
        failedRows.push({ movement, error });
      } else {
        deletedIds.push(movement.id);
      }
    }

    setSelectedMovementIds(failedRows.map(({ movement }) => movement.id));
    setBulkDeletingMovements(false);
    await loadStock();

    if (failedRows.length > 0) {
      const failedLabels = failedRows
        .map(
          ({ movement }) =>
            `${movement.product_name || "Stok hareketi"} (${String(movement.id).slice(0, 8)})`,
        )
        .join(", ");
      setMessage(
        `${deletedIds.length} hareket silindi. Silinemeyen kayıtlar: ${failedLabels}. ` +
          "Bu kayıtlar mevcut bağlantıları nedeniyle korunuyor olabilir.",
      );
      return;
    }

    setMessage(`${deletedIds.length} stok hareketi silindi ve stok toplamları geri alındı.`);
  }

  function openProductDetail(product) {
    setSelectedProduct(product);
    setSelectedMovementIds([]);
    setProductDeleteBlockKey("");
    setExpandedProjectKeys([]);
    setMessage("");
  }

  function focusProductMovements({ selectAll = false } = {}) {
    if (selectAll) setSelectedMovementIds(selectedMovements.map((movement) => movement.id));
    window.setTimeout(() => {
      movementSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  async function createMainProductCard(product) {
    if (!product) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const normalizedProductCode = normalizeStockCode(product.product_code);
    const sharedMatch = matchProduct(productGroups.filter((item) => !item.is_virtual_project_main), product);
    if (sharedMatch.type === "conflict") {
      setMessage(`Ürün kodu mevcut kartla çakışıyor: ${productMatchLabel(sharedMatch)}. Yeni kart oluşturulmadı.`);
      return;
    }
    if (sharedMatch.type === "probable") {
      const useExisting = window.confirm(
        `Benzer ürün kartı bulundu: ${productMatchLabel(sharedMatch)} (%${Math.round((sharedMatch.match?.score || 0) * 100)}). Mevcut kartı kullanmak için Tamam'ı seçin.`,
      );
      if (useExisting && sharedMatch.match?.product) {
        openProductDetail(sharedMatch.match.product);
        setMessage("Mevcut ürün kartı açıldı; yeni kart oluşturulmadı.");
        return;
      }
    }
    let existing = productGroups.find((item) =>
      !item.is_virtual_project_main && (
        normalizedProductCode
          ? normalizeStockCode(item.product_code) === normalizedProductCode
          : productMatchesWithoutCode(item, product)
      )
    );

    if (!existing && normalizedProductCode) {
      const { data: existingByCode, error: existingByCodeError } = await supabase
        .from("products")
        .select("*")
        .eq("user_id", user.id)
        .eq("normalized_product_code", normalizedProductCode)
        .maybeSingle();

      if (existingByCodeError) {
        setMessage(existingByCodeError.message || "Ürün kodu kontrol edilemedi.");
        return;
      }

      existing = existingByCode || null;
      if (existing?.archived_at) {
        setShowArchivedProducts(true);
        setMessage("Bu ürün kodu arşivde bulunuyor. Yeni kart açmak yerine arşivden geri yükleyin.");
        return;
      }
    }

    if (existing) {
      setMessage("Bu ana ürün kartı stokta zaten var.");
      return;
    }

    const now = new Date().toISOString();
    const payload = {
      user_id: user.id,
      product_code: product.product_code || "",
      normalized_product_code: normalizedProductCode || null,
      product_name: product.product_name || "",
      brand: product.brand || "",
      unit: product.unit || "adet",
      category: product.category || "Ana Ürün",
      product_type: PRODUCT_TYPES.MAIN,
      current_stock: 0,
      reserved_stock: 0,
      min_stock: 0,
      critical_stock: 0,
      source: "Proje ana kalemi",
      notes: "Proje malzeme listesinden ana ürün kartı olarak oluşturuldu.",
      created_at: now,
      updated_at: now,
    };

    if (!payload.product_name) {
      setMessage("Ana ürün kartı oluşturmak için ürün açıklaması gerekli.");
      return;
    }

    let { error } = await supabase.from("products").insert(payload);

    if (error && String(error.message || "").includes("product_type")) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.product_type;
      const fallbackResult = await supabase.from("products").insert(fallbackPayload);
      error = fallbackResult.error;
    }

    if (error) {
      setMessage(error.message || "Ana ürün kartı oluşturulamadı.");
      return;
    }

    setSelectedProduct(null);
    setMessage("Ana ürün kartı genel stok kartlarına eklendi.");
    await loadStock();
  }

  function updateProductForm(field, value) {
    setProductForm((prev) => ({ ...prev, [field]: value }));
  }

  async function saveProductCard() {
    if (!selectedProduct) return;

    setSaving(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const productIds = selectedProduct.duplicateIds || [selectedProduct.id];
    const updatePayload = {
      brand: productForm.brand || "",
      min_stock: Number(productForm.min_stock || 0),
      critical_stock: Number(productForm.critical_stock || 0),
      manual_unit_price: Number(productForm.manual_unit_price || 0),
      notes: productForm.notes || "",
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("products")
      .update(updatePayload)
      .eq("user_id", user.id)
      .in("id", productIds);

    if (error) {
      console.error("Ürün kartı güncellenemedi:", error);
      setMessage(error.message || "Ürün kartı güncellenemedi.");
      setSaving(false);
      return;
    }

    const nextProducts = products.map((product) =>
      productIds.includes(product.id) ? { ...product, ...updatePayload } : product,
    );
    const nextGroups = mergeProductGroups(nextProducts);
    const nextSelected = nextGroups.find((product) => product.groupKey === selectedProduct.groupKey) || {
      ...selectedProduct,
      ...updatePayload,
    };

    setProducts(nextProducts);
    setSelectedProduct(nextSelected);
    setMessage("Ürün kartı güncellendi.");
    setSaving(false);
  }

  function closeStockImportModal() {
    setStockImportPreview(null);
    setStockImportResult(null);
  }

  function stockImportDecisionText(decision) {
    const labels = {
      exact: "Mevcut ürüne eklenecek",
      probable: "Benzer ürün bulundu",
      conflict: "Kontrol gerekli",
      new: "Yeni ürün açılacak",
    };
    return labels[decision] || "Kontrol edilecek";
  }

  function stockImportSummaryText(decision) {
    const labels = {
      exact: "Mevcut ürün",
      probable: "Benzer ürün",
      conflict: "Kontrol gerekli",
      new: "Yeni ürün",
    };
    return labels[decision] || decision;
  }

  function stockImportDecisionTone(decision) {
    if (decision === "exact") return "bg-emerald-50 text-emerald-800";
    if (decision === "new") return "bg-blue-50 text-blue-800";
    if (decision === "probable") return "bg-amber-50 text-amber-800";
    if (decision === "conflict") return "bg-red-50 text-red-800";
    return "bg-slate-100 text-slate-700";
  }

  function createStockImportPreview(analyses, importType, error = "", batchId = crypto.randomUUID()) {
    const parsedRows = analyses.flatMap((analysis) => analysis.parsedRows || []);
    const importIdentityCounts = parsedRows.reduce((counts, row) => {
      const code = normalizeStockCode(row.productCode);
      const key = code ? `code:${code}` : `name:${normalizeStockText(row.productName)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map());
    const activeProducts = productGroups.filter((product) => !product.archived_at);
    const rows = parsedRows.map((row) => {
      const code = normalizeStockCode(row.productCode);
      const name = normalizeStockText(row.productName);
      const identityKey = code ? `code:${code}` : `name:${name}`;
      const codeMatches = code ? activeProducts.filter((product) =>
        normalizeStockCode(product.normalized_product_code || product.product_code) === code) : [];
      const nameMatches = !code
        ? activeProducts.filter((product) => normalizeStockText(product.product_name) === name)
        : [];
      const matches = code ? codeMatches : nameMatches;
      const decision = importIdentityCounts.get(identityKey) > 1 || matches.length > 1
        ? "conflict"
        : matches.length === 1 ? (codeMatches.length ? "exact" : "probable") : "new";
      return {
        ...row,
        id: `${row.fileName}:${row.sheetName}:${row.rowNumber}:${identityKey}`,
        rowKey: `${row.fileName}:${row.sheetName}:${row.rowNumber}:${identityKey}`,
        decision,
        matchedProduct: matches[0] || null,
      };
    });
    const counts = rows.reduce(
      (summary, row) => ({ ...summary, [row.decision]: summary[row.decision] + 1 }),
      { exact: 0, probable: 0, conflict: 0, new: 0 },
    );
    const missingFields = [...new Set(analyses.flatMap((analysis) => analysis.missingFields || []))];
    return {
      importType,
      batchId,
      analyses,
      rows,
      counts,
      missingFields,
      expectedIncrease: importType === PRODUCT_TYPES.MAIN
        ? 0
        : rows.reduce((sum, row) => sum + Math.max(Number(row.quantity || 0), 0), 0),
      canApply: rows.length > 0 && missingFields.length === 0 && counts.conflict === 0 && !error,
      totalFileRows: analyses.reduce((sum, analysis) => sum + Math.max(0, analysis.rows.length - analysis.dataStartIndex), 0),
      fileDetails: analyses.map((analysis) => ({
        fileName: analysis.fileName,
        sheetName: analysis.sheetName,
        rowCount: Math.max(0, analysis.rows.length - analysis.dataStartIndex),
        parsedCount: analysis.parsedRows.length,
        confidence: analysis.overallConfidence,
      })),
      error,
    };
  }

  async function analyzeStockFileWithOcrFallback(file, options) {
    try {
      return await analyzeStockFile(file, options);
    } catch (analysisError) {
      if (!String(file.name || "").toLowerCase().endsWith(".pdf")) throw analysisError;
      if (!API_URL) throw new Error(`${file.name}: PDF OCR için NEXT_PUBLIC_API_URL tanımlı değil.`);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("PDF OCR için oturum gerekli.");
      const formData = new FormData();
      formData.append("file", file, file.name);
      const response = await fetch(`${API_URL}/order-documents/ocr`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `${file.name}: PDF OCR analizi başarısız.`);
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (!items.length) throw new Error(`${file.name}: OCR ürün satırı çıkaramadı; Excel yükleyin veya belgeyi kontrol edin.`);
      const matrix = [
        ["Ürün kodu", "Ürün açıklaması", "Marka", "Birim", "Miktar", "Birim fiyat"],
        ...items.map((item) => [
          item.product_code || item.code || "",
          item.product_name || item.description || item.name || "",
          item.brand || "",
          item.unit || "adet",
          item.quantity ?? item.qty ?? "",
          item.unit_price ?? item.price ?? "",
        ]),
      ];
      const sheetName = "PDF OCR";
      const analyzed = analyzeStockMatrix(matrix, {
        ...options,
        fileName: file.name,
        sheetName,
      });
      return {
        ...analyzed,
        matrix,
        fileName: file.name,
        sheetName,
        sourceType: "pdf-ocr",
        sheetCandidates: null,
        suitableSheetNames: analyzed.missingFields.length === 0 && analyzed.parsedRows.length > 0 ? [sheetName] : [],
      };
    }
  }

  async function importStockCardsFromFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const importType = stockImportType;
    const requiresQuantity = importType !== PRODUCT_TYPES.MAIN;
    setBulkImporting(true);
    setStockImportResult(null);
    try {
      const analyses = [];
      for (const file of files) analyses.push(await analyzeStockFileWithOcrFallback(file, { requiresQuantity }));
      const preview = createStockImportPreview(analyses, importType, "", crypto.randomUUID());
      setStockImportPreview(preview);
      setMessage(preview.rows.length ? `${preview.rows.length} ürün satırı analiz edildi.` : "Dosyada okunabilir ürün satırı bulunamadı.");
    } catch (error) {
      setStockImportPreview(createStockImportPreview([], importType, error.message || "Dosya analiz edilemedi."));
      setMessage(error.message || "Dosya analiz edilemedi.");
    } finally {
      setBulkImporting(false);
    }
  }

  function updateStockImportMapping(analysisIndex, field, columnValue) {
    setStockImportPreview((current) => {
      if (!current || stockImportResult) return current;
      const requiresQuantity = current.importType !== PRODUCT_TYPES.MAIN;
      const analyses = current.analyses.map((analysis, index) => {
        if (index !== analysisIndex) return analysis;
        const manualMapping = { ...(analysis.manualMapping || {}), [field]: columnValue === "" ? null : Number(columnValue) };
        const recalculated = analyzeStockMatrix(analysis.matrix, {
          requiresQuantity,
          fileName: analysis.fileName,
          sheetName: analysis.sheetName,
          headerRowIndex: analysis.headerRowIndex,
          mapping: manualMapping,
        });
        return { ...analysis, ...recalculated, matrix: analysis.matrix, manualMapping };
      });
      return createStockImportPreview(analyses, current.importType, "", current.batchId);
    });
  }

  function selectStockImportSheet(analysisIndex, sheetName) {
    setStockImportPreview((current) => {
      if (!current || stockImportResult) return current;
      const analyses = current.analyses.map((analysis, index) => {
        if (index !== analysisIndex) return analysis;
        const selected = analysis.sheetCandidates?.find((candidate) => candidate.sheetName === sheetName);
        if (!selected) return analysis;
        return {
          ...selected,
          fileName: analysis.fileName,
          sheetCandidates: analysis.sheetCandidates,
          suitableSheetNames: analysis.suitableSheetNames,
        };
      });
      return createStockImportPreview(analyses, current.importType, "", current.batchId);
    });
  }

  async function readTenantWarehouseStock(userId) {
    const rows = [];
    let page = 0;
    while (true) {
      const from = page * 1000;
      const { data, error } = await supabase
        .from("products")
        .select("id,current_stock,category")
        .eq("user_id", userId)
        .is("archived_at", null)
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
      page += 1;
    }
    return rows
      .filter((product) => productTypeOf(product) !== PRODUCT_TYPES.MAIN)
      .reduce((sum, product) => sum + Number(product.current_stock || 0), 0);
  }

  async function applyStockImportAnalysis() {
    const analysis = stockImportPreview;
    if (!analysis?.canApply || !analysis.rows.length || stockImportApplying) return;
    setStockImportApplying(true);
    const result = {
      processedRows: 0,
      updatedProducts: 0,
      createdProducts: 0,
      skippedRows: 0,
      errors: 0,
      rows: [],
      expectedIncrease: Number(analysis.expectedIncrease || 0),
      appliedIncrease: 0,
      warehouseStockBefore: null,
      warehouseStockAfter: null,
      warehouseDifference: null,
      hasHighRiskDifference: false,
    };
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.push("/login");
      const { count: beforeCount } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("user_id", user.id);
      if (analysis.importType !== PRODUCT_TYPES.MAIN) {
        result.warehouseStockBefore = await readTenantWarehouseStock(user.id);
      }

      for (const row of analysis.rows) {
        try {
          if (row.decision === "conflict") {
            result.skippedRows += 1;
            result.rows.push({ ...row, status: "skipped", reason: "Aynı kod/ad için birden fazla eşleşme var; güvenli şekilde uygulanmadı." });
            continue;
          }

          if (analysis.importType === PRODUCT_TYPES.MAIN) {
            if (row.matchedProduct) {
              result.processedRows += 1;
              result.rows.push({ ...row, status: "success", reason: "Mevcut ana ürün kartı kullanıldı.", productAction: "existing" });
              continue;
            }
            const normalizedCode = normalizeStockCode(row.productCode);
            const payload = {
              user_id: user.id,
              product_code: row.productCode,
              normalized_product_code: normalizedCode || null,
              product_name: row.productName,
              brand: row.brand,
              unit: row.unit,
              category: "Ana Ürün",
              product_type: PRODUCT_TYPES.MAIN,
              current_stock: 0,
              reserved_stock: 0,
              min_stock: 0,
              critical_stock: 0,
              source: "Toplu dosya aktarımı",
              notes: "Toplu ana ürün yükleme ile oluşturuldu.",
            };
            const createResult = await supabase.from("products").insert(payload).select("id").single();
            if (createResult.error) throw createResult.error;
            result.processedRows += 1;
            result.createdProducts += 1;
            result.rows.push({ ...row, status: "success", reason: "Yeni ana ürün kartı oluşturuldu.", productAction: "new" });
            continue;
          }

          const applyResult = await supabase.rpc("apply_stock_increment_import", {
            p_product_id: row.matchedProduct?.id || null,
            p_product_code: row.productCode || "",
            p_product_name: row.productName,
            p_quantity: Number(row.quantity || 0),
            p_unit: row.unit || "adet",
            p_brand: row.brand || "",
            p_batch_id: analysis.batchId,
            p_row_key: row.rowKey,
            p_source_file: `${row.fileName} / ${row.sheetName}`,
            p_product_type: analysis.importType,
          });
          if (applyResult.error) throw applyResult.error;

          const rpcResult = applyResult.data || {};
          if (rpcResult.already_applied) {
            result.skippedRows += 1;
            result.rows.push({ ...row, status: "skipped", reason: "Bu önizlemenin aynı satırı daha önce uygulanmış; ikinci kez eklenmedi.", rpcResult });
            continue;
          }

          result.processedRows += 1;
          result.appliedIncrease += Number(rpcResult.applied_quantity || 0);
          if (rpcResult.created) result.createdProducts += 1;
          else result.updatedProducts += 1;
          result.rows.push({
            ...row,
            status: "success",
            reason: rpcResult.created ? "Yeni kart açıldı ve stok eklendi." : "Mevcut karta stok eklendi.",
            productAction: rpcResult.created ? "new" : "existing",
            rpcResult,
          });
        } catch (rowError) {
          console.error("Stok import satırı uygulanamadı:", rowError);
          result.errors += 1;
          result.rows.push({ ...row, status: "failed", reason: rowError?.message || "Satır uygulanamadı." });
        }
      }

      const { count: afterCount } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("user_id", user.id);
      result.productCountBefore = beforeCount ?? 0;
      result.productCountAfter = afterCount ?? result.productCountBefore;
      if (analysis.importType !== PRODUCT_TYPES.MAIN) {
        result.warehouseStockAfter = await readTenantWarehouseStock(user.id);
        result.warehouseDifference = Number(result.warehouseStockAfter || 0) - Number(result.warehouseStockBefore || 0);
        result.hasHighRiskDifference = result.errors > 0
          || result.skippedRows > 0
          || Math.abs(result.expectedIncrease - result.appliedIncrease) > 0.0001
          || Math.abs(result.appliedIncrease - result.warehouseDifference) > 0.0001;
      }
      setStockImportResult(result);
      setMessage(
        result.hasHighRiskDifference
          ? `HIGH RISK: ${result.expectedIncrease} adet beklenirken ${result.appliedIncrease} adet eklendi. ${result.errors + result.skippedRows} satır uygulanmadı.`
          : `${result.processedRows} satır işlendi; depo stokuna toplam ${result.appliedIncrease} adet eklendi.`,
      );
      await loadStock();
    } catch (error) {
      console.error("Toplu ürün yükleme hatası:", error);
      result.errors += 1;
      result.hasHighRiskDifference = true;
      result.rows.push({ status: "failed", rowNumber: "-", productCode: "-", productName: "Toplu işlem", reason: error?.message || "Toplu işlem tamamlanamadı." });
      setStockImportResult(result);
      setMessage(`HIGH RISK: Toplu stok girişi tamamlanamadı. ${error?.message || "Bilinmeyen hata"}`);
    } finally {
      setStockImportApplying(false);
    }
  }

  function stockImportResultReportRows() {
    return (stockImportResult?.rows || []).map((row) => ({
      "Dosya satırı": row.rowNumber || "-",
      Dosya: row.fileName || "-",
      "Ürün kodu": row.productCode || "-",
      "Ürün adı": row.productName || "-",
      Miktar: Number(row.quantity || 0),
      Birim: row.unit || "adet",
      Durum: row.status === "success" ? "İşlendi" : row.status === "skipped" ? "Atlandı" : "Başarısız",
      "Kart işlemi": row.productAction === "new" ? "Yeni kart" : row.productAction === "existing" ? "Mevcut kart" : "Uygulanmadı",
      "Eski stok": row.rpcResult?.old_stock ?? "-",
      "Yeni stok": row.rpcResult?.new_stock ?? "-",
      Açıklama: row.reason || "-",
    }));
  }

  async function exportStockImportResultExcel() {
    if (!stockImportResult) return;
    const { companyName } = await fetchCompanyBranding(supabase);
    await downloadExcelWorkbook(`stok-giris-mutabakat-${exportDateStamp()}`, [
      {
        name: "Mutabakat",
        rows: [
          { Metrik: "Beklenen stok artışı", Değer: stockImportResult.expectedIncrease },
          { Metrik: "Uygulanan stok artışı", Değer: stockImportResult.appliedIncrease },
          { Metrik: "Depo stoku - önce", Değer: stockImportResult.warehouseStockBefore ?? "-" },
          { Metrik: "Depo stoku - sonra", Değer: stockImportResult.warehouseStockAfter ?? "-" },
          { Metrik: "Gerçek depo artışı", Değer: stockImportResult.warehouseDifference ?? "-" },
          { Metrik: "İşlenen satır", Değer: stockImportResult.processedRows },
          { Metrik: "Atlanan satır", Değer: stockImportResult.skippedRows },
          { Metrik: "Hata", Değer: stockImportResult.errors },
          { Metrik: "Risk", Değer: stockImportResult.hasHighRiskDifference ? "HIGH - Mutabakat sağlanmadı" : "Mutabık" },
        ],
      },
      { name: "Satır Sonuçları", rows: stockImportResultReportRows() },
    ], companyName);
  }

  async function exportStockImportResultPdf() {
    if (!stockImportResult) return;
    const { companyName } = await fetchCompanyBranding(supabase);
    await downloadPdfTable(
      `stok-giris-mutabakat-${exportDateStamp()}`,
      `Stok Giris Mutabakati - Beklenen ${stockImportResult.expectedIncrease}, Eklenen ${stockImportResult.appliedIncrease}, Depo ${stockImportResult.warehouseStockBefore ?? "?"} -> ${stockImportResult.warehouseStockAfter ?? "?"}`,
      stockImportResultReportRows().map((row) => ({
        Satır: row["Dosya satırı"],
        "Ürün kodu": row["Ürün kodu"],
        "Ürün adı": row["Ürün adı"],
        Miktar: row.Miktar,
        Durum: row.Durum,
        Açıklama: row.Açıklama,
      })),
      companyName,
    );
  }

  const productGroups = useMemo(() => {
    if (showArchivedProducts) return mergeProductGroups(products);
    const projectMainProducts = projectMainItemsAsProducts(projectItems, products);
    return mergeProductGroups([...products, ...projectMainProducts]);
  }, [products, projectItems, showArchivedProducts]);
  const productTypeCounts = useMemo(() => ({
    main: productGroups.filter(isMainProduct).length,
    component: productGroups.filter((product) => !isMainProduct(product)).length,
  }), [productGroups]);

  const filteredProducts = useMemo(() => {
    const needle = normalizeStockText(search);
    const productsByType = productGroups
      .filter((product) => productTypeOf(product) === activeProductType)
      .filter((product) => {
        if (activeProductType === PRODUCT_TYPES.MAIN) return true;

        const breakdown = stockBreakdown(product, movements);
        const criticalLimit = stockCriticalLimit(product);

        if (stockViewFilter === STOCK_VIEW_FILTERS.DEPOT) return breakdown.total > 0;
        if (stockViewFilter === STOCK_VIEW_FILTERS.AVAILABLE) return breakdown.available > 0;
        if (stockViewFilter === STOCK_VIEW_FILTERS.RESERVED) return breakdown.reserved > 0;
        if (stockViewFilter === STOCK_VIEW_FILTERS.PRODUCTION) return breakdown.production > 0;
        if (stockViewFilter === STOCK_VIEW_FILTERS.LOW) return criticalLimit > 0 && breakdown.available <= criticalLimit;
        return true;
      });
    if (!needle) return productsByType;

    return productsByType.filter((product) =>
      normalizeStockText([
        product.product_code,
        product.product_name,
        product.last_supplier,
        product.partner_name,
        product.category,
      ].join(" ")).includes(needle),
    );
  }, [productGroups, movements, search, activeProductType, stockViewFilter]);

  const [productPage, setProductPage] = useState(1);
  const productsPerPage = 25;

  const pagedProducts = useMemo(() => {
    const start = (productPage - 1) * productsPerPage;
    return filteredProducts.slice(start, start + productsPerPage);
  }, [filteredProducts, productPage]);

  const totalProductPages = Math.max(1, Math.ceil(filteredProducts.length / productsPerPage));

  const selectedMovements = useMemo(() => {
    if (!selectedProduct) return [];
    return movements.filter((movement) => movementMatchesProduct(movement, selectedProduct));
  }, [movements, selectedProduct]);

  const selectedLinkedProjectItems = useMemo(() => {
    if (!selectedProduct) return [];
    return projectItems.filter((item) => projectItemMatchesProduct(item, selectedProduct));
  }, [projectItems, selectedProduct]);

  const selectedProductDeleteBlocked = Boolean(
    selectedProduct && productDeleteBlockKey === selectedProduct.groupKey,
  );

  const selectedProjectAllocation = useMemo(() => {
    return productProjectAllocations(selectedProduct, projectItems, projects, movements);
  }, [selectedProduct, projectItems, projects, movements]);

  const visibleMovementRows = selectedProduct ? selectedMovements : movements;
  const visibleMovementIds = visibleMovementRows.map((movement) => movement.id);
  const selectedVisibleMovements = visibleMovementRows.filter((movement) =>
    selectedMovementIds.includes(movement.id),
  );
  const allFilteredProductsSelected = filteredProducts.length > 0 && filteredProducts.every((product) => selectedProductKeys.includes(product.groupKey));
  const allVisibleMovementsSelected = visibleMovementIds.length > 0 && visibleMovementIds.every((id) => selectedMovementIds.includes(id));

  function toggleProductSelection(groupKey) {
    setSelectedProductKeys((current) =>
      current.includes(groupKey) ? current.filter((key) => key !== groupKey) : [...current, groupKey],
    );
  }

  function toggleMovementSelection(id) {
    setSelectedMovementIds((current) =>
      current.includes(id) ? current.filter((movementId) => movementId !== id) : [...current, id],
    );
  }

  function toggleProjectAllocation(key) {
    setExpandedProjectKeys((current) =>
      current.includes(key) ? current.filter((projectKey) => projectKey !== key) : [...current, key],
    );
  }

  async function exportProductsExcel() {
    const { companyName } = await fetchCompanyBranding(supabase);
    const productRows = buildProductExportRows(filteredProducts, movements, projectItems, projects);
    const movementRows = buildMovementExportRows(movements, projects);
    await downloadExcelWorkbook(`stok-kartlari-${exportDateStamp()}`, [
      { name: "Stok Kartlari", rows: productRows },
      { name: "Stok Hareketleri", rows: movementRows },
    ], companyName);
  }

  async function exportProductsPdf() {
    const { companyName } = await fetchCompanyBranding(supabase);
    const productRows = buildProductExportRows(filteredProducts, movements, projectItems, projects);
    await downloadPdfTable(`stok-kartlari-${exportDateStamp()}`, "Stok Kartlari ve Depo Sayim Listesi", productRows, companyName);
  }

  async function exportMovementsExcel() {
    const { companyName } = await fetchCompanyBranding(supabase);
    const movementRows = buildMovementExportRows(visibleMovementRows, projects, selectedProduct);
    await downloadExcelWorkbook(`stok-hareketleri-${exportDateStamp()}`, [
      { name: "Hareketler", rows: movementRows },
    ], companyName);
  }

  async function exportMovementsPdf() {
    const { companyName } = await fetchCompanyBranding(supabase);
    const movementRows = buildMovementExportRows(visibleMovementRows, projects, selectedProduct);
    const title = selectedProduct ? `${selectedProduct.product_name} - Stok Hareketleri` : "Stok Hareketleri";
    await downloadPdfTable(`stok-hareketleri-${exportDateStamp()}`, title, movementRows, companyName);
  }

  async function exportSelectedProductUsageExcel() {
    if (!selectedProduct) return;
    const { companyName } = await fetchCompanyBranding(supabase);
    const usageRows = buildProductUsageExportRows(selectedProduct, selectedProjectAllocation);
    const movementRows = buildMovementExportRows(selectedMovements, projects, selectedProduct);
    await downloadExcelWorkbook(`${selectedProduct.product_code || selectedProduct.product_name}-kullanim-${exportDateStamp()}`, [
      { name: "Proje Kullanim", rows: usageRows },
      { name: "Hareketler", rows: movementRows },
    ], companyName);
  }

  async function exportSelectedProductUsagePdf() {
    if (!selectedProduct) return;
    const { companyName } = await fetchCompanyBranding(supabase);
    const usageRows = buildProductUsageExportRows(selectedProduct, selectedProjectAllocation);
    await downloadPdfTable(
      `${selectedProduct.product_code || selectedProduct.product_name}-proje-kullanim-${exportDateStamp()}`,
      `${selectedProduct.product_name} - Proje Bazli Kullanim`,
      usageRows,
      companyName,
    );
  }

  const componentProductGroups = productGroups.filter((product) => !isMainProduct(product));
  const stockTotals = componentProductGroups.reduce(
    (totals, product) => {
      const breakdown = stockBreakdown(product, movements);
      return {
        total: totals.total + breakdown.total,
        available: totals.available + breakdown.available,
        reserved: totals.reserved + breakdown.reserved,
        production: totals.production + breakdown.production,
        montage: totals.montage + breakdown.montage,
        shipped: totals.shipped + breakdown.shipped,
      };
    },
    { total: 0, available: 0, reserved: 0, production: 0, montage: 0, shipped: 0 },
  );
  const lowStockCount = componentProductGroups.filter(
    (product) => {
      const criticalLimit = stockCriticalLimit(product);
      return criticalLimit > 0 && stockBreakdown(product, movements).available <= criticalLimit;
    },
  ).length;

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="p-6">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-700">
                Stok Yönetimi
              </div>
              <h1 className="mt-3 text-4xl font-bold text-slate-900">Ürün ve Stok Takibi</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Talep ve teklif dosyalarından oluşan ürün kartlarını, sipariş teslimatlarından gelen stok girişlerini takip edin.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm font-black">
                <button
                  type="button"
                  onClick={() => setStockImportType(PRODUCT_TYPES.COMPONENT)}
                  className={`rounded-lg px-3 py-2 ${stockImportType === PRODUCT_TYPES.COMPONENT ? "bg-emerald-100 text-emerald-700" : "text-slate-600"}`}
                >
                  Alt Ürün Excel
                </button>
                <button
                  type="button"
                  onClick={() => setStockImportType(PRODUCT_TYPES.MAIN)}
                  className={`rounded-lg px-3 py-2 ${stockImportType === PRODUCT_TYPES.MAIN ? "bg-blue-100 text-blue-700" : "text-slate-600"}`}
                >
                  Ana Ürün Excel
                </button>
              </div>
              <button
                type="button"
                onClick={exportProductsExcel}
                className="rounded-xl border border-emerald-200 bg-white px-5 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
              >
                Stok Excel
              </button>
              <button
                type="button"
                onClick={exportProductsPdf}
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Stok PDF
              </button>
              <label className={`cursor-pointer rounded-xl px-5 py-3 text-sm font-bold text-white ${bulkImporting ? "bg-slate-300" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                {bulkImporting ? "Dosya okunuyor..." : "Toplu Ürün Yükle"}
                <input
                  type="file"
                  multiple
                  accept={STOCK_IMPORT_ACCEPT}
                  disabled={bulkImporting}
                  onChange={importStockCardsFromFiles}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={loadStock}
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
              >
                Yenile
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <StatCard
              title="Ürün Kartı"
              value={productGroups.length}
              text="Tekilleştirilmiş kart"
              active={stockViewFilter === STOCK_VIEW_FILTERS.ALL}
              onClick={() => {
                setStockViewFilter(STOCK_VIEW_FILTERS.ALL);
                setSelectedProduct(null);
              }}
            />
            <StatCard
              title="Toplam Depo Stoku"
              value={stockTotals.total}
              text="Fiilen depoda duran"
              active={stockViewFilter === STOCK_VIEW_FILTERS.DEPOT}
              onClick={() => {
                setActiveProductType(PRODUCT_TYPES.COMPONENT);
                setStockViewFilter(STOCK_VIEW_FILTERS.DEPOT);
                setSelectedProduct(null);
              }}
            />
            <StatCard
              title="Projeye Ayrılan"
              value={stockTotals.reserved}
              text="Rezerve malzeme"
              active={stockViewFilter === STOCK_VIEW_FILTERS.RESERVED}
              onClick={() => {
                setActiveProductType(PRODUCT_TYPES.COMPONENT);
                setStockViewFilter(STOCK_VIEW_FILTERS.RESERVED);
                setSelectedProduct(null);
              }}
            />
            <StatCard
              title="Üretimde"
              value={stockTotals.production}
              text="Depodan çıkmış, süreçte"
              active={stockViewFilter === STOCK_VIEW_FILTERS.PRODUCTION}
              onClick={() => {
                setActiveProductType(PRODUCT_TYPES.COMPONENT);
                setStockViewFilter(STOCK_VIEW_FILTERS.PRODUCTION);
                setSelectedProduct(null);
              }}
            />
            <StatCard
              title="Kullanılabilir"
              value={stockTotals.available}
              text="Yeni projeye ayrılabilir"
              active={stockViewFilter === STOCK_VIEW_FILTERS.AVAILABLE}
              onClick={() => {
                setActiveProductType(PRODUCT_TYPES.COMPONENT);
                setStockViewFilter(STOCK_VIEW_FILTERS.AVAILABLE);
                setSelectedProduct(null);
              }}
            />
            <StatCard
              title="Düşük Stok"
              value={lowStockCount}
              text="Kullanılabilir limit altında"
              active={stockViewFilter === STOCK_VIEW_FILTERS.LOW}
              onClick={() => {
                setActiveProductType(PRODUCT_TYPES.COMPONENT);
                setStockViewFilter(STOCK_VIEW_FILTERS.LOW);
                setSelectedProduct(null);
              }}
            />
          </div>

          {message && (
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
              {message}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setActiveProductType(PRODUCT_TYPES.MAIN);
                  setStockViewFilter(STOCK_VIEW_FILTERS.ALL);
                  setProductPage(1);
                  setSelectedProduct(null);
                }}
                className={`rounded-xl px-5 py-4 text-left transition ${
                  activeProductType === PRODUCT_TYPES.MAIN
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-slate-50 text-slate-700 hover:bg-blue-50"
                }`}
              >
                <div className="text-sm font-black">Ana Ürünler</div>
                <div className="mt-1 text-xs font-semibold opacity-80">Nihai ürün, proje ve sevk takibi</div>
                <div className="mt-2 text-2xl font-black">{productTypeCounts.main}</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveProductType(PRODUCT_TYPES.COMPONENT);
                  setStockViewFilter(STOCK_VIEW_FILTERS.ALL);
                  setProductPage(1);
                  setSelectedProduct(null);
                }}
                className={`rounded-xl px-5 py-4 text-left transition ${
                  activeProductType === PRODUCT_TYPES.COMPONENT
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-slate-50 text-slate-700 hover:bg-emerald-50"
                }`}
              >
                <div className="text-sm font-black">Alt Ürünler / Malzemeler</div>
                <div className="mt-1 text-xs font-semibold opacity-80">Gerçek stok, rezervasyon ve satınalma takibi</div>
                <div className="mt-2 text-2xl font-black">{productTypeCounts.component}</div>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <input
              placeholder="Ürün, kod, kategori veya iş ortağı ara..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-xl border border-slate-300 p-3 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-6">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{showArchivedProducts ? "Arşivlenen Ürünler" : "Ürün Kartları"}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {loading ? "Yükleniyor..." : `${filteredProducts.length} ürün gösteriliyor.`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowArchivedProducts(false); setSelectedProduct(null); setSelectedProductKeys([]); }}
                      className={`rounded-xl px-4 py-2 text-sm font-black ${!showArchivedProducts ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                    >
                      Aktif Ürünler
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowArchivedProducts(true); setSelectedProduct(null); setSelectedProductKeys([]); }}
                      className={`rounded-xl px-4 py-2 text-sm font-black ${showArchivedProducts ? "bg-slate-800 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                    >
                      Arşiv
                    </button>
                  </div>
                  {!showArchivedProducts && <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedProductKeys(allFilteredProductsSelected ? [] : filteredProducts.map((product) => product.groupKey))}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                      {allFilteredProductsSelected ? "Seçimi Temizle" : "Tümünü Seç"}
                    </button>
                    <button
                      type="button"
                      disabled={selectedProductKeys.length === 0 || bulkDeletingProducts || analyzingProductDeletion}
                      onClick={analyzeSelectedProductsForDeletion}
                      className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-700 disabled:bg-slate-300"
                    >
                      {analyzingProductDeletion ? "Analiz ediliyor..." : `Seçilenleri Sil (${selectedProductKeys.length})`}
                    </button>
                  </div>}
                </div>
              </div>
              <div className="space-y-3 p-4">
                {pagedProducts.map((product) => {
                  const breakdown = stockBreakdown(product, movements);
                  const allocation = productProjectAllocations(product, projectItems, projects, movements);
                  const mainStats = mainProductProjectStats(product, projectItems, movements);
                  const mainProduct = isMainProduct(product);
                  return (
                    <div
                      key={product.groupKey}
                      className={`w-full rounded-2xl border p-4 text-left transition hover:border-blue-200 hover:bg-blue-50 ${
                        selectedProduct?.groupKey === product.groupKey
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex min-w-0 items-start gap-3">
                          {!showArchivedProducts && <div className="pt-1">
                            <input
                              type="checkbox"
                              checked={selectedProductKeys.includes(product.groupKey)}
                              onChange={() => toggleProductSelection(product.groupKey)}
                              className="h-4 w-4 rounded border-slate-300"
                              aria-label={`${product.product_name} seç`}
                            />
                          </div>}
                          <div className="min-w-0 flex-1">
                            <h3
                              className="block w-full whitespace-normal break-words text-left text-base font-black leading-6 text-slate-950"
                              title={product.product_name || ""}
                            >
                              {product.product_name}
                            </h3>
                            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-500">
                              <span className="max-w-full break-all rounded-full bg-slate-100 px-2.5 py-1 text-slate-700" title={product.product_code || "-"}>
                                Kod: {product.product_code || "-"}
                              </span>
                              <span className="max-w-full break-words rounded-full bg-slate-100 px-2.5 py-1" title={product.brand || "-"}>
                                Marka: {product.brand || "-"}
                              </span>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                                Birim: {product.unit || "adet"}
                              </span>
                            </div>
                            <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${
                              mainProduct ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
                            }`}>
                              {mainProduct ? "Ana Ürün" : "Alt Ürün / Malzeme"}
                            </div>
                            {product.duplicateCount > 1 && (
                              <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                                {product.duplicateCount} kayıt birleşti. Aynı kod/açıklama için yeni kart açılmadı.
                              </div>
                            )}
                            {showArchivedProducts && (
                              <div className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                                <div className="font-black">Arşiv tarihi: {formatDate(product.archived_at)}</div>
                                <div className="mt-1">{product.archived_reason || "Arşiv nedeni belirtilmedi."}</div>
                              </div>
                            )}
                          </div>
                        </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {product.is_virtual_project_main && (
                                <button
                                  type="button"
                                  onClick={() => createMainProductCard(product)}
                                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700"
                                >
                                  Ana ürün kartı oluştur
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openProductDetail(product)}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                              >
                                Ürün detayını gör
                              </button>
                              {showArchivedProducts && (
                                <button
                                  type="button"
                                  onClick={() => restoreArchivedProduct(product)}
                                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700"
                                >
                                  Aktife Geri Yükle
                                </button>
                              )}
                            </div>
                        <div className="grid min-w-0 grid-cols-4 gap-2 text-xs">
                          <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
                            <div className="truncate font-bold text-slate-500">{mainProduct ? "Proje sayısı" : "Stok"}</div>
                            <div className="mt-1 truncate text-sm font-black text-slate-900">{mainProduct ? mainStats.projectCount : breakdown.total}</div>
                          </div>
                          <div className="min-w-0 rounded-xl bg-blue-50 px-3 py-2">
                            <div className="truncate font-bold text-blue-700">{mainProduct ? "İşlenen" : "Ayrılan"}</div>
                            <div className="mt-1 truncate text-sm font-black text-blue-900">{mainProduct ? mainStats.inProcess : allocation.allocatedTotal}</div>
                          </div>
                          <div className="min-w-0 rounded-xl bg-emerald-50 px-3 py-2">
                            <div className="truncate font-bold text-emerald-700">{mainProduct ? "Sevk" : "Boşta"}</div>
                            <div className="mt-1 truncate text-sm font-black text-emerald-900">{mainProduct ? mainStats.shipped : allocation.freeStock}</div>
                          </div>
                          <div className="min-w-0 rounded-xl bg-red-50 px-3 py-2">
                            <div className="truncate font-bold text-red-700">{mainProduct ? "Kalan sevk" : "Eksik"}</div>
                            <div className="mt-1 truncate text-sm font-black text-red-900">{mainProduct ? mainStats.remainingShipment : allocation.missingTotal}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between border-t border-slate-100 p-4 text-sm">
                  <button
                    type="button"
                    disabled={productPage === 1}
                    onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                    className="rounded-lg border px-3 py-2 font-bold disabled:opacity-40"
                >
                Önceki
                </button>

                <span className="font-bold text-slate-600">
                  Sayfa {productPage} / {totalProductPages}
                </span>

                <button
                  type="button"
                  disabled={productPage === totalProductPages}
                  onClick={() => setProductPage((page) => Math.min(totalProductPages, page + 1))}
                  className="rounded-lg border px-3 py-2 font-bold disabled:opacity-40"
              >
                Sonraki
              </button>
            </div>
                {!loading && filteredProducts.length === 0 && (
                  <div className="rounded-xl bg-slate-50 p-8 text-center text-slate-500">
                    Henüz ürün kartı yok.
                  </div>
                )}
              </div>
            </div>

            {productDeleteModalOpen && (
              <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4">
                <button
                  type="button"
                  aria-label="Toplu ürün silme penceresini kapat"
                  onClick={() => !bulkDeletingProducts && setProductDeleteModalOpen(false)}
                  className="absolute inset-0 cursor-default"
                />
                <section
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="product-delete-title"
                  className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-7"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="inline-flex rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-700">
                        Bu işlem geri alınamaz.
                      </div>
                      <h2 id="product-delete-title" className="mt-3 text-2xl font-black text-slate-950">
                        Ürünleri Sil
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        Seçilen ürünler ve bu ürünlere ait stok kayıtları kalıcı olarak silinecektir.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={bulkDeletingProducts}
                      onClick={() => setProductDeleteModalOpen(false)}
                      className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-40"
                    >
                      Kapat
                    </button>
                  </div>

                  {analyzingProductDeletion && (
                    <div className="mt-6 rounded-2xl bg-blue-50 p-6 text-center text-sm font-black text-blue-800">
                      Silme işlemi hazırlanıyor...
                    </div>
                  )}

                  {productDeleteAnalysis && !productDeleteResult && (
                    <>
                      <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-black text-red-900">
                        Bu işlem geri alınamaz.
                      </div>

                      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          disabled={bulkDeletingProducts}
                          onClick={() => setProductDeleteModalOpen(false)}
                          className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700 disabled:opacity-40"
                        >
                          Vazgeç
                        </button>
                        <button
                          type="button"
                          disabled={bulkDeletingProducts || (productDeleteAnalysis.productIds || []).length === 0}
                          onClick={executeAnalyzedProductDeletion}
                          className="rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-700 disabled:bg-slate-300"
                        >
                          {bulkDeletingProducts ? "Siliniyor..." : "Sil"}
                        </button>
                      </div>
                    </>
                  )}

                  {productDeleteResult && (
                    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-emerald-50 p-5 text-emerald-900">
                        <div className="text-xs font-black uppercase">Silinen ürün</div>
                        <div className="mt-2 text-3xl font-black">{productDeleteResult.deletedProductCount}</div>
                      </div>
                      <div className="rounded-2xl bg-amber-50 p-5 text-amber-900">
                        <div className="text-xs font-black uppercase">Silinemeyen ürün</div>
                        <div className="mt-2 text-3xl font-black">{productDeleteResult.failedProductCount}</div>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}

            {movementDeleteModalOpen && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
                <button
                  type="button"
                  aria-label="Silme onayını kapat"
                  onClick={() => setMovementDeleteModalOpen(false)}
                  className="absolute inset-0 cursor-default"
                />
                <section
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="movement-delete-title"
                  className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 text-2xl">
                    ⚠️
                  </div>
                  <h2 id="movement-delete-title" className="mt-4 text-xl font-black text-slate-950">
                    Stok hareketlerini sil
                  </h2>
                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                    {selectedVisibleMovements.length} stok hareketi silinecek. Bu işlem geri alınamaz.
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    İlgili ürün ve proje stok toplamları işlem sonrasında güncellenecek.
                  </p>
                  <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setMovementDeleteModalOpen(false)}
                      className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      onClick={deleteSelectedMovements}
                      className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white hover:bg-red-700"
                    >
                      Seçilenleri Sil
                    </button>
                  </div>
                </section>
              </div>
            )}

            {selectedProduct && (
              <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/35">
                <button
                  type="button"
                  aria-label="Ürün detay panelini kapat"
                  onClick={() => setSelectedProduct(null)}
                  className="absolute inset-0 cursor-default"
                />
                <aside className="relative z-10 h-full w-full max-w-5xl overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl">
              {(
                <>
                  {(() => {
                    const breakdown = stockBreakdown(selectedProduct, movements);
                    const allocation = selectedProjectAllocation;
                    const selectedMainProduct = isMainProduct(selectedProduct);
                    const selectedMainStats = mainProductProjectStats(selectedProduct, projectItems, movements);
                    return (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-xs font-black uppercase tracking-wide text-blue-600">Ürün kartı detayı</div>
                            <h2 className="mt-1 whitespace-normal break-words text-xl font-bold text-slate-900">{selectedProduct.product_name}</h2>
                            <p className="mt-1 break-all text-sm text-slate-500">{selectedProduct.product_code || "-"} · {selectedProduct.unit || "adet"}</p>
                          </div>
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={exportSelectedProductUsageExcel}
                              className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-50"
                            >
                              Kullanım Excel
                            </button>
                            <button
                              type="button"
                              onClick={exportSelectedProductUsagePdf}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                            >
                              Kullanım PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedProduct(null)}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                            >
                              Kapat
                            </button>
                            {showArchivedProducts ? (
                              <button
                                type="button"
                                onClick={() => restoreArchivedProduct(selectedProduct)}
                                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                              >
                                Aktife Geri Yükle
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={deleting}
                                onClick={() => deleteProductGroup(selectedProduct)}
                                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:bg-slate-300"
                              >
                                Sil
                              </button>
                            )}
                          </div>
                        </div>

                        <section className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">Bağlı kayıtlar</h3>
                              <p className="mt-1 text-xs leading-5 text-slate-600">
                                Ürün silinirken ilgili stok kayıtları da temizlenir. Kritik proje, sipariş veya teklif bağlantıları varsa ürün korunur.
                              </p>
                            </div>
                            {selectedMovements.length > 0 && (
                              <button
                                type="button"
                                onClick={() => focusProductMovements()}
                                className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700"
                              >
                                Stok hareketlerini görüntüle
                              </button>
                            )}
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                              <div className="text-xs font-black uppercase text-blue-700">
                                Stok hareketi
                              </div>
                              <div className="mt-1 text-2xl font-black text-blue-950">
                                {selectedMovements.length}
                              </div>
                              <div className="mt-1 text-xs font-semibold text-slate-600">
                                Ürünle birlikte temizlenir
                              </div>
                            </div>
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                              <div className="text-xs font-black uppercase text-amber-700">Proje kalemi</div>
                              <div className="mt-1 text-2xl font-black text-amber-950">{selectedLinkedProjectItems.length}</div>
                              <div className="mt-1 text-xs font-semibold text-slate-600">Kritik bağlantı varsa ürün korunur</div>
                            </div>
                          </div>
                          <p className="mt-3 text-xs leading-5 text-slate-500">
                            Sipariş, talep ve teklif bağlantıları silme sırasında kontrol edilir.
                          </p>
                        </section>

                        {!showArchivedProducts && selectedProductDeleteBlocked && selectedMovements.length > 0 && (
                          <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
                            <div className="text-sm font-black text-red-950">Ürün kartı henüz silinemez</div>
                            <p className="mt-1 text-sm leading-6 text-red-800">
                              Bu ürün kritik bağlantı nedeniyle korunuyor olabilir. Bağlantıları kontrol edip tekrar deneyin.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => focusProductMovements()}
                                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white hover:bg-red-700"
                              >
                                Stok hareketlerini görüntüle
                              </button>
                              <button
                                type="button"
                                onClick={() => focusProductMovements({ selectAll: true })}
                                className="rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-black text-red-700 hover:bg-red-100"
                              >
                                Tüm ilgili hareketleri seç
                              </button>
                            </div>
                          </div>
                        )}

                        {!showArchivedProducts && selectedProductDeleteBlocked && selectedMovements.length === 0 && (
                          <div role="status" className="mt-4 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="text-sm font-black text-emerald-950">Ürün tekrar kontrol edilebilir</div>
                              <p className="mt-1 text-sm text-emerald-800">Ürün kartını silme işlemini şimdi tekrar deneyebilirsiniz.</p>
                            </div>
                            <button
                              type="button"
                              disabled={deleting}
                              onClick={() => deleteProductGroup(selectedProduct)}
                              className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white hover:bg-red-700 disabled:bg-slate-300"
                            >
                              Ürün kartını tekrar sil
                            </button>
                          </div>
                        )}

                        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                          <div className="rounded-xl bg-slate-50 p-4">
                            <div className="text-xs font-bold text-slate-500">{selectedMainProduct ? "Kullanıldığı Proje" : "Mevcut Stok"}</div>
                            <div className="mt-1 text-xl font-black text-slate-900">
                              {selectedMainProduct ? `${selectedMainStats.projectCount} proje` : `${breakdown.total} ${selectedProduct.unit || "adet"}`}
                            </div>
                          </div>
                          <div className="rounded-xl bg-blue-50 p-4">
                            <div className="text-xs font-bold text-blue-700">{selectedMainProduct ? "Üretimde / İşlenen" : "Projeye Ayrılan"}</div>
                            <div className="mt-1 text-xl font-black text-blue-900">{selectedMainProduct ? selectedMainStats.inProcess : allocation.allocatedTotal}</div>
                          </div>
                          <div className="rounded-xl bg-emerald-50 p-4">
                            <div className="text-xs font-bold text-emerald-700">{selectedMainProduct ? "Sevk Edilen" : "Boşta Kullanılabilir"}</div>
                            <div className="mt-1 text-xl font-black text-emerald-900">{selectedMainProduct ? selectedMainStats.shipped : allocation.freeStock}</div>
                          </div>
                          <div className="rounded-xl bg-red-50 p-4">
                            <div className="text-xs font-bold text-red-700">{selectedMainProduct ? "Kalan Sevk" : "Alınması Gereken"}</div>
                            <div className="mt-1 text-xl font-black text-red-900">{selectedMainProduct ? selectedMainStats.remainingShipment : allocation.missingTotal}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-4">
                            <div className="text-xs font-bold text-slate-500">Siparişlerden Gelen Son Fiyat</div>
                            <div className="mt-1"><MoneyValue value={selectedProduct.last_unit_price} currency={selectedProduct.last_currency || "TRY"} /></div>
                            <div className="mt-1 text-xs text-slate-500">{formatDate(selectedProduct.last_purchase_date || selectedProduct.last_movement_at)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-4">
                            <div className="text-xs font-bold text-slate-500">Son İş Ortağı</div>
                            <div className="mt-1 text-lg font-black text-slate-900">{selectedProduct.last_supplier || "-"}</div>
                          </div>
                        </div>

                        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">Proje Bazlı Kullanım</h3>
                              <p className="mt-1 text-xs text-slate-600">Önce proje toplamı gösterilir. Projeyi açınca ürünün hangi ana kalemlerde kullanıldığı görünür.</p>
                            </div>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">
                              {allocation.projectRows.length} proje
                            </span>
                          </div>
                          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                            <div className="min-w-[760px]">
                            <div className="grid grid-cols-[minmax(220px,1fr)_90px_90px_90px_90px_44px] gap-3 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase tracking-wide text-slate-500">
                              <div>Proje</div>
                              <div className="text-right">İhtiyaç</div>
                              <div className="text-right">Kullanılan</div>
                              <div className="text-right">Ayrılan</div>
                              <div className="text-right">Eksik</div>
                              <div />
                            </div>
                            {allocation.projectRows.map((projectRow) => {
                              const expanded = expandedProjectKeys.includes(projectRow.key);
                              return (
                                <div key={projectRow.key} className="border-t border-slate-100 first:border-t-0">
                                  <button
                                    type="button"
                                    onClick={() => toggleProjectAllocation(projectRow.key)}
                                    className="grid w-full grid-cols-[minmax(220px,1fr)_90px_90px_90px_90px_44px] items-center gap-3 px-4 py-3 text-left hover:bg-blue-50"
                                  >
                                    <div className="min-w-0">
                                      <div className="whitespace-normal break-words text-sm font-black text-slate-950" title={projectDisplayName(projectRow.project)}>
                                        {projectDisplayName(projectRow.project)}
                                      </div>
                                      <div className="mt-1 truncate text-xs font-semibold text-slate-500">
                                        {formatDate(projectRow.lastDate)} · {projectRow.movementCount} hareket · {projectRow.parentGroups.length} ana kalem
                                      </div>
                                    </div>
                                    <div className="text-right text-sm font-black text-slate-900">{projectRow.need}</div>
                                    <div className="text-right text-sm font-black text-slate-700">{projectRow.consumed}</div>
                                    <div className="text-right text-sm font-black text-blue-700">{projectRow.allocated}</div>
                                    <div className="text-right text-sm font-black text-red-700">{projectRow.missing}</div>
                                    <div className="text-right text-lg font-black text-slate-400">{expanded ? "−" : "+"}</div>
                                  </button>
                                  {expanded && (
                                    <div className="bg-slate-50 px-4 pb-4">
                                      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                                        {projectRow.parentGroups.map((parentGroup) => (
                                          <div key={parentGroup.key} className="grid grid-cols-[minmax(180px,1fr)_80px_80px_80px_80px] items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                                            <div className="min-w-0">
                                              <div className="whitespace-normal break-words font-black text-slate-900" title={parentGroup.parentName}>
                                                {parentGroup.parentName}
                                              </div>
                                              <div className="mt-0.5 truncate font-semibold text-slate-500">
                                                {parentGroup.rows.length} satırda kullanıldı
                                              </div>
                                            </div>
                                            <div className="text-right">
                                              <div className="font-bold text-slate-500">İhtiyaç</div>
                                              <div className="font-black text-slate-900">{parentGroup.need}</div>
                                            </div>
                                            <div className="text-right">
                                              <div className="font-bold text-slate-500">Kullanılan</div>
                                              <div className="font-black text-slate-900">{parentGroup.consumed}</div>
                                            </div>
                                            <div className="text-right">
                                              <div className="font-bold text-blue-700">Ayrılan</div>
                                              <div className="font-black text-blue-900">{parentGroup.allocated}</div>
                                            </div>
                                            <div className="text-right">
                                              <div className="font-bold text-red-700">Eksik</div>
                                              <div className="font-black text-red-900">{parentGroup.missing}</div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {allocation.projectRows.length === 0 && (
                              <div className="border-t border-slate-100 p-4 text-sm text-slate-500">
                                Bu ürün henüz bir projede ihtiyaç olarak görünmüyor.
                              </div>
                            )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-5 space-y-4 rounded-2xl border border-slate-100 bg-white p-4">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <label className="text-sm font-bold text-slate-700">
                              Marka
                              <input
                                value={productForm.brand}
                                onChange={(event) => updateProductForm("brand", event.target.value)}
                                className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm"
                              />
                            </label>
                            <label className="text-sm font-bold text-slate-700">
                              Manuel fiyat
                              <input
                                type="number"
                                step="0.01"
                                value={productForm.manual_unit_price}
                                onChange={(event) => updateProductForm("manual_unit_price", event.target.value)}
                                className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm"
                              />
                            </label>
                            <label className="text-sm font-bold text-slate-700">
                              Minimum stok
                              <input
                                type="number"
                                step="0.01"
                                value={productForm.min_stock}
                                onChange={(event) => updateProductForm("min_stock", event.target.value)}
                                className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm"
                              />
                            </label>
                            <label className="text-sm font-bold text-slate-700">
                              Kritik stok
                              <input
                                type="number"
                                step="0.01"
                                value={productForm.critical_stock}
                                onChange={(event) => updateProductForm("critical_stock", event.target.value)}
                                className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm"
                              />
                            </label>
                          </div>
                          <label className="block text-sm font-bold text-slate-700">
                            Not
                            <textarea
                              value={productForm.notes}
                              onChange={(event) => updateProductForm("notes", event.target.value)}
                              rows={3}
                              className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={saveProductCard}
                            className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300"
                          >
                            {saving ? "Kaydediliyor..." : "Ürün Kartını Kaydet"}
                          </button>
                        </div>
                      </>
                    );
                  })()}

                  <div
                    ref={movementSectionRef}
                    className="mt-6 scroll-mt-6 flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wide text-blue-900">
                        Stok hareketleri ({selectedMovements.length})
                      </h3>
                      <p className="mt-1 text-xs font-semibold text-blue-700">
                        Silmek istediğiniz hareketleri işaretleyin veya tüm bağlı hareketleri seçin.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={exportMovementsExcel}
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-50"
                      >
                        Hareket Excel
                      </button>
                      <button
                        type="button"
                        onClick={exportMovementsPdf}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                      >
                        Hareket PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedMovementIds(allVisibleMovementsSelected ? [] : visibleMovementIds)}
                        className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-black text-blue-800 hover:bg-blue-100"
                      >
                        {allVisibleMovementsSelected
                          ? "Hareket seçimini temizle"
                          : `Tüm bağlı hareketleri seç (${visibleMovementIds.length})`}
                      </button>
                      <button
                        type="button"
                        disabled={selectedVisibleMovements.length === 0 || bulkDeletingMovements}
                        onClick={() => setMovementDeleteModalOpen(true)}
                        className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-700 disabled:bg-slate-300"
                      >
                        {bulkDeletingMovements
                          ? "Siliniyor..."
                          : `Seçilenleri Sil (${selectedVisibleMovements.length})`}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {selectedMovements.map((movement) => {
                      const status = movementStatus(movement);
                      const movementProject = projects.find((project) => project.id === movement.project_id);
                      const movementFlow = movementFlowInfo(movement, movementProject);
                      const movementQuantity = Number(movement.quantity || 0);
                      const movementUnitPrice = Number(movement.unit_price || movement.purchase_unit_price || movement.price || movement.unit_cost || 0);
                      const movementTotal = Number(movement.total_amount || movement.total || movementQuantity * movementUnitPrice || 0);
                      const movementCurrency = movement.currency || selectedProduct.last_currency || "TRY";
                      return (
                        <div key={movement.id} className="rounded-xl border border-slate-100 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <input
                                type="checkbox"
                                checked={selectedMovementIds.includes(movement.id)}
                                onChange={() => toggleMovementSelection(movement.id)}
                                className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 accent-blue-600"
                                aria-label={`${movement.product_name || status} hareketini seç`}
                              />
                              <div className="min-w-0">
                                <div className="whitespace-normal break-words font-bold text-slate-900" title={movement.product_name || status}>{movement.product_name || status}</div>
                                <div className="mt-1 whitespace-normal break-words text-xs text-slate-500" title={`${movement.partner_name || movement.supplier_name || "-"} · ${formatDate(movement.movement_date)} · ${movement.source || "-"}`}>
                                {movement.partner_name || movement.supplier_name || "-"} · {formatDate(movement.movement_date)} · {movement.source || "-"}
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                                  <div className="rounded-lg bg-slate-50 p-2">
                                    <div className="font-bold text-slate-500">Proje</div>
                                    <div className="truncate font-black text-slate-900" title={projectDisplayName(movementProject)}>{movementProject ? projectDisplayName(movementProject) : "-"}</div>
                                  </div>
                                  <div className="rounded-lg bg-emerald-50 p-2">
                                    <div className="font-bold text-emerald-700">Giriş kaynağı</div>
                                    <div className="whitespace-normal break-words font-black text-emerald-900" title={movementFlow.source}>{movementFlow.source}</div>
                                  </div>
                                  <div className="rounded-lg bg-blue-50 p-2">
                                    <div className="font-bold text-blue-700">Çıkış hedefi</div>
                                    <div className="whitespace-normal break-words font-black text-blue-900" title={movementFlow.target}>{movementFlow.target}</div>
                                  </div>
                                  <div className="rounded-lg bg-slate-50 p-2">
                                    <div className="font-bold text-slate-500">Firma / kaynak</div>
                                    <div className="whitespace-normal break-words font-black text-slate-900" title={movementFlow.partner}>{movementFlow.partner}</div>
                                  </div>
                                  <div className="rounded-lg bg-slate-50 p-2">
                                    <div className="font-bold text-slate-500">Belge / referans</div>
                                    <div className="whitespace-normal break-words font-black text-slate-900" title={movementFlow.reference}>{movementFlow.reference}</div>
                                  </div>
                                  <div className="rounded-lg bg-slate-50 p-2">
                                    <div className="font-bold text-slate-500">Birim fiyat</div>
                                    <MoneyValue value={movementUnitPrice} currency={movementCurrency} />
                                  </div>
                                  <div className="rounded-lg bg-slate-50 p-2">
                                    <div className="font-bold text-slate-500">Toplam</div>
                                    <MoneyValue value={movementTotal} currency={movementCurrency} />
                                  </div>
                                  <div className="rounded-lg bg-slate-50 p-2">
                                    <div className="font-bold text-slate-500">Tarih</div>
                                    <div className="font-black text-slate-900">{formatDate(movement.movement_date || movement.created_at)}</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-xs font-bold ${movementStatusClass(status)}`}>
                              {movement.movement_type === "out" ? "-" : "+"}
                              {movement.quantity} {movement.unit}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {selectedMovements.length === 0 && (
                      <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                        Bu ürün için henüz stok hareketi yok.
                      </div>
                    )}
                  </div>
                </>
              )}
                </aside>
              </div>
            )}
          </div>
        </div>
      </main>

      {stockImportPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black text-slate-900">
                  {stockImportResult ? "Toplu yükleme sonucu" : "Eşleşme önizleme"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">Dosyadan okunan toplam satır: <strong>{stockImportPreview.totalFileRows}</strong></p>
              </div>
              <button type="button" onClick={closeStockImportModal} className="rounded-lg bg-slate-100 px-3 py-2 font-black text-slate-600">Kapat</button>
            </div>

            {stockImportResult ? (
              <div className="mt-6 space-y-4">
                {stockImportResult.hasHighRiskDifference && (
                  <div role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-red-950">
                    <div className="font-black">HIGH RISK — Stok artışı tam mutabık değil</div>
                    <p className="mt-1 text-sm font-semibold">Atlanan veya başarısız satırları düzeltmeden işlemi tam başarılı kabul etmeyin.</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  {[
                    ["İşlenen satır", stockImportResult.processedRows],
                    ["Güncellenen ürün", stockImportResult.updatedProducts],
                    ["Yeni kart", stockImportResult.createdProducts],
                    ["Atlanan satır", stockImportResult.skippedRows],
                    ["Hata", stockImportResult.errors],
                  ].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-100 p-4"><div className="text-xs font-bold text-slate-500">{label}</div><div className="mt-1 text-2xl font-black text-slate-900">{value}</div></div>)}
                </div>
                <div className="rounded-xl bg-blue-50 p-4 text-sm font-bold text-blue-900">
                  Ürün kartı sayısı {stockImportResult.productCountBefore} iken {stockImportResult.productCountAfter} oldu.
                  {stockImportResult.productCountAfter !== stockImportResult.productCountBefore
                    ? ` Değişim, oluşturulan ${stockImportResult.createdProducts} yeni ürün kartından kaynaklandı.`
                    : " Yeni kart oluşmadığı için ürün kartı sayısı değişmedi."}
                </div>
                {stockImportPreview.importType !== PRODUCT_TYPES.MAIN && (
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                    {[
                      ["Beklenen artış", stockImportResult.expectedIncrease],
                      ["Uygulanan artış", stockImportResult.appliedIncrease],
                      ["Depo - önce", stockImportResult.warehouseStockBefore ?? "?"],
                      ["Depo - sonra", stockImportResult.warehouseStockAfter ?? "?"],
                      ["Mutabakat farkı", stockImportResult.warehouseDifference === null ? "?" : stockImportResult.expectedIncrease - stockImportResult.warehouseDifference],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border border-slate-200 p-4">
                        <div className="text-xs font-bold text-slate-500">{label}</div>
                        <div className="mt-1 text-2xl font-black text-slate-900">{typeof value === "number" ? value.toLocaleString("tr-TR") : value}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={exportStockImportResultExcel} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white">Sonuç Raporu Excel</button>
                  <button type="button" onClick={exportStockImportResultPdf} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-black text-white">Sonuç Raporu PDF</button>
                </div>
                {(stockImportResult.rows || []).some((row) => row.status !== "success") && (
                  <div>
                    <h3 className="font-black text-slate-900">Atlanan veya başarısız satırlar</h3>
                    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                      {stockImportResult.rows.filter((row) => row.status !== "success").map((row, index) => (
                        <div key={`${row.rowKey || row.rowNumber}-${index}`} className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
                          <div className="font-black">Satır {row.rowNumber || "-"} · {row.productCode || "Kodsuz"} · {row.productName || "Ürün adı yok"}</div>
                          <div className="mt-1 text-xs font-semibold">{row.reason}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                {stockImportPreview.importType !== PRODUCT_TYPES.MAIN && (
                  <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
                    Bu yükleme mevcut stokları silmez veya eşitlemez; dosyadaki miktarları mevcut stokların üzerine ekler. Bu dosyadan stoğa eklenecek toplam miktar: {Number(stockImportPreview.expectedIncrease || 0).toLocaleString("tr-TR")}.
                  </div>
                )}
                <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                  {stockImportPreview.fileDetails.map((file) => (
                    <span key={`${file.fileName}-${file.sheetName}`} className="rounded-full bg-slate-100 px-3 py-2">
                      {file.fileName} · {file.sheetName} · {file.parsedCount}/{file.rowCount} satır okundu · okuma doğruluğu %{file.confidence}
                    </span>
                  ))}
                </div>
                {stockImportPreview.analyses.map((analysis, analysisIndex) => (
                  <section key={`${analysis.fileName}-${analysisIndex}`} className="mt-5 rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-black text-slate-900">{analysis.fileName}</h3>
                        {analysis.sheetCandidates?.length > 1 && (
                          <label className="mt-2 block text-xs font-bold text-slate-600">
                            Sayfa seçimi
                            <select
                              value={analysis.sheetName}
                              onChange={(event) => selectStockImportSheet(analysisIndex, event.target.value)}
                              className="ml-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                            >
                              {analysis.sheetCandidates.map((candidate) => (
                                <option key={candidate.sheetName} value={candidate.sheetName}>
                                  {candidate.sheetName} · {candidate.parsedRows.length} ürün satırı · okuma doğruluğu %{candidate.overallConfidence}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <p className="text-xs text-slate-500">
                          {analysis.headerRowIndex >= 0 ? `Başlık satırı: ${analysis.headerRowIndex + 1}` : "Başlık bulunamadı; içerikten tahmin edildi"}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${analysis.overallConfidence >= 70 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                        Okuma doğruluğu %{analysis.overallConfidence}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {STOCK_IMPORT_FIELDS.map((field) => (
                        <label key={field.key} className="text-xs font-bold text-slate-600">
                          {field.label}{(field.key === "productName" || (field.key === "quantity" && stockImportPreview.importType !== PRODUCT_TYPES.MAIN)) ? " *" : ""}
                          <select
                            value={analysis.mapping[field.key] ?? ""}
                            onChange={(event) => updateStockImportMapping(analysisIndex, field.key, event.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          >
                            <option value="">Eşleşme yok</option>
                            {analysis.columns.map((column) => (
                              <option key={column.index} value={column.index}>
                                {column.label} {column.samples.length ? `(${column.samples.join(" / ")})` : ""}
                              </option>
                            ))}
                          </select>
                          <span className="mt-1 block font-medium text-slate-400">Alan doğruluğu %{Math.round((analysis.confidence[field.key] || 0) * 100)}</span>
                        </label>
                      ))}
                    </div>
                    {analysis.weakFields.length > 0 && <p className="mt-3 text-xs font-bold text-amber-700">Zayıf tahmin: {analysis.weakFields.join(", ")}. Lütfen kolon seçimlerini kontrol edin.</p>}
                    <p className="mt-3 text-xs text-slate-500">Bulunan kolonlar: {analysis.columns.map((column) => column.label).join(", ") || "Yok"}</p>
                  </section>
                ))}
                {(stockImportPreview.error || stockImportPreview.missingFields.length > 0 || stockImportPreview.rows.length === 0 || stockImportPreview.counts.conflict > 0) && (
                  <div className="mt-5 rounded-xl bg-amber-50 p-4 font-bold text-amber-900">
                    {stockImportPreview.error || (stockImportPreview.counts.conflict > 0
                      ? `${stockImportPreview.counts.conflict} satır için kullanıcı kontrolü gerekiyor. Aynı ürün kodu dosyada veya mevcut ürün kartlarında birden fazla kez göründüğü için güvenli şekilde durduruldu.`
                      : stockImportPreview.missingFields.length
                      ? `Eksik zorunlu alanlar: ${stockImportPreview.missingFields.join(", ")}. ${stockImportExpectedColumns(stockImportPreview.importType !== PRODUCT_TYPES.MAIN)}`
                      : "Dosyada okunabilir ürün satırı bulunamadı")}
                  </div>
                )}
                <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
                  <div className="rounded-xl bg-slate-900 p-4 text-white"><div className="text-xs font-bold">Okunan satır</div><div className="text-2xl font-black">{stockImportPreview.rows.length}</div></div>
                  {Object.entries(stockImportPreview.counts).map(([decision, count]) => (
                    <div key={decision} className={`rounded-xl p-4 ${stockImportDecisionTone(decision)}`}><div className="text-xs font-bold">{stockImportSummaryText(decision)}</div><div className="text-2xl font-black">{count}</div></div>
                  ))}
                </div>
                {stockImportPreview.rows.length > 0 && (
                  <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-slate-100 text-xs uppercase text-slate-500"><tr><th className="p-3">Satır</th><th className="p-3">Ürün kodu</th><th className="p-3">Ürün adı</th><th className="p-3">Eklenecek miktar</th><th className="p-3">Durum</th></tr></thead>
                      <tbody>{stockImportPreview.rows.slice(0, 20).map((row, index) => (
                        <tr key={`${row.fileName}-${row.rowNumber}-${index}`} className="border-t border-slate-100">
                          <td className="p-3">{row.rowNumber}</td><td className="p-3 font-bold">{row.productCode || "-"}</td><td className="p-3">{row.productName}</td><td className="p-3">{row.quantity} {row.unit}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-black ${stockImportDecisionTone(row.decision)}`}>{stockImportDecisionText(row.decision)}</span></td>
                        </tr>
                      ))}</tbody>
                    </table>
                    {stockImportPreview.rows.length > 20 && <div className="border-t p-3 text-xs text-slate-500">İlk 20 satır gösteriliyor.</div>}
                  </div>
                )}
                <div className="mt-6 flex justify-end gap-3">
                  <button type="button" onClick={closeStockImportModal} className="rounded-xl bg-slate-100 px-5 py-3 font-bold text-slate-700">Vazgeç</button>
                  <button type="button" onClick={applyStockImportAnalysis} disabled={!stockImportPreview.canApply || stockImportApplying} className="rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
                    {stockImportApplying ? "Uygulanıyor..." : "Onayla ve stoğa ekle"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
