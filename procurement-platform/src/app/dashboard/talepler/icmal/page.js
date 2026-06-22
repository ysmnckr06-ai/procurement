"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CORVIAN_PRODUCT_NAME, fetchCompanyBranding } from "@/lib/companyBranding";

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
      if (openQuantity <= 0) return;

      const matchedProduct = productsById.get(item.product_id)
        || productsByCode.get(normalizeCode(item.product_code));
      const normalizedProductCode = normalizeCode(
        matchedProduct?.normalized_product_code || matchedProduct?.product_code || item.product_code,
      );
      const normalizedUnit = normalizeText(item.unit || matchedProduct?.unit || "adet");
      const key = normalizedProductCode
        ? `code:${normalizedProductCode}`
        : `name:${normalizeText(item.product_name)}|brand:${normalizeText(item.brand)}|unit:${normalizedUnit}`;
      const project = projectsById.get(item.project_id);
      const parent = itemsById.get(item.parent_item_id);

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          productId: matchedProduct?.id || item.product_id || null,
          normalizedProductCode,
          productCode: matchedProduct?.product_code || item.product_code || "",
          productName: matchedProduct?.product_name || item.product_name || "",
          brand: matchedProduct?.brand || item.brand || "",
          unit: matchedProduct?.unit || item.unit || "adet",
          sourceUnits: new Set(),
          totalNeed: 0,
          allocations: [],
          currentStock: number(matchedProduct?.current_stock),
          reservedStock: number(matchedProduct?.reserved_stock),
        });
      }

      const row = grouped.get(key);
      row.sourceUnits.add(normalizeText(item.unit || matchedProduct?.unit || "adet"));
      row.totalNeed += openQuantity;
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
        estimatedQuantity: estimated,
        receivedQuantity: received,
        reservedQuantity: projectReserved,
        orderedQuantity: alreadyOrdered,
      });
    });

  return Array.from(grouped.values()).map((row) => {
    const availableStock = Math.max(row.currentStock - row.reservedStock, 0);
    const stockCoverable = Math.min(row.totalNeed, availableStock);
    const missingQuantity = Math.max(row.totalNeed - stockCoverable, 0);
    const sourceUnits = Array.from(row.sourceUnits);
    return { ...row, sourceUnits, unitConflict: sourceUnits.length > 1, availableStock, stockCoverable, missingQuantity, purchaseQuantity: missingQuantity };
  });
}

function exportRows(rows) {
  return rows.map((row, index) => ({
    "Sıra": index + 1,
    "Ürün Kodu": row.productCode || row.normalizedProductCode || "-",
    "Ürün Açıklaması": row.productName,
    "Marka": row.brand || "-",
    "Birim": row.unit,
    "Toplam İhtiyaç": row.totalNeed,
    "Mevcut Stok": row.currentStock,
    "Ayrılmış Stok": row.reservedStock,
    "Boşta Stok": row.availableStock,
    "Stoktan Karşılanabilir": row.stockCoverable,
    "Eksik Miktar": row.missingQuantity,
    "Satın Alınacak": row.purchaseQuantity,
    "Proje Dağılımı": row.allocations.map((allocation) =>
      `${allocation.projectCode} ${allocation.projectName}: ${allocation.quantity} ${row.unit}${allocation.parentItemName ? ` / ${allocation.parentItemName}` : ""}`,
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
  const [projects, setProjects] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [creatingRequest, setCreatingRequest] = useState(false);

  useEffect(() => {
    async function loadSummary() {
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
        supabase.from("products").select("id,product_code,normalized_product_code,product_name,brand,unit,current_stock,reserved_stock").eq("user_id", user.id),
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
      setRows(buildSummary(tenantProjects, itemResult.data || [], productResult.data || [], orderResult.data || []));
      setLoading(false);
    }
    loadSummary();
  }, [router]);

  const totals = useMemo(() => rows.reduce((summary, row) => ({
    need: summary.need + row.totalNeed,
    stock: summary.stock + row.stockCoverable,
    purchase: summary.purchase + row.purchaseQuantity,
  }), { need: 0, stock: 0, purchase: 0 }), [rows]);

  async function downloadExcel() {
    const { companyName } = await fetchCompanyBranding(supabase);
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.aoa_to_sheet([
      [companyName], [CORVIAN_PRODUCT_NAME], ["Çok Projeli Satınalma İcmali", new Date().toLocaleString("tr-TR")], [],
    ]);
    XLSX.utils.sheet_add_json(summarySheet, exportRows(rows), { origin: "A5" });
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Satınalma İcmali");
    const distribution = rows.flatMap((row) => row.allocations.map((allocation) => ({
      "Ürün Kodu": row.productCode || row.normalizedProductCode,
      "Ürün": row.productName,
      "Proje Kodu": allocation.projectCode,
      "Proje": allocation.projectName,
      "Proje Kalemi": allocation.projectItemId,
      "Ana Ürün": allocation.parentItemName || "-",
      "İhtiyaç": allocation.quantity,
      "Birim": row.unit,
    })));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(distribution), "Proje Dağılımı");
    XLSX.writeFile(workbook, `${safeFileName(`satinalma-icmali-${new Date().toISOString().slice(0, 10)}`)}.xlsx`);
  }

  async function downloadPdf() {
    const { companyName } = await fetchCompanyBranding(supabase);
    const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(16); doc.text(companyName, 40, 34);
    doc.setFontSize(9); doc.setTextColor(90); doc.text(`${CORVIAN_PRODUCT_NAME} · Çok Projeli Satınalma İcmali · ${new Date().toLocaleString("tr-TR")}`, 40, 50);
    autoTable(doc, {
      startY: 66,
      head: [["Kod", "Ürün", "Birim", "İhtiyaç", "Stok", "Eksik / Satınalma", "Proje dağılımı"]],
      body: rows.map((row) => [row.productCode || "-", row.productName, row.unit, row.totalNeed, row.stockCoverable, row.purchaseQuantity,
        row.allocations.map((allocation) => `${allocation.projectCode}: ${allocation.quantity}`).join(" | ")]),
      styles: { fontSize: 7, cellPadding: 4 }, headStyles: { fillColor: [30, 64, 175] },
    });
    doc.save(`${safeFileName(`satinalma-icmali-${new Date().toISOString().slice(0, 10)}`)}.pdf`);
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
      ad: `Çok Projeli Satınalma İcmali · ${new Date().toLocaleDateString("tr-TR")}`,
      durum: "Teklif Bekliyor",
      totalitems: items.length,
      items,
    }).select("id").single();
    setCreatingRequest(false);
    if (error) { setMessage(`Talep oluşturulamadı: ${error.message}`); return; }
    router.push(`/dashboard/teklifler?requestId=${data.id}`);
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8">
      <main className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl">
          <Link href="/dashboard/projeler" className="text-sm font-bold text-blue-200">← Projelere dön</Link>
          <h1 className="mt-3 text-3xl font-black">Çok Projeli Satınalma İcmali</h1>
          <p className="mt-2 text-sm text-slate-300">{projects.map((project) => `${project.project_code} · ${project.project_name}`).join(" | ")}</p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="Toplam açık ihtiyaç" value={totals.need} />
            <Metric label="Stoktan karşılanabilir" value={totals.stock} />
            <Metric label="Satın alınacak" value={totals.purchase} />
          </div>
        </div>
        {message && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 font-semibold text-amber-900">{message}</div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadExcel} disabled={!rows.length} className="rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:bg-slate-300">Excel İndir</button>
          <button type="button" onClick={downloadPdf} disabled={!rows.length} className="rounded-xl bg-red-700 px-4 py-3 font-bold text-white disabled:bg-slate-300">PDF İndir</button>
          <button type="button" onClick={createRequestForOffers} disabled={!rows.length || creatingRequest} className="rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:bg-slate-300">{creatingRequest ? "Hazırlanıyor..." : "Teklif / Mukayese Akışına Gönder"}</button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[1100px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
              <th className="p-3">Kod / Ürün</th><th className="p-3">Birim</th><th className="p-3">İhtiyaç</th><th className="p-3">Mevcut</th><th className="p-3">Ayrılmış</th><th className="p-3">Stoktan</th><th className="p-3">Satın alınacak</th><th className="p-3">Proje dağılımı</th>
            </tr></thead>
            <tbody>{rows.map((row) => <tr key={row.key} className="border-t align-top">
              <td className="p-3"><div className="font-black text-blue-800">{row.productCode || "Kodsuz"}</div><div>{row.productName}</div>{row.unitConflict && <div className="mt-1 font-bold text-red-700">Birim kontrolü: {row.sourceUnits.join(" / ")}</div>}</td>
              <td className="p-3">{row.unit}</td><td className="p-3 font-bold">{row.totalNeed}</td><td className="p-3">{row.currentStock}</td><td className="p-3">{row.reservedStock}</td><td className="p-3 text-emerald-700">{row.stockCoverable}</td><td className="p-3 font-black text-red-700">{row.purchaseQuantity}</td>
              <td className="p-3"><div className="space-y-2">{row.allocations.map((allocation) => <div key={allocation.projectItemId} className="rounded-lg bg-slate-50 p-2"><span className="font-black">{allocation.projectCode}</span> · {allocation.projectName}: {allocation.quantity} {row.unit}{allocation.parentItemName ? <div className="text-xs text-slate-500">Ana ürün: {allocation.parentItemName}</div> : null}</div>)}</div></td>
            </tr>)}</tbody>
          </table>
          {!loading && rows.length === 0 && <div className="p-8 text-center text-slate-500">Satın alınacak açık proje ihtiyacı bulunamadı.</div>}
          {loading && <div className="p-8 text-center text-slate-500">İcmal hazırlanıyor...</div>}
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="rounded-2xl bg-white/10 p-4"><div className="text-xs font-bold text-slate-300">{label}</div><div className="mt-2 text-2xl font-black">{value}</div></div>;
}
