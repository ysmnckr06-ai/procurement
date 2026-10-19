"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getAccountUser } from "@/lib/account";
import { hasDemoData, loadDemoData, removeDemoData } from "@/lib/demoData";
import { fetchLiveTryRates, liveRateFor } from "@/lib/liveCurrency";

// variant="welcome": boş hesapta Genel Bakış'ta gösterilir.
// variant="settings": Ayarlar'da yükle / sil.
export default function DemoDataPanel({ variant = "welcome", onChange }) {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, demo: false, empty: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const { data: { user } } = await getAccountUser();
    if (!user) return;
    const [demo, projectCount, productCount] = await Promise.all([
      hasDemoData(supabase, user.id),
      supabase.from("projects").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    ]);
    setState({
      loading: false,
      demo,
      empty: Number(projectCount.count || 0) === 0 && Number(productCount.count || 0) === 0,
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  async function load() {
    setBusy(true);
    setMessage("");
    const { data: { user } } = await getAccountUser();
    let eurRate = 50;
    try {
      eurRate = Number(liveRateFor("EUR", await fetchLiveTryRates())) || eurRate;
    } catch {}
    const result = await loadDemoData(supabase, user.id, { eurRate });
    setMessage(result.message);
    setBusy(false);
    await refresh();
    onChange?.();
    if (result.ok && variant === "welcome") router.push("/dashboard/projeler");
  }

  async function remove() {
    if (!window.confirm("Örnek stok kartları, projeler ve iş ortakları silinsin mi? Kendi kayıtlarınız etkilenmez.")) return;
    setBusy(true);
    setMessage("");
    const { data: { user } } = await getAccountUser();
    const result = await removeDemoData(supabase, user.id);
    setMessage(result.message);
    setBusy(false);
    await refresh();
    onChange?.();
  }

  if (state.loading) return null;
  if (variant === "welcome" && !state.empty) return null;

  if (variant === "welcome") {
    return (
      <section className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">Hesabınız henüz boş</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              Programı denemek için örnek verileri yükleyin: 20 stok kartı, 3 proje ve iş ortakları. Stoktan ayırma,
              talep, teklif ve sipariş adımlarını gerçek veri girmeden deneyebilir, sonra Ayarlar&apos;dan tek tuşla silebilirsiniz.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="shrink-0 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-700 disabled:bg-slate-300"
          >
            {busy ? "Yükleniyor..." : "Örnek verilerle dene"}
          </button>
        </div>
        {message && <p className="mt-3 text-sm font-semibold text-slate-700">{message}</p>}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">Örnek veriler</h2>
      <p className="mt-2 text-sm text-slate-600">
        {state.demo
          ? "Hesabınızda örnek stok kartları ve projeler var. Gerçek kullanıma geçmeden önce silebilirsiniz; kendi kayıtlarınız etkilenmez."
          : "Programı denemek için 20 stok kartı, 3 proje ve iş ortaklarından oluşan örnek verileri yükleyebilirsiniz."}
      </p>
      <div className="mt-4">
        {state.demo ? (
          <button type="button" onClick={remove} disabled={busy} className="rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-700 disabled:bg-slate-300">
            {busy ? "Siliniyor..." : "Örnek verileri sil"}
          </button>
        ) : (
          <button type="button" onClick={load} disabled={busy} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-700 disabled:bg-slate-300">
            {busy ? "Yükleniyor..." : "Örnek verileri yükle"}
          </button>
        )}
      </div>
      {message && <p className="mt-3 text-sm font-semibold text-slate-700">{message}</p>}
    </section>
  );
}
