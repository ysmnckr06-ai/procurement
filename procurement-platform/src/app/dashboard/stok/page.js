"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadStock();
  }, []);

  async function loadStock() {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data: productData, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    const { data: movementData, error: movementError } = await supabase
      .from("stock_movements")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(300);

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

  const productGroups = useMemo(() => mergeProductGroups(products), [products]);

  const filteredProducts = useMemo(() => {
    const needle = normalizeStockText(search);
    if (!needle) return productGroups;

    return productGroups.filter((product) =>
      normalizeStockText([
        product.product_code,
        product.product_name,
        product.last_supplier,
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
            <button
              type="button"
              onClick={loadStock}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              Yenile
            </button>
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
              placeholder="Ürün, kod, kategori veya tedarikçi ara..."
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
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="p-4">Ürün kodu</th>
                      <th className="p-4">Ürün adı</th>
                      <th className="p-4">Toplam</th>
                      <th className="p-4">Kullanılabilir</th>
                      <th className="p-4">Rezerve</th>
                      <th className="p-4">Üretimde</th>
                      <th className="p-4">Montajda</th>
                      <th className="p-4">Kritik</th>
                      <th className="p-4">Son Hareket</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => {
                      const breakdown = stockBreakdown(product, movements);
                      return (
                        <tr
                          key={product.groupKey}
                          onClick={() => setSelectedProduct(product)}
                          className={`cursor-pointer border-t border-slate-100 hover:bg-blue-50 ${
                            selectedProduct?.groupKey === product.groupKey ? "bg-blue-50" : ""
                          }`}
                        >
                          <td className="p-4 font-bold text-slate-900">{product.product_code || "-"}</td>
                          <td className="p-4">
                            <div className="font-bold text-slate-900">{product.product_name}</div>
                            {product.duplicateCount > 1 && (
                              <div className="mt-1 text-xs text-amber-700">
                                {product.duplicateCount} kayıt birleşti
                              </div>
                            )}
                          </td>
                          <td className="p-4 font-black">{breakdown.total} {product.unit || "adet"}</td>
                          <td className="p-4 font-black text-emerald-700">{breakdown.available}</td>
                          <td className="p-4 font-semibold text-blue-700">{breakdown.reserved}</td>
                          <td className="p-4 font-semibold text-purple-700">{breakdown.production}</td>
                          <td className="p-4 font-semibold text-orange-700">{breakdown.montage}</td>
                          <td className="p-4">
                            {stockCriticalLimit(product) > 0 ? stockCriticalLimit(product) : "-"}
                          </td>
                          <td className="p-4">{formatDate(product.last_movement_at || product.updated_at)}</td>
                        </tr>
                      );
                    })}
                    {!loading && filteredProducts.length === 0 && (
                      <tr>
                        <td colSpan="9" className="p-8 text-center text-slate-500">
                          Henüz ürün kartı yok.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
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
                      <h2 className="text-xl font-bold text-slate-900">{selectedProduct.product_name}</h2>
                      <p className="mt-1 text-sm text-slate-500">{selectedProduct.product_code || "-"}</p>
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
                      <div className="text-xs font-bold text-slate-500">Toplam Stok</div>
                      <div className="mt-1 text-xl font-black text-slate-900">
                        {breakdown.total} {selectedProduct.unit || "adet"}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-xs font-bold text-slate-500">Kullanılabilir</div>
                      <div className="mt-1 text-xl font-black text-emerald-700">{breakdown.available}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-xs font-bold text-slate-500">Rezerve</div>
                      <div className="mt-1 text-xl font-black text-blue-700">{breakdown.reserved}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-xs font-bold text-slate-500">Üretim / Montaj</div>
                      <div className="mt-1 text-xl font-black text-purple-700">{breakdown.production + breakdown.montage}</div>
                    </div>
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
                                {movement.supplier_name || "-"} · {formatDate(movement.movement_date)} · {movement.source || "-"}
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
              ) : (
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
                                {movement.supplier_name || "-"} · {formatDate(movement.movement_date)} · {movement.source || "-"}
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
