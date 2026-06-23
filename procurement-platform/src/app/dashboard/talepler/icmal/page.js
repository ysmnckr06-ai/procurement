"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CORVIAN_PRODUCT_NAME, fetchCompanyBranding } from "@/lib/companyBranding";

const summaryModes = {
  missing: {
    title: "Eksik Malzeme İcmali",
    shortTitle: "Eksik icmal",
    description: "Seçili projelerde stoktan karşılanamayan ve satınalma/teklif gerektiren kalemler.",
    filePrefix: "eksik-malzeme-icmali",
    emptyText: "Seçili projelerde satınalma gerektiren eksik malzeme bulunamadı.",
  },
  stock: {
    title: "Stoktan Karşılanabilir İcmali",
    shortTitle: "Stok icmali",
    description: "Seçili projelerde depodaki boş stoktan ayrılabilecek kalemler.",
    filePrefix: "stoktan-karsilanabilir-icmali",
    emptyText: "Seçili projelerde stoktan karşılanabilecek açık kalem bulunamadı.",
  },
  all: {
    title: "Tüm İhtiyaç İcmali",
    shortTitle: "Tüm ihtiyaç",
    description: "Eksik, stoktan karşılanabilir ve tamamlanmış tüm proje ihtiyaçları.",
    filePrefix: "tum-ihtiyac-icmali",
    emptyText: "Seçili projelerde ihtiyaç kalemi bulunamadı.",
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

function safeFileName(value) {
  return String(value || "satinalma-icmali").replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ_-]+/g, "-");
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

function buildSummary(projects, projectItems, products, orders) {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const itemsById = new Map(projectItems.map((item) => [item.id, item]));
  const orderedByProjectItem = orderAllocationQuantities(orders);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const productsByCode = new Map(
    products
      .filter((product) => product.normalized_product_code || product.product_code)
      .map((product) => [normalizeCode(product.normalized_product_code || product.product_code), product]),
  );
  const grouped = new Map();

  projectItems
    .filter((item) => item.item_type !== "main")
    .forEach((item) => {
      const estimated = number(item.estimated_quantity);
      const received = number(item.received_quantity);
      const projectReserved = number(item.reserved_quantity ?? item.reserved_child_quantity);
      const alreadyOrdered = number(orderedByProjectItem.get(item.id));
      const openQuantity = Math.max(estimated - received - projectReserved - alreadyOrdered, 0);
      if (estimated <= 0 && openQuantity <= 0 && received <= 0 && projectReserved <= 0 && alreadyOrdered <= 0) return;

      const matchedProduct = productsById.get(item.product_id)
        || productsByCode.get(normalizeCode(item.product_code));
      const normalizedProductCode = normalizeCode(
        matchedProduct?.normalized_product_code || matchedProduct?.product_code || item.product_code,
      );
      const normalizedUnit = normalizeText(item.unit || matchedProduct?.unit || "adet");
      const resolvedProductId = matchedProduct?.id || item.product_id || null;
      const key = resolvedProductId
        ? `product:${resolvedProductId}`
        : normalizedProductCode
          ? `code:${normalizedProductCode}`
          : `name:${normalizeText(item.product_name)}|brand:${normalizeText(item.brand)}|unit:${normalizedUnit}`;
      const project = projectsById.get(item.project_id);
      const parent = itemsById.get(item.parent_item_id);

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          productId: resolvedProductId,
          normalizedProductCode,
          productCode: matchedProduct?.product_code || item.product_code || "",
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
          reservedStock: number(matchedProduct?.reserved_stock),
        });
      }

      const row = grouped.get(key);
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
      const statusLabel = number(allocation.quantity) <= 0
        ? "Tamamlandı"
        : allocationStockCoverable >= number(allocation.quantity)
          ? "Stoktan karşılanabilir"
          : allocationStockCoverable > 0
            ? "Kısmen stoktan"
            : "Satınalma gerekli";
      return {
        ...allocation,
        stockCoverableQuantity: allocationStockCoverable,
        purchaseQuantity: allocationMissing,
        statusLabel,
      };
    });
    const statusLabel = row.totalNeed <= 0
      ? "Tamamlandı"
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
      purchaseQuantity: missingQuantity,
      statusLabel,
    };
  });
}

function filterRowsByMode(rows, mode) {
  if (mode === "stock") return rows.filter((row) => row.stockCoverable > 0);
  if (mode === "all") return rows;
  return rows.filter((row) => row.purchaseQuantity > 0);
}

function exportRows(rows) {
  return rows.map((row, index) => ({
    "Sıra": index + 1,
    "Ürün Kodu": row.productCode || row.normalizedProductCode || "-",
    "Ürün Açıklaması": row.productName,
    "Marka": row.brand || "-",
    "Birim": row.unit,
    "Toplam İhtiyaç": row.requestedQuantity,
    "Açık İhtiyaç": row.totalNeed,
    "Mevcut Stok": row.currentStock,
    "Ayrılmış Stok": row.reservedStock,
    "Boşta Stok": row.availableStock,
    "Stoktan Karşılanabilir": row.stockCoverable,
    "Eksik Miktar": row.missingQuantity,
    "Satın Alınacak": row.purchaseQuantity,
    "Durum": row.statusLabel,
    "Proje Dağılımı": row.allocations.map((allocation) =>
      `${allocation.projectCode} ${allocation.projectName}: ihtiyaç ${allocation.requestedQuantity}, açık ${allocation.quantity}, stoktan ${allocation.stockCoverableQuantity}, eksik ${allocation.purchaseQuantity} ${row.unit}${allocation.parentItemName ? ` / ${allocation.parentItemName}` : ""}`,
    ).join(" | "),
  }));
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

  async function loadSummaryData(nextMessage = "") {
    setLoading(true);
    let selectedIds = [];
    try {
      selectedIds = JSON.parse(localStorage.getItem("procurementSummaryProjectIds") || "[]");
    } catch {
      selectedIds = [];
    }
    if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
      setMessage("İcmal için proje seçimi bulunamadı.");
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const [projectResult, itemResult, productResult, orderResult] = await Promise.all([
      supabase.from("projects").select("id,project_code,project_name,status").eq("user_id", user.id).in("id", selectedIds),
      supabase.from("project_items").select("*").eq("user_id", user.id).in("project_id", selectedIds),
      supabase.from("products").select("id,product_code,normalized_product_code,product_name,brand,unit,current_stock,reserved_stock").eq("user_id", user.id).is("archived_at", null),
      supabase.from("orders").select("id,status,items").eq("user_id", user.id),
    ]);
    const error = projectResult.error || itemResult.error || productResult.error || orderResult.error;
    if (error) {
      setMessage(`İcmal yüklenemedi: ${error.message}`);
      setLoading(false);
      return;
    }
    const tenantProjects = projectResult.data || [];
    setProjects(tenantProjects);
    setAllRows(buildSummary(tenantProjects, itemResult.data || [], productResult.data || [], orderResult.data || []));
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

  const totals = useMemo(() => rows.reduce((summary, row) => ({
    requested: summary.requested + row.requestedQuantity,
    need: summary.need + row.totalNeed,
    stock: summary.stock + row.stockCoverable,
    purchase: summary.purchase + row.purchaseQuantity,
  }), { requested: 0, need: 0, stock: 0, purchase: 0 }), [rows]);

  async function downloadExcel() {
    const { companyName } = await fetchCompanyBranding(supabase);
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.aoa_to_sheet([
      [companyName], [CORVIAN_PRODUCT_NAME], [modeConfig.title, new Date().toLocaleString("tr-TR")], [],
    ]);
    XLSX.utils.sheet_add_json(summarySheet, exportRows(rows), { origin: "A5" });
    XLSX.utils.book_append_sheet(workbook, summarySheet, modeConfig.shortTitle);
    const distribution = rows.flatMap((row) => row.allocations.map((allocation) => ({
      "Ürün Kodu": row.productCode || row.normalizedProductCode,
      "Ürün": row.productName,
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
      head: [["Kod", "Ürün", "Birim", "Toplam", "Açık", "Stoktan", "Satınalma", "Durum", "Proje dağılımı"]],
      body: rows.map((row) => [row.productCode || "-", row.productName, row.unit, row.requestedQuantity, row.totalNeed, row.stockCoverable, row.purchaseQuantity, row.statusLabel,
        row.allocations.map((allocation) => `${allocation.projectCode}: açık ${allocation.quantity}, stoktan ${allocation.stockCoverableQuantity}, eksik ${allocation.purchaseQuantity}`).join(" | ")]),
      styles: { fontSize: 7, cellPadding: 4 }, headStyles: { fillColor: [30, 64, 175] },
    });
    doc.save(`${safeFileName(`${modeConfig.filePrefix}-${new Date().toISOString().slice(0, 10)}`)}.pdf`);
  }

  async function createRequestForOffers() {
    if (creatingRequest || rows.length === 0) return;
    const conflicts = rows.filter((row) => row.unitConflict);
    if (conflicts.length > 0) {
      setMessage(`${conflicts.length} ürün kodunda birim çakışması var. Proje kalemlerinin birimleri düzeltilmeden teklif akışı başlatılmadı.`);
      return;
    }
    setCreatingRequest(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    const items = rows.filter((row) => row.purchaseQuantity > 0).map((row) => ({
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
    router.push(`/dashboard/teklifler?requestId=${data.id}`);
  }

  async function reserveVisibleStockRows() {
    if (reservingStock || rows.length === 0) return;
    const allocations = rows.flatMap((row) =>
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
          notes: `${allocation.projectCode || allocation.projectName || "Proje"} için çok projeli stok icmalinden ayrıldı`,
        })),
    );

    if (allocations.length === 0) {
      setMessage("Stoktan ayrılabilecek uygun kalem bulunamadı.");
      return;
    }

    const approved = window.confirm(`${allocations.length} proje kalemi için stoktan ayrım yapılacak. Devam edilsin mi?`);
    if (!approved) return;

    setReservingStock(true);
    setMessage("Seçili proje icmali stoktan karşılanıyor...");
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
          <p className="mt-2 text-xs font-semibold text-slate-400">{projects.map((project) => `${project.project_code} · ${project.project_name}`).join(" | ")}</p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Metric label="Toplam ihtiyaç" value={totals.requested} />
            <Metric label="Açık ihtiyaç" value={totals.need} />
            <Metric label="Stoktan karşılanabilir" value={totals.stock} />
            <Metric label="Satın alınacak" value={totals.purchase} />
          </div>
        </div>
        {message && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 font-semibold text-amber-900">{message}</div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadExcel} disabled={!rows.length} className="rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:bg-slate-300">Excel İndir</button>
          <button type="button" onClick={downloadPdf} disabled={!rows.length} className="rounded-xl bg-red-700 px-4 py-3 font-bold text-white disabled:bg-slate-300">PDF İndir</button>
          {mode === "stock" ? (
            <button
              type="button"
              onClick={reserveVisibleStockRows}
              disabled={!rows.length || reservingStock}
              className="rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:bg-slate-300"
            >
              {reservingStock ? "Stoktan ayrılıyor..." : "Listelenenleri Stoktan Karşıla"}
            </button>
          ) : (
            <button type="button" onClick={createRequestForOffers} disabled={!rows.length || creatingRequest || totals.purchase <= 0} className="rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:bg-slate-300">{creatingRequest ? "Hazırlanıyor..." : "Teklif / Mukayese Akışına Gönder"}</button>
          )}
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[1250px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
              <th className="p-3">Kod / Ürün</th><th className="p-3">Marka</th><th className="p-3">Birim</th><th className="p-3">Toplam ihtiyaç</th><th className="p-3">Açık ihtiyaç</th><th className="p-3">Mevcut</th><th className="p-3">Ayrılmış</th><th className="p-3">Boşta</th><th className="p-3">Stoktan</th><th className="p-3">Satın alınacak</th><th className="p-3">Durum</th><th className="p-3">Proje dağılımı</th>
            </tr></thead>
            <tbody>{rows.map((row) => <tr key={row.key} className="border-t align-top">
              <td className="p-3"><div className="font-black text-blue-800">{row.productCode || "Kodsuz"}</div><div>{row.productName}</div>{row.unitConflict && <div className="mt-1 font-bold text-red-700">Birim kontrolü: {row.sourceUnits.join(" / ")}</div>}</td>
              <td className="p-3">{row.brand || "-"}</td><td className="p-3">{row.unit}</td><td className="p-3 font-bold">{row.requestedQuantity}</td><td className="p-3 font-bold">{row.totalNeed}</td><td className="p-3">{row.currentStock}</td><td className="p-3">{row.reservedStock}</td><td className="p-3">{row.availableStock}</td><td className="p-3 font-black text-emerald-700">{row.stockCoverable}</td><td className="p-3 font-black text-red-700">{row.purchaseQuantity}</td><td className="p-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{row.statusLabel}</span></td>
              <td className="p-3"><div className="space-y-2">{row.allocations.map((allocation) => <div key={allocation.projectItemId} className="rounded-lg bg-slate-50 p-2"><span className="font-black">{allocation.projectCode}</span> · {allocation.projectName}<div className="text-xs font-semibold text-slate-600">Toplam: {allocation.requestedQuantity} · Açık: {allocation.quantity} · Stoktan: {allocation.stockCoverableQuantity} · Eksik: {allocation.purchaseQuantity} {row.unit}</div>{allocation.parentItemName ? <div className="text-xs text-slate-500">Ana ürün: {allocation.parentItemName}</div> : null}</div>)}</div></td>
            </tr>)}</tbody>
          </table>
          {!loading && rows.length === 0 && <div className="p-8 text-center text-slate-500">{modeConfig.emptyText}</div>}
          {loading && <div className="p-8 text-center text-slate-500">İcmal hazırlanıyor...</div>}
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="rounded-2xl bg-white/10 p-4"><div className="text-xs font-bold text-slate-300">{label}</div><div className="mt-2 text-2xl font-black">{value}</div></div>;
}
