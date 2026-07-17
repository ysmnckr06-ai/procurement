"use client";

import { useEffect, useState } from "react";

const controls = [
  ["system_overview", "Genel durum", "Projeden teslimata açık işlerin özeti", "blue"],
  ["stock_risk", "Riskli stoklar", "Kritik seviyedeki veya tükenen ürünler", "red"],
  ["stock_coverage", "Stok uygunluğu", "Stoktan karşılanabilecek ihtiyaçlar", "emerald"],
  ["request_queue", "Bekleyen talepler", "Henüz ilerlememiş talep listeleri", "amber"],
  ["offer_waiting", "Teklif bekleyenler", "Yeterli teklif alınmamış işler", "indigo"],
  ["comparison_gaps", "Mukayese kontrolü", "Eksik teklif ve miktar kontrolleri", "violet"],
  ["open_orders", "Açık siparişler", "Açık ve termini geçen siparişler", "orange"],
  ["delivery_gaps", "Eksik teslimatlar", "Sipariş ve teslim arasındaki farklar", "cyan"],
  ["cost_hotspots", "Maliyet odağı", "Tutarı yüksek sipariş kalemleri", "slate"],
  ["data_quality", "Veri kalitesi", "Eksik kod, firma, kur ve termin bilgileri", "rose"],
];

const cardTone = {
  blue: "border-blue-100 bg-blue-50 text-blue-900",
  red: "border-red-100 bg-red-50 text-red-900",
  emerald: "border-emerald-100 bg-emerald-50 text-emerald-900",
  amber: "border-amber-100 bg-amber-50 text-amber-900",
  indigo: "border-indigo-100 bg-indigo-50 text-indigo-900",
  violet: "border-violet-100 bg-violet-50 text-violet-900",
  orange: "border-orange-100 bg-orange-50 text-orange-900",
  cyan: "border-cyan-100 bg-cyan-50 text-cyan-900",
  slate: "border-slate-200 bg-slate-50 text-slate-900",
  rose: "border-rose-100 bg-rose-50 text-rose-900",
};

const metricTone = {
  blue: "bg-blue-50 text-blue-800",
  red: "bg-red-50 text-red-800",
  green: "bg-emerald-50 text-emerald-800",
  emerald: "bg-emerald-50 text-emerald-800",
  amber: "bg-amber-50 text-amber-800",
  orange: "bg-orange-50 text-orange-800",
  indigo: "bg-indigo-50 text-indigo-800",
};

function Result({ payload, loading }) {
  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500">Sistem kayıtları kontrol ediliyor...</div>;
  }
  if (!payload?.analysis) return null;
  const analysis = payload.analysis;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-wider text-blue-700">Sistem Destek Yanıtı</div>
          <h2 className="mt-1 text-xl font-black text-slate-950">{analysis.headline}</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">{analysis.summary}</p>
        </div>
        <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">Ücretsiz · Kural tabanlı · Salt okunur</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(analysis.metrics || []).map((item) => (
          <div key={item.label} className={`rounded-xl p-4 ${metricTone[item.tone] || "bg-slate-50 text-slate-800"}`}>
            <div className="text-xs font-black uppercase tracking-wide opacity-70">{item.label}</div>
            <div className="mt-1 text-2xl font-black">{item.value}</div>
          </div>
        ))}
      </div>

      {(analysis.rows || []).length > 0 ? (
        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-950 text-white">
              <tr>{analysis.columns.map((column) => <th key={column.key} className="whitespace-nowrap px-4 py-3 text-xs font-black uppercase tracking-wide">{column.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analysis.rows.map((row, index) => (
                <tr key={index} className="hover:bg-slate-50">
                  {analysis.columns.map((column) => <td key={column.key} className="whitespace-nowrap px-4 py-3 font-semibold text-slate-700">{row[column.key] ?? "-"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-emerald-200 bg-emerald-50 p-5 text-sm font-bold text-emerald-800">{analysis.emptyMessage}</div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <h3 className="text-sm font-black text-amber-950">Kontrol notları</h3>
          <ul className="mt-2 space-y-2 text-sm font-semibold text-amber-900">{(analysis.findings || []).map((item, i) => <li key={i}>• {item}</li>)}</ul>
          {!(analysis.findings || []).length && <p className="mt-2 text-sm font-semibold text-amber-800">Ek uyarı bulunmadı.</p>}
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <h3 className="text-sm font-black text-blue-950">Önerilen sonraki adım</h3>
          <ul className="mt-2 space-y-2 text-sm font-semibold text-blue-900">{(analysis.actions || []).map((item, i) => <li key={i}>• {item}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}

export default function SystemSupportPage() {
  const [active, setActive] = useState("system_overview");
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function run(questionId) {
    setActive(questionId);
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ai/procurement-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Kontrol tamamlanamadı.");
      setPayload(data);
    } catch (requestError) {
      setPayload(null);
      setError(requestError?.message || "Kontrol tamamlanamadı.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { run("system_overview"); }, []);

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-wider text-blue-700">Operasyon kontrol merkezi</div>
            <h1 className="mt-1 text-2xl font-black text-slate-950">Sistem Destek Merkezi</h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold text-slate-500">Proje, stok, talep, teklif, sipariş ve teslimat kayıtlarını 10 sabit kontrolle inceler. Harici yapay zekâ servisi kullanmaz ve hiçbir kaydı değiştirmez.</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-black leading-5 text-emerald-800">Ücretsiz kullanım<br />Canlı sistem verisi · Salt okunur</div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {controls.map(([id, title, description, tone]) => (
            <button key={id} type="button" onClick={() => run(id)} disabled={loading && active === id} className={`min-h-28 rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${cardTone[tone]} ${active === id ? "ring-2 ring-blue-600 ring-offset-2" : ""}`}>
              <div className="text-sm font-black">{title}</div>
              <div className="mt-2 text-xs font-bold leading-5 opacity-75">{description}</div>
            </button>
          ))}
        </div>
        {error && <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}
      </section>
      <Result payload={payload} loading={loading} />
    </main>
  );
}
