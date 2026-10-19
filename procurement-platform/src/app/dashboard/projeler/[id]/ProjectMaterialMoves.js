"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAccountUser } from "@/lib/account";
import { fetchAllRows } from "@/lib/fetchAllRows";

// Malzemenin yeri (depoda / montajda) ve projeler arası hareket:
// - Montajdan depoya iade
// - Acil başka projeye ver (depodan ya da montajdan) → ödünç kaydı
// - Ödünç alınanı geri ver
const CLOSED_PROJECT = /^(tamamland|iptal|kapand)/;

function formatQuantity(value) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value || 0));
}

function lower(value) {
  return String(value || "").toLocaleLowerCase("tr-TR");
}

export default function ProjectMaterialMoves({ projectId, items, onDone, onMessage }) {
  const [projects, setProjects] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () =>
      (items || [])
        .filter((item) => item.item_type !== "main" && item.product_id)
        .map((item) => {
          const reserved = Number(item.reserved_quantity || 0);
          const site = Number(item.issued_to_production_quantity || 0);
          return { item, depot: Math.max(reserved - site, 0), site };
        })
        .filter((row) => row.depot > 0 || row.site > 0),
    [items],
  );

  async function load() {
    const {
      data: { user },
    } = await getAccountUser();
    if (!user) return;
    const productIds = [...new Set(rows.map((row) => row.item.product_id))];
    const [projectRes, itemRes, transferRes] = await Promise.all([
      fetchAllRows(() => supabase.from("projects").select("id,project_code,project_name,status,planned_end_date").eq("user_id", user.id).order("id", { ascending: true })),
      productIds.length
        ? fetchAllRows(() => supabase
          .from("project_items")
          .select("id,project_id,product_id,product_name,estimated_quantity,received_quantity,reserved_quantity,issued_to_production_quantity,item_type")
          .eq("user_id", user.id)
          .in("product_id", productIds)
          .order("id", { ascending: true }))
        : Promise.resolve({ data: [] }),
      supabase
        .from("project_item_transfers")
        .select("*")
        .eq("user_id", user.id)
        .or(`from_project_id.eq.${projectId},to_project_id.eq.${projectId}`)
        .order("created_at", { ascending: false }),
    ]);
    setProjects(projectRes.data || []);
    setCandidates(itemRes.data || []);
    setTransfers(transferRes.error ? [] : transferRes.data || []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, items]);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const itemById = useMemo(() => new Map([...(items || []), ...candidates].map((item) => [item.id, item])), [items, candidates]);

  function targetsFor(row) {
    return candidates
      .filter((candidate) => candidate.product_id === row.item.product_id && candidate.project_id !== projectId && candidate.item_type !== "main")
      .map((candidate) => ({
        candidate,
        project: projectById.get(candidate.project_id),
        open: Math.max(
          Number(candidate.estimated_quantity || 0) - Number(candidate.received_quantity || 0) - Number(candidate.reserved_quantity || 0),
          0,
        ),
      }))
      .filter((target) => target.open > 0 && target.project && !CLOSED_PROJECT.test(lower(target.project.status)))
      .sort((a, b) => String(a.project.planned_end_date || "9999").localeCompare(String(b.project.planned_end_date || "9999")));
  }

  async function run(rpc, args, success) {
    setBusy(true);
    const { data, error } = await supabase.rpc(rpc, args);
    setBusy(false);
    if (error) {
      onMessage?.(`İşlem yapılamadı: ${error.message}`);
      return;
    }
    const failed = Array.isArray(data?.failed) ? data.failed : [];
    onMessage?.(failed.length ? `İşlem yapılamadı: ${failed.map((row) => row.reason).join(" · ")}` : success(data));
    setAction(null);
    await load();
    await onDone?.();
  }

  function submit() {
    const quantity = Number(action.quantity || 0);
    if (!(quantity > 0)) return;
    if (action.type === "return") {
      run("return_project_items_from_production", { p_allocations: [{ project_item_id: action.row.item.id, quantity }] },
        (data) => `${formatQuantity(data?.returned_quantity)} birim montajdan depoya iade edildi.`);
    } else if (action.type === "transfer") {
      if (!action.targetId) return;
      const target = itemById.get(action.targetId);
      const project = projectById.get(target?.project_id);
      run("transfer_project_item", {
        p_from_item: action.row.item.id,
        p_to_item: action.targetId,
        p_quantity: quantity,
        p_location: action.location,
        p_note: action.note || null,
      }, (data) => `${formatQuantity(data?.quantity)} birim ${project?.project_code || "diğer projeye"} verildi; ödünç kaydı açıldı.`);
    } else if (action.type === "giveBack") {
      run("return_project_item_transfer", { p_transfer_id: action.transfer.id, p_quantity: quantity },
        (data) => `${formatQuantity(data?.returned)} birim ödünç geri verildi.`);
    }
  }

  const openTransfers = transfers.filter((transfer) => transfer.status === "açık");
  if (rows.length === 0 && openTransfers.length === 0) return null;

  return (
    <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-black text-slate-900">Malzemenin yeri ve projeler arası hareket</h2>
      <p className="mt-1 text-sm text-slate-500">
        Depoda: projeye ayrılmış ama henüz çıkmamış. Montajda: üretime/montaja çıkmış. Acil başka projeye verilen malzeme ödünç olarak izlenir.
      </p>

      {openTransfers.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-sm font-black text-amber-900">Açık ödünçler</div>
          {openTransfers.map((transfer) => {
            const given = transfer.from_project_id === projectId;
            const other = projectById.get(given ? transfer.to_project_id : transfer.from_project_id);
            const item = itemById.get(transfer.from_item_id) || itemById.get(transfer.to_item_id);
            const remaining = Number(transfer.quantity) - Number(transfer.returned_quantity || 0);
            return (
              <div key={transfer.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-slate-800">
                  {item?.product_name || "Malzeme"}: {formatQuantity(remaining)} birim {given ? `${other?.project_code || "diğer projeye"} verildi` : `${other?.project_code || "diğer projeden"} alındı`}
                  {" "}({transfer.location === "montaj" ? "montajdan" : "depodan"}, {String(transfer.created_at).slice(0, 10)})
                </span>
                {!given && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setAction({ type: "giveBack", transfer, quantity: String(remaining) })}
                    className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-black text-white hover:bg-amber-700 disabled:bg-slate-300"
                  >
                    Geri ver
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">
        {rows.map((row) => {
          const targets = targetsFor(row);
          return (
            <div key={row.item.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <div className="truncate font-black text-slate-900">{row.item.product_name}</div>
                <div className="text-xs font-bold text-slate-500">
                  Depoda {formatQuantity(row.depot)} · Montajda {formatQuantity(row.site)}
                  {targets.length > 0 && ` · ${targets.length} projede açık ihtiyaç`}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.site > 0 && (
                  <button type="button" disabled={busy} onClick={() => setAction({ type: "return", row, quantity: String(row.site) })}
                    className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100">
                    Montajdan iade
                  </button>
                )}
                {targets.length > 0 && (
                  <button type="button" disabled={busy}
                    onClick={() => setAction({
                      type: "transfer",
                      row,
                      targetId: targets[0].candidate.id,
                      location: row.depot > 0 ? "depo" : "montaj",
                      quantity: String(Math.min(targets[0].open, row.depot > 0 ? row.depot : row.site)),
                      note: "",
                    })}
                    className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-black text-white hover:bg-sky-700">
                    Başka projeye ver
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {action && (
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm">
          <div className="font-black text-slate-900">
            {action.type === "return" && `Montajdan depoya iade: ${action.row.item.product_name}`}
            {action.type === "transfer" && `Başka projeye ver: ${action.row.item.product_name}`}
            {action.type === "giveBack" && "Ödüncü geri ver (depodan)"}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {action.type === "transfer" && (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-600">Alan proje</span>
                  <select value={action.targetId} onChange={(event) => setAction((prev) => ({ ...prev, targetId: event.target.value }))}
                    className="rounded-lg border border-slate-300 bg-white p-2">
                    {targetsFor(action.row).map((target) => (
                      <option key={target.candidate.id} value={target.candidate.id}>
                        {target.project.project_code} · {target.project.project_name} (açık {formatQuantity(target.open)})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-600">Nereden</span>
                  <select value={action.location} onChange={(event) => setAction((prev) => ({ ...prev, location: event.target.value }))}
                    className="rounded-lg border border-slate-300 bg-white p-2">
                    {action.row.depot > 0 && <option value="depo">Depodan ({formatQuantity(action.row.depot)})</option>}
                    {action.row.site > 0 && <option value="montaj">Montajdan ({formatQuantity(action.row.site)})</option>}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-600">Not</span>
                  <input value={action.note} onChange={(event) => setAction((prev) => ({ ...prev, note: event.target.value }))}
                    placeholder="Ör. acil sevkiyat" className="w-48 rounded-lg border border-slate-300 bg-white p-2" />
                </label>
              </>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-600">Miktar</span>
              <input type="number" min="0" step="any" value={action.quantity}
                onChange={(event) => setAction((prev) => ({ ...prev, quantity: event.target.value }))}
                className="w-24 rounded-lg border border-slate-300 bg-white p-2 text-right" />
            </label>
            <button type="button" disabled={busy} onClick={submit}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:bg-slate-300">
              {busy ? "İşleniyor..." : "Onayla"}
            </button>
            <button type="button" onClick={() => setAction(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500">
              Vazgeç
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
