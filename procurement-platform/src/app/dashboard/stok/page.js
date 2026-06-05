"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

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

function productGroupKey(product) {
  const code = normalizeStockCode(product.product_code);
  const name = normalizeStockText(product.product_name);

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
    const key = productGroupKey(product);
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...product,
        groupKey: key,
        duplicateIds: [product.id],
        duplicateCount: 1,
        current_stock: Number(product.current_stock || 0),
        reserved_stock: Number(product.reserved_stock || 0),
      });
      return;
    }

    const existingDate = new Date(existing.updated_at || existing.created_at || 0).getTime();
    const productDate = new Date(product.updated_at || product.created_at || 0).getTime();
    const base = productDate > existingDate ? { ...existing, ...product } : existing;

    grouped.set(key, {
      ...base,
      groupKey: key,
      duplicateIds: [...existing.duplicateIds, product.id],
      duplicateCount: existing.duplicateCount + 1,
      current_stock: Number(existing.current_stock || 0) + Number(product.current_stock || 0),
      reserved_stock: Number(existing.reserved_stock || 0) + Number(product.reserved_stock || 0),
      last_supplier: product.last_supplier || existing.last_supplier,
      last_unit_price: Number(product.last_unit_price || 0) || existing.last_unit_price,
      last_currency: product.last_currency || existing.last_currency,
      last_movement_at: product.last_movement_at || existing.last_movement_at,
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

function StatCard({ title, value, text }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{text}</div>
    </div>
  );
}

export default function StockPage() {
  const router = useRouter();
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState(null);
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
      .limit(300);

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

    if (productError || movementError) {
      setMessage("Stok tabloları hazır değil. Supabase şemasındaki products ve stock_movements bölümlerini çalıştırın.");
    }

    setProducts(productData || []);
    setMovements(movementData || []);
    setSelectedProduct(null);
    setLoading(false);
  }

  async function deleteProductGroup(product) {
    if (!product) return;

    const approved = window.confirm(
      `${product.product_name} ürün kartını silmek istiyor musunuz? Bu karta bağlı stok hareketleri de silinir.`,
    );

    if (!approved) return;

    setDeleting(true);
    setMessage("");

    const productIds = product.duplicateIds || [product.id];
    const movementIds = movements
      .filter((movement) => movementMatchesProduct(movement, product))
      .map((movement) => movement.id);

    if (movementIds.length > 0) {
      const { error: movementDeleteError } = await supabase
        .from("stock_movements")
        .delete()
        .in("id", movementIds);

      if (movementDeleteError) {
        setMessage("Ürün hareketleri silinirken hata oluştu.");
        setDeleting(false);
        return;
      }
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

  function openProductDetail(product) {
    setSelectedProduct(product);
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
      files.forEach((file) => formData.append("files", file));

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
      const payload = rows.map((row, index) => {
        const productCode = String(row.product_code || "").trim().toUpperCase() || `AUTO-${Date.now()}-${index + 1}`;
        return {
          user_id: user.id,
          product_code: productCode,
          brand: row.brand || "",
          product_name: String(row.product_name || "").trim(),
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
        if (existingKeys.has(key) || seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });

      if (payload.length === 0) {
        setMessage("Dosyada yeni ürün kartı oluşturacak satır bulunamadı.");
        return;
      }

      const { error } = await supabase.from("products").insert(payload);
      if (error) {
        console.error("Toplu ürün kartı aktarımı hatası:", error);
        setMessage(error.message || "Ürün kartları oluşturulamadı.");
        return;
      }

      setMessage(`${payload.length} ürün kartı oluşturuldu. Stok miktarları kart detayından veya stok hareketleriyle güncellenebilir.`);
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
        <div className="mx-auto max-w-7xl space-y-6">
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

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.9fr]">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5">
                <h2 className="text-xl font-bold text-slate-900">Ürün Kartları</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {loading ? "Yükleniyor..." : `${filteredProducts.length} ürün gösteriliyor.`}
                </p>
              </div>
              <div className="space-y-3 p-4">
                {filteredProducts.map((product) => {
                  const breakdown = stockBreakdown(product, movements);
                  return (
                    <button
                      type="button"
                      key={product.groupKey}
                      onClick={() => openProductDetail(product)}
                      className={`w-full rounded-2xl border p-4 text-left transition hover:border-blue-200 hover:bg-blue-50 ${
                        selectedProduct?.groupKey === product.groupKey
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">Kod: {product.product_code || "-"}</span>
                            <span>Marka: {product.brand || "-"}</span>
                            <span>Birim: {product.unit || "adet"}</span>
                          </div>
                          <div className="mt-2 whitespace-normal break-words text-base font-black leading-snug text-slate-950">
                            {product.product_name}
                          </div>
                          {product.duplicateCount > 1 && (
                            <div className="mt-1 text-xs font-bold text-amber-700">
                              {product.duplicateCount} kayıt birleşti
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:w-[420px]">
                          <div className="rounded-xl bg-slate-50 p-2">
                            <div className="font-bold text-slate-500">Mevcut stok</div>
                            <div className="mt-1 text-sm font-black text-slate-900">{breakdown.total}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-2">
                            <div className="font-bold text-slate-500">Minimum</div>
                            <div className="mt-1 text-sm font-black text-slate-900">{Number(product.min_stock ?? product.minimum_stock ?? 0)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-2">
                            <div className="font-bold text-slate-500">Kritik</div>
                            <div className="mt-1 text-sm font-black text-slate-900">{Number(product.critical_stock ?? 0)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-2">
                            <div className="font-bold text-slate-500">Son alış</div>
                            <div className="mt-1 text-sm font-black text-slate-900">{formatMoney(product.last_unit_price, product.last_currency || "TRY")}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-2">
                            <div className="font-bold text-slate-500">Manuel</div>
                            <div className="mt-1 text-sm font-black text-indigo-700">{formatMoney(product.manual_unit_price, product.last_currency || "TRY")}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-2">
                            <div className="font-bold text-slate-500">Son bilgi</div>
                            <div className="mt-1 break-words text-sm font-black text-slate-900">{product.last_supplier || "-"}</div>
                            <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{formatDate(product.last_purchase_date || product.last_movement_at || product.updated_at)}</div>
                          </div>
                        </div>
                      </div>
                    </button>
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
                    return (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-xs font-black uppercase tracking-wide text-blue-600">Ürün kartı detayı</div>
                            <h2 className="mt-1 text-xl font-bold text-slate-900">{selectedProduct.product_name}</h2>
                            <p className="mt-1 text-sm text-slate-500">{selectedProduct.product_code || "-"} · {selectedProduct.unit || "adet"}</p>
                          </div>
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={() => deleteProductGroup(selectedProduct)}
                            className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:bg-slate-300"
                          >
                            Sil
                          </button>
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-3">
                          <div className="rounded-xl bg-slate-50 p-4">
                            <div className="text-xs font-bold text-slate-500">Mevcut Stok</div>
                            <div className="mt-1 text-xl font-black text-slate-900">
                              {breakdown.total} {selectedProduct.unit || "adet"}
                            </div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-4">
                            <div className="text-xs font-bold text-slate-500">Kullanılabilir</div>
                            <div className="mt-1 text-xl font-black text-emerald-700">{breakdown.available}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-4">
                            <div className="text-xs font-bold text-slate-500">Siparişlerden Gelen Son Fiyat</div>
                            <div className="mt-1 text-lg font-black text-slate-900">
                              {formatMoney(selectedProduct.last_unit_price, selectedProduct.last_currency || "TRY")}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">{formatDate(selectedProduct.last_purchase_date || selectedProduct.last_movement_at)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-4">
                            <div className="text-xs font-bold text-slate-500">Son İş Ortağı</div>
                            <div className="mt-1 text-lg font-black text-slate-900">{selectedProduct.last_supplier || "-"}</div>
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

                  <h3 className="mt-6 text-sm font-black uppercase tracking-wide text-slate-500">Hareket Geçmişi</h3>
                  <div className="mt-3 space-y-3">
                    {selectedMovements.map((movement) => {
                      const status = movementStatus(movement);
                      return (
                        <div key={movement.id} className="rounded-xl border border-slate-100 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-bold text-slate-900">{status}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {movement.partner_name || movement.supplier_name || "-"} · {formatDate(movement.movement_date)} · {movement.source || "-"}
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
                  <h2 className="text-xl font-bold text-slate-900">Son Stok Hareketleri</h2>
                  <div className="mt-4 space-y-3">
                    {movements.map((movement) => {
                      const status = movementStatus(movement);
                      return (
                        <div key={movement.id} className="rounded-xl border border-slate-100 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-bold text-slate-900">{movement.product_name}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {movement.partner_name || movement.supplier_name || "-"} · {formatDate(movement.movement_date)} · {movement.source || "-"}
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
