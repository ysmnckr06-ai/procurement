"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

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

async function downloadExcelWorkbook(fileName, sheets) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  sheets.forEach((sheet) => {
    const rows = sheet.rows.length > 0 ? sheet.rows : [{ Bilgi: "Kayit bulunamadi" }];
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  });

  XLSX.writeFile(workbook, `${safeFileName(fileName)}.xlsx`);
}

async function downloadPdfTable(fileName, title, rows) {
  const { jsPDF } = await import("jspdf");
  const autoTableModule = await import("jspdf-autotable");
  const autoTable = autoTableModule.default || autoTableModule.autoTable;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const columns = Object.keys(rows[0] || { Bilgi: "Kayit bulunamadi" });
  const body = (rows.length > 0 ? rows : [{ Bilgi: "Kayit bulunamadi" }]).map((row) =>
    columns.map((column) => String(row[column] ?? "")),
  );

  doc.setFontSize(14);
  doc.text(title, 40, 36);
  doc.setFontSize(9);
  doc.text(`Olusturma tarihi: ${formatDate(new Date())}`, 40, 52);
  autoTable(doc, {
    startY: 68,
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
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
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

  if (code && name) return `${code}__${name}`;
  if (code) return `code__${code}`;
  return `name__${name}`;
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
      current_stock: Number(existing.current_stock || 0) + Number(normalizedProduct.current_stock || 0),
      reserved_stock: Number(existing.reserved_stock || 0) + Number(normalizedProduct.reserved_stock || 0),
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
  const shipped = matchedMovements
    .filter((movement) => movementStatus(movement) === "Sevk Edildi")
    .reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);
  const total = Number(product.current_stock || 0);

  return {
    total,
    reserved,
    production,
    montage,
    shipped,
    available: Math.max(total - reserved - production - montage, 0),
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

function projectDisplayName(project) {
  const company = project?.customer_name || project?.customer || project?.client_name || project?.client || project?.firma || project?.firmaAdi || project?.musteri_adi || project?.musteriAdi || "";
  const projectName = project?.project_name || project?.name || project?.title || project?.proje_adi || project?.projeAdi || project?.project_code || "Proje";

  if (company && normalizeStockText(company) !== normalizeStockText(projectName)) {
    return `${company} - ${projectName}`;
  }

  return projectName;
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
  const [selectedProductKeys, setSelectedProductKeys] = useState([]);
  const [selectedMovementIds, setSelectedMovementIds] = useState([]);
  const [bulkDeletingProducts, setBulkDeletingProducts] = useState(false);
  const [bulkDeletingMovements, setBulkDeletingMovements] = useState(false);

  useEffect(() => {
    loadStock();
  }, []);

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

    const { data: productData, error: productError, count: productCount } = await supabase
      .from("products")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
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
    setSelectedProduct(null);
    setLoading(false);
  }

  async function deleteProductGroup(product) {
    if (!product) return;

    const approved = window.confirm(`${product.product_name} ürün kartını silmek istiyor musunuz?`);

    if (!approved) return;

    setDeleting(true);
    setMessage("");

    const productIds = product.duplicateIds || [product.id];
    const movementIds = movements
      .filter((movement) => movementMatchesProduct(movement, product))
      .map((movement) => movement.id);

    if (movementIds.length > 0) {
      setMessage("Bu ürün silinemez çünkü bağlı stok hareketleri var. Önce stok hareketlerini silin.");
      setDeleting(false);
      return;
    }

    const { error: productDeleteError } = await supabase
      .from("products")
      .delete()
      .in("id", productIds);

    if (productDeleteError) {
      setMessage("Ürün kartı silinirken hata oluştu.");
      setDeleting(false);
      return;
    }

    setMessage("Ürün kartı silindi.");
    setSelectedProduct(null);
    setDeleting(false);
    await loadStock();
  }

  async function reverseMovementStockTotals(movement) {
    if (!movement?.product_id) return;

    const product = products.find((item) => item.id === movement.product_id);
    if (!product) return;

    const quantity = Number(movement.quantity || 0);
    const reservedQuantity = Number(movement.reserved_quantity || 0);
    const productionQuantity = Number(movement.issued_to_production_quantity || 0);
    const sourceText = normalizeStockText(movement.source || movement.notes || "");
    const updatePayload = { updated_at: new Date().toISOString() };

    if (movement.movement_type === "in") {
      updatePayload.current_stock = Math.max(Number(product.current_stock || 0) - quantity, 0);
    } else if (reservedQuantity > 0 || sourceText.includes("rezerve") || sourceText.includes("projeye")) {
      updatePayload.reserved_stock = Math.max(Number(product.reserved_stock || 0) - (reservedQuantity || quantity), 0);
    } else if (productionQuantity > 0) {
      updatePayload.reserved_stock = Math.max(Number(product.reserved_stock || 0) - productionQuantity, 0);
    } else {
      updatePayload.current_stock = Number(product.current_stock || 0) + quantity;
    }

    await supabase.from("products").update(updatePayload).eq("id", movement.product_id);
  }

  async function deleteSelectedProducts() {
    const selectedGroups = productGroups.filter((product) => selectedProductKeys.includes(product.groupKey));
    if (selectedGroups.length === 0) return;

    const blocked = selectedGroups.find((product) => movements.some((movement) => movementMatchesProduct(movement, product)));
    if (blocked) {
      setMessage("Bu ürün silinemez çünkü bağlı stok hareketleri var. Önce stok hareketlerini silin.");
      return;
    }

    const approved = window.confirm(`Seçili ${selectedGroups.length} ürün kartı silinecek. Emin misiniz?`);
    if (!approved) return;

    setBulkDeletingProducts(true);
    setMessage("");

    const productIds = selectedGroups.flatMap((product) => product.duplicateIds || [product.id]);
    const { error } = await supabase.from("products").delete().in("id", productIds);

    if (error) {
      setMessage(error.message || "Seçili ürün kartları silinemedi.");
      setBulkDeletingProducts(false);
      return;
    }

    setSelectedProductKeys([]);
    setSelectedProduct(null);
    setMessage(`${selectedGroups.length} ürün kartı silindi.`);
    setBulkDeletingProducts(false);
    await loadStock();
  }

  async function deleteSelectedMovements() {
    const selectedRows = movements.filter((movement) => selectedMovementIds.includes(movement.id));
    if (selectedRows.length === 0) return;

    const approved = window.confirm(`Seçili ${selectedRows.length} stok hareketi silinecek. Emin misiniz?`);
    if (!approved) return;

    setBulkDeletingMovements(true);
    setMessage("");

    for (const movement of selectedRows) {
      await reverseMovementStockTotals(movement);
    }

    const { error } = await supabase.from("stock_movements").delete().in("id", selectedRows.map((movement) => movement.id));

    if (error) {
      setMessage(error.message || "Seçili stok hareketleri silinemedi.");
      setBulkDeletingMovements(false);
      return;
    }

    setSelectedMovementIds([]);
    setMessage(`${selectedRows.length} stok hareketi silindi ve sayaçlar yenilendi.`);
    setBulkDeletingMovements(false);
    await loadStock();
  }

  function openProductDetail(product) {
    setSelectedProduct(product);
    setExpandedProjectKeys([]);
    setMessage("");
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

  async function importStockCardsFromFiles(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setBulkImporting(true);
    setMessage(`${files.length} dosya okunuyor. Ürün kartları çıkarılıyor...`);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const token = session?.access_token;
      if (!token || !API_URL) {
        setMessage("Toplu stok aktarımı için API bağlantısı veya oturum bulunamadı.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
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
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setMessage(data.detail || data.message || "Dosyalardan ürün kartı çıkarılamadı.");
        return;
      }

      const existingKeys = new Set(products.map(productGroupKey));
      const now = new Date().toISOString();
      const seenKeys = new Set();
      const rows = (data.rows || []).filter((row) => String(row.product_name || "").trim());
      let skippedExisting = 0;
      let skippedDuplicateInFile = 0;
      const payload = rows.map((row, index) => {
        const productCode = String(row.product_code || "").trim().toUpperCase() || `AUTO-${Date.now()}-${index + 1}`;
        const normalizedRow = normalizeProductIdentity({
          brand: row.brand || "",
          product_name: String(row.product_name || "").trim(),
        });
        return {
          user_id: user.id,
          product_code: productCode,
          brand: normalizedRow.brand || "",
          product_name: normalizedRow.product_name,
          unit: row.unit || "adet",
          current_stock: 0,
          min_stock: 0,
          critical_stock: 0,
          last_unit_price: Number(row.estimated_unit_price || 0),
          manual_unit_price: 0,
          last_currency: row.currency || "TRY",
          category: row.section_name || row.category || "Dosyadan aktarılan",
          source: "Toplu stok aktarımı",
          notes: row.source_file ? `Kaynak dosya: ${row.source_file}` : "",
          updated_at: now,
        };
      }).filter((product) => {
        const key = productGroupKey(product);
        if (existingKeys.has(key)) {
          skippedExisting += 1;
          return false;
        }
        if (seenKeys.has(key)) {
          skippedDuplicateInFile += 1;
          return false;
        }
        seenKeys.add(key);
        return true;
      });

      if (payload.length === 0) {
        setMessage(`Dosyada yeni ürün kartı oluşturacak satır bulunamadı. ${skippedExisting} satır zaten stokta vardı, ${skippedDuplicateInFile} satır dosya içinde tekrar ediyordu.`);
        return;
      }

      const { error } = await supabase.from("products").insert(payload);
      if (error) {
        console.error("Toplu ürün kartı aktarımı hatası:", error);
        setMessage(error.message || "Ürün kartları oluşturulamadı.");
        return;
      }

      const skippedMessage = [skippedExisting ? `${skippedExisting} satır zaten stokta olduğu için eklenmedi` : "", skippedDuplicateInFile ? `${skippedDuplicateInFile} tekrar satır atlandı` : ""].filter(Boolean).join(". ");
      setMessage(`${payload.length} ürün kartı oluşturuldu.${skippedMessage ? ` ${skippedMessage}.` : ""} Stok miktarları kart detayından veya stok hareketleriyle güncellenebilir.`);
      await loadStock();
    } catch (error) {
      console.error("Toplu stok aktarımı bağlantı hatası:", error);
      setMessage(error.message || "Toplu stok aktarımı sırasında hata oluştu.");
    } finally {
      setBulkImporting(false);
      event.target.value = "";
    }
  }

  const productGroups = useMemo(() => mergeProductGroups(products), [products]);

  const filteredProducts = useMemo(() => {
    const needle = normalizeStockText(search);
    if (!needle) return productGroups;

    return productGroups.filter((product) =>
      normalizeStockText([
        product.product_code,
        product.product_name,
        product.last_supplier,
        product.partner_name,
        product.category,
      ].join(" ")).includes(needle),
    );
  }, [productGroups, search]);

  const selectedMovements = useMemo(() => {
    if (!selectedProduct) return [];
    return movements.filter((movement) => movementMatchesProduct(movement, selectedProduct));
  }, [movements, selectedProduct]);

  const selectedProjectAllocation = useMemo(() => {
    return productProjectAllocations(selectedProduct, projectItems, projects, movements);
  }, [selectedProduct, projectItems, projects, movements]);

  const visibleMovementRows = selectedProduct ? selectedMovements : movements;
  const visibleMovementIds = visibleMovementRows.map((movement) => movement.id);
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
    const productRows = buildProductExportRows(filteredProducts, movements, projectItems, projects);
    const movementRows = buildMovementExportRows(movements, projects);
    await downloadExcelWorkbook(`stok-kartlari-${exportDateStamp()}`, [
      { name: "Stok Kartlari", rows: productRows },
      { name: "Stok Hareketleri", rows: movementRows },
    ]);
  }

  async function exportProductsPdf() {
    const productRows = buildProductExportRows(filteredProducts, movements, projectItems, projects);
    await downloadPdfTable(`stok-kartlari-${exportDateStamp()}`, "Stok Kartlari ve Depo Sayim Listesi", productRows);
  }

  async function exportMovementsExcel() {
    const movementRows = buildMovementExportRows(visibleMovementRows, projects, selectedProduct);
    await downloadExcelWorkbook(`stok-hareketleri-${exportDateStamp()}`, [
      { name: "Hareketler", rows: movementRows },
    ]);
  }

  async function exportMovementsPdf() {
    const movementRows = buildMovementExportRows(visibleMovementRows, projects, selectedProduct);
    const title = selectedProduct ? `${selectedProduct.product_name} - Stok Hareketleri` : "Stok Hareketleri";
    await downloadPdfTable(`stok-hareketleri-${exportDateStamp()}`, title, movementRows);
  }

  async function exportSelectedProductUsageExcel() {
    if (!selectedProduct) return;
    const usageRows = buildProductUsageExportRows(selectedProduct, selectedProjectAllocation);
    const movementRows = buildMovementExportRows(selectedMovements, projects, selectedProduct);
    await downloadExcelWorkbook(`${selectedProduct.product_code || selectedProduct.product_name}-kullanim-${exportDateStamp()}`, [
      { name: "Proje Kullanim", rows: usageRows },
      { name: "Hareketler", rows: movementRows },
    ]);
  }

  async function exportSelectedProductUsagePdf() {
    if (!selectedProduct) return;
    const usageRows = buildProductUsageExportRows(selectedProduct, selectedProjectAllocation);
    await downloadPdfTable(
      `${selectedProduct.product_code || selectedProduct.product_name}-proje-kullanim-${exportDateStamp()}`,
      `${selectedProduct.product_name} - Proje Bazli Kullanim`,
      usageRows,
    );
  }

  const stockTotals = productGroups.reduce(
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
  const lowStockCount = productGroups.filter(
    (product) => {
      const criticalLimit = stockCriticalLimit(product);
      return criticalLimit > 0 && Number(product.current_stock || 0) <= criticalLimit;
    },
  ).length;
  const incomingCount = movements.filter((movement) => movement.movement_type === "in").length;

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
                  accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg"
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard title="Ürün Kartı" value={productGroups.length} text="Tekilleştirilmiş ürün" />
            <StatCard title="Toplam Stok" value={stockTotals.total} text="Depo + ayrılan" />
            <StatCard title="Kullanılabilir" value={stockTotals.available} text="Serbest miktar" />
            <StatCard title="Rezerve / Üretim" value={stockTotals.reserved + stockTotals.production} text="Projeye bağlı" />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard title="Montajdaki Stok" value={stockTotals.montage} text="Montaja verilmiş" />
            <StatCard title="Sevk Edilen" value={stockTotals.shipped} text="Projeden çıkmış" />
            <StatCard title="Düşük Stok" value={lowStockCount} text="Minimum altında" />
            <StatCard title="Giriş Hareketi" value={incomingCount} text="Son hareketlerde" />
          </div>

          {message && (
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
              {message}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <input
              placeholder="Ürün, kod, kategori veya iş ortağı ara..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-xl border border-slate-300 p-3 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[520px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Ürün Kartları</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {loading ? "Yükleniyor..." : `${filteredProducts.length} ürün gösteriliyor.`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedProductKeys(allFilteredProductsSelected ? [] : filteredProducts.map((product) => product.groupKey))}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                      {allFilteredProductsSelected ? "Seçimi Temizle" : "Tümünü Seç"}
                    </button>
                    <button
                      type="button"
                      disabled={selectedProductKeys.length === 0 || bulkDeletingProducts}
                      onClick={deleteSelectedProducts}
                      className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-700 disabled:bg-slate-300"
                    >
                      Seçilenleri Sil ({selectedProductKeys.length})
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-3 p-4">
                {filteredProducts.map((product) => {
                  const breakdown = stockBreakdown(product, movements);
                  const allocation = productProjectAllocations(product, projectItems, projects, movements);
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
                          <div className="pt-1">
                            <input
                              type="checkbox"
                              checked={selectedProductKeys.includes(product.groupKey)}
                              onChange={() => toggleProductSelection(product.groupKey)}
                              className="h-4 w-4 rounded border-slate-300"
                              aria-label={`${product.product_name} seç`}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => openProductDetail(product)}
                              className="block w-full whitespace-normal break-words text-left text-base font-black leading-6 text-slate-950 hover:text-blue-700"
                              title={product.product_name || ""}
                            >
                              {product.product_name}
                            </button>
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
                            {product.duplicateCount > 1 && (
                              <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                                {product.duplicateCount} kayıt birleşti. Aynı kod/açıklama için yeni kart açılmadı.
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="grid min-w-0 grid-cols-4 gap-2 text-xs">
                          <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
                            <div className="truncate font-bold text-slate-500">Stok</div>
                            <div className="mt-1 truncate text-sm font-black text-slate-900">{breakdown.total}</div>
                          </div>
                          <div className="min-w-0 rounded-xl bg-blue-50 px-3 py-2">
                            <div className="truncate font-bold text-blue-700">Ayrılan</div>
                            <div className="mt-1 truncate text-sm font-black text-blue-900">{allocation.allocatedTotal}</div>
                          </div>
                          <div className="min-w-0 rounded-xl bg-emerald-50 px-3 py-2">
                            <div className="truncate font-bold text-emerald-700">Boşta</div>
                            <div className="mt-1 truncate text-sm font-black text-emerald-900">{allocation.freeStock}</div>
                          </div>
                          <div className="min-w-0 rounded-xl bg-red-50 px-3 py-2">
                            <div className="truncate font-bold text-red-700">Eksik</div>
                            <div className="mt-1 truncate text-sm font-black text-red-900">{allocation.missingTotal}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!loading && filteredProducts.length === 0 && (
                  <div className="rounded-xl bg-slate-50 p-8 text-center text-slate-500">
                    Henüz ürün kartı yok.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {selectedProduct ? (
                <>
                  {(() => {
                    const breakdown = stockBreakdown(selectedProduct, movements);
                    const allocation = selectedProjectAllocation;
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
                              disabled={deleting}
                              onClick={() => deleteProductGroup(selectedProduct)}
                              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:bg-slate-300"
                            >
                              Sil
                            </button>
                          </div>
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                          <div className="rounded-xl bg-slate-50 p-4">
                            <div className="text-xs font-bold text-slate-500">Mevcut Stok</div>
                            <div className="mt-1 text-xl font-black text-slate-900">
                              {breakdown.total} {selectedProduct.unit || "adet"}
                            </div>
                          </div>
                          <div className="rounded-xl bg-blue-50 p-4">
                            <div className="text-xs font-bold text-blue-700">Projeye Ayrılan</div>
                            <div className="mt-1 text-xl font-black text-blue-900">{allocation.allocatedTotal}</div>
                          </div>
                          <div className="rounded-xl bg-emerald-50 p-4">
                            <div className="text-xs font-bold text-emerald-700">Boşta Kullanılabilir</div>
                            <div className="mt-1 text-xl font-black text-emerald-900">{allocation.freeStock}</div>
                          </div>
                          <div className="rounded-xl bg-red-50 p-4">
                            <div className="text-xs font-bold text-red-700">Alınması Gereken</div>
                            <div className="mt-1 text-xl font-black text-red-900">{allocation.missingTotal}</div>
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

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Hareket Geçmişi</h3>
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
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                      >
                        {allVisibleMovementsSelected ? "Seçimi Temizle" : "Tümünü Seç"}
                      </button>
                      <button
                        type="button"
                        disabled={selectedMovementIds.length === 0 || bulkDeletingMovements}
                        onClick={deleteSelectedMovements}
                        className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-700 disabled:bg-slate-300"
                      >
                        Hareketleri Sil ({selectedMovementIds.length})
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
                                className="mt-1 h-4 w-4 rounded border-slate-300"
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
                </>              ) : (
                <>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-xl font-bold text-slate-900">Son Stok Hareketleri</h2>
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
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                      >
                        {allVisibleMovementsSelected ? "Seçimi Temizle" : "Tümünü Seç"}
                      </button>
                      <button
                        type="button"
                        disabled={selectedMovementIds.length === 0 || bulkDeletingMovements}
                        onClick={deleteSelectedMovements}
                        className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-700 disabled:bg-slate-300"
                      >
                        Hareketleri Sil ({selectedMovementIds.length})
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {movements.map((movement) => {
                      const status = movementStatus(movement);
                      const movementProject = projects.find((project) => project.id === movement.project_id);
                      const movementFlow = movementFlowInfo(movement, movementProject);
                      return (
                        <div key={movement.id} className="rounded-xl border border-slate-100 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <input
                                type="checkbox"
                                checked={selectedMovementIds.includes(movement.id)}
                                onChange={() => toggleMovementSelection(movement.id)}
                                className="mt-1 h-4 w-4 rounded border-slate-300"
                                aria-label={`${movement.product_name || status} hareketini seç`}
                              />
                              <div className="min-w-0">
                                <div className="whitespace-normal break-words font-bold text-slate-900" title={movement.product_name || "-"}>{movement.product_name}</div>
                                <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                                  <div className="rounded-lg bg-emerald-50 p-2">
                                    <div className="font-bold text-emerald-700">Giriş kaynağı</div>
                                    <div className="whitespace-normal break-words font-black text-emerald-900">{movementFlow.source}</div>
                                  </div>
                                  <div className="rounded-lg bg-blue-50 p-2">
                                    <div className="font-bold text-blue-700">Çıkış hedefi</div>
                                    <div className="whitespace-normal break-words font-black text-blue-900">{movementFlow.target}</div>
                                  </div>
                                  <div className="rounded-lg bg-slate-50 p-2">
                                    <div className="font-bold text-slate-500">Belge / referans</div>
                                    <div className="whitespace-normal break-words font-black text-slate-900">{movementFlow.reference}</div>
                                  </div>
                                </div>
                                <div className="mt-1 whitespace-normal break-words text-xs text-slate-500" title={`${movement.partner_name || movement.supplier_name || "-"} · ${formatDate(movement.movement_date)} · ${movement.source || "-"}`}>
                                {movement.partner_name || movement.supplier_name || "-"} · {formatDate(movement.movement_date)} · {movement.source || "-"}
                                </div>
                              </div>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-xs font-bold ${movementStatusClass(status)}`}>
                              {status}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {!loading && movements.length === 0 && (
                      <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                        Henüz stok hareketi yok.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
