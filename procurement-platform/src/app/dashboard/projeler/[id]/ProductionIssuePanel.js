"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

function formatQuantity(value) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value || 0));
}

// Projeye ayrılmış malzemeyi depodan üretime/montaja çıkarma. Kısmi çıkış
// (yarım montaj) için her satırda miktar değiştirilebilir.
export default function ProductionIssuePanel({ items, onDone, onMessage }) {
  const rows = useMemo(
    () =>
      (items || [])
        .filter((item) => String(item.item_type || "") !== "main" && item.product_id)
        .map((item) => {
          const reserved = Number(item.reserved_quantity || 0);
          const issued = Number(item.issued_to_production_quantity || 0);
          return { item, reserved, issued, issuable: Math.max(reserved - issued, 0) };
        })
        .filter((row) => row.issuable > 0 || row.issued > 0),
    [items],
  );
  // Ana kalemler (pano): tamamlanan adet + alt malzemelerin pano başı miktarı.
  const mainRows = useMemo(() => {
    const list = items || [];
    return list
      .filter((item) => String(item.item_type || "") === "main" && Number(item.estimated_quantity || 0) > 0)
      .map((parent) => {
        const children = list.filter((item) => item.parent_item_id === parent.id);
        return {
          parent,
          children,
          total: Number(parent.estimated_quantity || 0),
          done: Number(parent.received_quantity || 0),
        };
      });
  }, [items]);
  const [mainDrafts, setMainDrafts] = useState({});
  const [selected, setSelected] = useState({});
  const [quantities, setQuantities] = useState({});
  const [busy, setBusy] = useState(false);

  const issuableRows = rows.filter((row) => row.issuable > 0);
  const selectedIds = issuableRows.filter((row) => selected[row.item.id]).map((row) => row.item.id);
  const allSelected = issuableRows.length > 0 && selectedIds.length === issuableRows.length;
  const issuedTotal = rows.reduce((sum, row) => sum + row.issued, 0);
  const plannedTotal = rows.reduce((sum, row) => sum + Number(row.item.estimated_quantity || 0), 0);

  function quantityFor(row) {
    const raw = quantities[row.item.id];
    if (raw === undefined || raw === "") return row.issuable;
    return Math.min(Math.max(Number(raw) || 0, 0), row.issuable);
  }

  // "2 panodan 1'i bitti": tamamlanan pano sayısı kaydedilir; o panoların alt
  // malzemesi (pano başı miktar x tamamlanan) henüz çıkmadıysa üretime çıkarılır.
  async function completeMainItem(row) {
    const increase = Number(mainDrafts[row.parent.id] || 0);
    const nextDone = row.done + increase;
    if (!(increase > 0) || nextDone > row.total) {
      onMessage?.(`Tamamlanan adet 1 ile ${row.total - row.done} arasında olmalı.`);
      return;
    }
    const allocations = [];
    const shortages = [];
    for (const child of row.children) {
      const perUnit = Number(child.estimated_quantity || 0) / row.total;
      const target = perUnit * nextDone;
      const issued = Number(child.issued_to_production_quantity || 0);
      const need = Math.max(Math.round((target - issued) * 1000) / 1000, 0);
      if (need <= 0) continue;
      const issuable = Math.max(Number(child.reserved_quantity || 0) - issued, 0);
      if (!child.product_id || issuable < need) {
        shortages.push(`${child.product_name} (gerekli ${formatQuantity(need)}, ayrılmış ${formatQuantity(issuable)})`);
        continue;
      }
      allocations.push({ project_item_id: child.id, quantity: need, note: `${row.parent.product_name}: ${nextDone}/${row.total} tamamlandı` });
    }
    if (shortages.length > 0) {
      onMessage?.(`Önce bu malzemeleri stoktan ayırın veya teslim alın: ${shortages.slice(0, 4).join(", ")}${shortages.length > 4 ? ` ve ${shortages.length - 4} kalem daha` : ""}.`);
      return;
    }
    if (!window.confirm(`${row.parent.product_name}: ${increase} adet tamamlandı olarak kaydedilsin mi? ${allocations.length} alt malzeme üretime çıkarılır.`)) return;
    setBusy(true);
    if (allocations.length > 0) {
      const { data, error } = await supabase.rpc("issue_project_items_to_production", { p_allocations: allocations });
      if (error || (Array.isArray(data?.failed) && data.failed.length > 0)) {
        setBusy(false);
        onMessage?.(`Alt malzemeler üretime çıkarılamadı: ${error?.message || data.failed.map((row) => row.reason).join(" · ")}`);
        await onDone?.();
        return;
      }
    }
    const { error: parentError } = await supabase
      .from("project_items")
      .update({
        received_quantity: nextDone,
        status: nextDone >= row.total ? "Tamamlandı" : "Kısmen tamamlandı",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.parent.id);
    setBusy(false);
    onMessage?.(parentError
      ? `Ana kalem durumu kaydedilemedi: ${parentError.message}`
      : `${row.parent.product_name}: ${nextDone}/${row.total} tamamlandı.`);
    setMainDrafts((prev) => ({ ...prev, [row.parent.id]: "" }));
    await onDone?.();
  }

  async function issueSelected() {
    const allocations = issuableRows
      .filter((row) => selected[row.item.id])
      .map((row) => ({ project_item_id: row.item.id, quantity: quantityFor(row) }))
      .filter((allocation) => allocation.quantity > 0);
    if (allocations.length === 0) return;
    const total = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    if (!window.confirm(`${allocations.length} kalemden toplam ${formatQuantity(total)} birim malzeme depodan üretime/montaja çıkarılsın mı? Depo stoğu bu miktar kadar düşer.`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("issue_project_items_to_production", { p_allocations: allocations });
    setBusy(false);
    if (error) {
      onMessage?.(`Üretime çıkış yapılamadı: ${error.message}`);
      return;
    }
    const failed = Array.isArray(data?.failed) ? data.failed.length : 0;
    onMessage?.(
      `${data?.issued_items || 0} kalemden ${formatQuantity(data?.issued_quantity)} birim üretime çıkarıldı.${failed ? ` ${failed} kalem çıkarılamadı.` : ""}`,
    );
    setSelected({});
    setQuantities({});
    await onDone?.();
  }

  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900">Üretime / Montaja Çıkış</h2>
          <p className="mt-1 text-sm text-slate-500">
            Projeye ayrılmış malzemeyi depodan üretime çıkarın. Yarım montajda miktarı azaltarak kısmi çıkış yapabilirsiniz.
          </p>
          {plannedTotal > 0 && (
            <p className="mt-1 text-xs font-bold text-violet-700">
              Üretime çıkan: {formatQuantity(issuedTotal)} / {formatQuantity(plannedTotal)} birim
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-sm font-bold text-violet-700">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={issuableRows.length === 0 || busy}
              onChange={() =>
                setSelected(allSelected ? {} : Object.fromEntries(issuableRows.map((row) => [row.item.id, true])))
              }
              className="h-4 w-4"
            />
            Tümünü Seç
          </label>
          <button
            type="button"
            disabled={selectedIds.length === 0 || busy}
            onClick={issueSelected}
            className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:bg-slate-300"
          >
            {busy ? "Çıkarılıyor..." : `Seçilenleri Üretime Çıkar (${selectedIds.length})`}
          </button>
        </div>
      </div>
      {mainRows.length > 0 && (
        <div className="mt-5 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
          <div className="text-sm font-black text-slate-900">Ana ürünler (tamamlanan adet)</div>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Tamamlanan adedi girin; o adede düşen alt malzeme henüz çıkmadıysa üretime çıkarılır.
          </p>
          <div className="mt-3 divide-y divide-violet-100">
            {mainRows.map((row) => (
              <div key={row.parent.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-black text-slate-900">{row.parent.product_name}</div>
                  <div className="mt-1 text-xs font-bold text-violet-700">
                    {formatQuantity(row.done)} / {formatQuantity(row.total)} tamamlandı · {row.children.length} alt malzeme
                  </div>
                </div>
                {row.done < row.total ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max={row.total - row.done}
                      step="1"
                      placeholder="Adet"
                      value={mainDrafts[row.parent.id] ?? ""}
                      onChange={(event) => setMainDrafts((prev) => ({ ...prev, [row.parent.id]: event.target.value }))}
                      className="w-20 rounded-lg border border-slate-300 p-2 text-right"
                    />
                    <button
                      type="button"
                      disabled={busy || !(Number(mainDrafts[row.parent.id] || 0) > 0)}
                      onClick={() => completeMainItem(row)}
                      className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:bg-slate-300"
                    >
                      Tamamlandı kaydet
                    </button>
                  </div>
                ) : (
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">Tamamlandı</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
        {rows.map((row) => (
          <div key={row.item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-4 text-sm">
            {row.issuable > 0 ? (
              <input
                type="checkbox"
                checked={Boolean(selected[row.item.id])}
                onChange={() => setSelected((prev) => ({ ...prev, [row.item.id]: !prev[row.item.id] }))}
                className="h-4 w-4"
              />
            ) : (
              <span className="rounded-full bg-violet-50 px-2 py-1 text-[11px] font-black text-violet-700">Üretimde</span>
            )}
            <div className="min-w-0">
              <div className="truncate font-black text-slate-900" title={row.item.product_name}>{row.item.product_name}</div>
              <div className="mt-1 text-xs font-semibold text-slate-500">
                {row.item.product_code || "-"} · İhtiyaç {formatQuantity(row.item.estimated_quantity)} · Ayrılan {formatQuantity(row.reserved)} · Üretimde {formatQuantity(row.issued)}
              </div>
            </div>
            {row.issuable > 0 ? (
              <label className="text-right text-xs font-bold text-slate-600">
                Çıkış miktarı
                <input
                  type="number"
                  min="0"
                  max={row.issuable}
                  step="any"
                  value={quantities[row.item.id] ?? row.issuable}
                  onChange={(event) => setQuantities((prev) => ({ ...prev, [row.item.id]: event.target.value }))}
                  className="mt-1 block w-24 rounded-lg border border-slate-300 p-2 text-right"
                />
              </label>
            ) : (
              <span className="text-xs font-bold text-violet-700">Tamamı çıktı</span>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="p-6 text-center text-sm font-semibold text-slate-500">
            Üretime çıkarılabilecek malzeme yok. Önce malzemeyi stoktan ayırın veya siparişle teslim alın.
          </div>
        )}
      </div>
    </div>
  );
}
