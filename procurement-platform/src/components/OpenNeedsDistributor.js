"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAccountUser } from "@/lib/account";
import { fetchAllRows } from "@/lib/fetchAllRows";

// Gelen malzemeyi açık ihtiyacı olan projelere dağıtma. Ör: 100 sigorta geldi,
// 4 projede 20'şer açık ihtiyaç var → termini en yakın projeden başlayarak 80'i
// projelere ayrılır, 20'si stokta kalır. Ayırma, stoktan karşılama RPC'siyle
// yapılır: proje başına açık ihtiyacı ve boştaki stoğu aşamaz.
const CLOSED_PROJECT = /^(tamamland|iptal|kapand|teslim edildi)/;

function lower(value) {
  return String(value || "").toLocaleLowerCase("tr-TR");
}

function codeKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatQuantity(value) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value || 0));
}

export default function OpenNeedsDistributor({ lines, onDone, title = "Gelen malzemeyi açık ihtiyaçlara dağıt" }) {
  const [state, setState] = useState({ loading: true, groups: [], error: "" });
  const [quantities, setQuantities] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const lineKey = useMemo(() => (lines || []).map((line) => `${line.product_id || ""}:${codeKey(line.product_code)}`).join("|"), [lines]);

  async function load() {
    const {
      data: { user },
    } = await getAccountUser();
    if (!user) return;
    const codes = [...new Set((lines || []).map((line) => codeKey(line.product_code)).filter(Boolean))];
    const ids = [...new Set((lines || []).map((line) => line.product_id).filter(Boolean))];
    if (codes.length === 0 && ids.length === 0) {
      setState({ loading: false, groups: [], error: "" });
      return;
    }
    const [productRes, itemRes, projectRes] = await Promise.all([
      fetchAllRows(() => supabase
        .from("products")
        .select("id,product_code,normalized_product_code,product_name,unit,current_stock,reserved_stock")
        .eq("user_id", user.id)
        .is("archived_at", null)
        .order("id", { ascending: true })),
      fetchAllRows(() => supabase
        .from("project_items")
        .select("id,project_id,product_id,product_code,product_name,unit,item_type,estimated_quantity,received_quantity,reserved_quantity,status")
        .eq("user_id", user.id)
        .order("id", { ascending: true })),
      fetchAllRows(() => supabase
        .from("projects")
        .select("id,project_code,project_name,status,planned_end_date")
        .eq("user_id", user.id)
        .order("id", { ascending: true })),
    ]);
    const error = productRes.error || itemRes.error || projectRes.error;
    if (error) {
      setState({ loading: false, groups: [], error: error.message });
      return;
    }
    const projects = new Map((projectRes.data || []).map((project) => [project.id, project]));
    const products = (productRes.data || []).filter((product) =>
      ids.includes(product.id) || codes.includes(codeKey(product.normalized_product_code || product.product_code)));

    const groups = products.map((product) => {
      const key = codeKey(product.normalized_product_code || product.product_code);
      const free = Math.max(Number(product.current_stock || 0) - Number(product.reserved_stock || 0), 0);
      const needs = (itemRes.data || [])
        .filter((item) => item.item_type !== "main")
        .filter((item) => item.product_id === product.id || (!item.product_id && key && codeKey(item.product_code) === key))
        .map((item) => {
          const project = projects.get(item.project_id);
          const open = Math.max(
            Number(item.estimated_quantity || 0) - Number(item.received_quantity || 0) - Number(item.reserved_quantity || 0),
            0,
          );
          return { item, project, open };
        })
        .filter((row) => row.open > 0 && row.project && !CLOSED_PROJECT.test(lower(row.project.status)))
        .sort((a, b) => String(a.project.planned_end_date || "9999").localeCompare(String(b.project.planned_end_date || "9999"))
          || String(a.project.project_code || "").localeCompare(String(b.project.project_code || "")));
      return { product, free, needs };
    }).filter((group) => group.needs.length > 0);

    // Termini en yakın projeden başlayarak boştaki stok kadar öner.
    const next = {};
    groups.forEach((group) => {
      let left = group.free;
      group.needs.forEach((row) => {
        const take = Math.min(row.open, left);
        next[row.item.id] = take > 0 ? String(take) : "";
        left -= take;
      });
    });
    setQuantities(next);
    setState({ loading: false, groups, error: "" });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey]);

  async function distribute(group) {
    const allocations = group.needs
      .map((row) => ({ row, quantity: Math.min(Number(quantities[row.item.id] || 0), row.open) }))
      .filter(({ quantity }) => quantity > 0)
      .map(({ row, quantity }) => ({
        project_item_id: row.item.id,
        project_id: row.item.project_id,
        product_id: group.product.id,
        product_code: group.product.product_code,
        product_name: group.product.product_name,
        unit: row.item.unit || group.product.unit,
        quantity,
      }));
    const total = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    if (total <= 0) return;
    if (total > group.free + 1e-9) {
      setMessage(`${group.product.product_name}: dağıtılan ${formatQuantity(total)}, boştaki stok ${formatQuantity(group.free)}. Miktarları azaltın.`);
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("reserve_project_items_from_stock", { p_allocations: allocations });
    setBusy(false);
    if (error) {
      setMessage(`Dağıtılamadı: ${error.message}`);
      return;
    }
    const failed = Array.isArray(data?.failed) ? data.failed : [];
    setMessage(
      `${group.product.product_name}: ${formatQuantity(total - 0)} adet ${allocations.length - failed.length} projeye ayrıldı; kalan ${formatQuantity(Math.max(group.free - total, 0))} stokta.`
        + (failed.length ? ` ${failed.length} kalem ayrılamadı: ${failed.map((row) => row.reason).join(" · ")}` : ""),
    );
    await load();
    await onDone?.();
  }

  if (state.loading || (state.groups.length === 0 && !state.error && !message)) return null;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-black text-slate-900">{title}</h3>
      <p className="mt-1 text-sm font-semibold text-slate-500">
        Boştaki stok, açık ihtiyacı olan projelere termini en yakın olandan başlayarak önerildi. Kalan miktar stokta kalır.
      </p>
      {state.error && <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{state.error}</div>}
      {message && <div className="mt-3 rounded-xl bg-slate-100 p-3 text-sm font-bold text-slate-700">{message}</div>}
      {state.groups.map((group) => {
        const planned = group.needs.reduce((sum, row) => sum + Math.min(Number(quantities[row.item.id] || 0), row.open), 0);
        const openTotal = group.needs.reduce((sum, row) => sum + row.open, 0);
        return (
          <div key={group.product.id} className="mt-4 rounded-xl border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <div className="font-black text-slate-900">{group.product.product_name}</div>
                <div className="text-xs font-bold text-slate-500">
                  {group.product.product_code} · boşta {formatQuantity(group.free)} {group.product.unit || ""} · {group.needs.length} projede açık ihtiyaç {formatQuantity(openTotal)}
                </div>
              </div>
              <button
                type="button"
                disabled={busy || planned <= 0 || group.free <= 0}
                onClick={() => distribute(group)}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700 disabled:bg-slate-300"
              >
                {busy ? "Ayrılıyor..." : `${formatQuantity(planned)} adedi projelere ayır`}
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {group.needs.map((row) => (
                <div key={row.item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-bold text-slate-900">{row.project.project_code} · {row.project.project_name}</div>
                    <div className="text-xs font-semibold text-slate-500">
                      Açık ihtiyaç {formatQuantity(row.open)} · termin {row.project.planned_end_date || "-"}
                    </div>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max={row.open}
                    step="any"
                    value={quantities[row.item.id] ?? ""}
                    onChange={(event) => setQuantities((prev) => ({ ...prev, [row.item.id]: event.target.value }))}
                    className="w-24 rounded-lg border border-slate-300 p-2 text-right"
                    aria-label={`${row.project.project_code} ayrılacak miktar`}
                  />
                </div>
              ))}
            </div>
            {group.free > planned && (
              <div className="px-4 py-2 text-xs font-bold text-slate-500">Stokta kalacak: {formatQuantity(group.free - planned)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
