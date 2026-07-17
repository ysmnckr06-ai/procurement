"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

const asArray = (value) => (Array.isArray(value) ? value : []);
const unique = (values) => [...new Set(values.filter(Boolean))];

function sourceInfo(report) {
  const item = asArray(report?.items)[0] || {};
  const rawName = String(report?.ad || "Teklif Mukayese Raporu")
    .replace(/\.(xlsx?|pdf|png|jpe?g)$/i, "")
    .replace(/satın\s*alma\s*gerekenler/gi, "Talep Mukayesesi");
  const embeddedNumber = rawName.match(/TLB-\d+/i)?.[0]?.toUpperCase();
  return {
    requestId: item.sourceRequestId || report?.request_id || "",
    requestNumber: item.sourceRequestNumber || embeddedNumber || "Talep numarası bulunamadı",
    requestTitle: item.sourceRequestTitle || rawName.replace(/^TLB-\d+\s*[·-]?\s*/i, "") || "Teklif Mukayesesi",
    owner: item.requestOwner || "-",
    department: item.requestDepartment || "-",
  };
}

export default function ReportReviewPage() {
  const { id } = useParams();
  const router = useRouter();
  const [report, setReport] = useState(null);
  const [orders, setOrders] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const [reportResult, orderResult] = await Promise.all([
        supabase.from("reports").select("*").eq("id", id).eq("user_id", user.id).maybeSingle(),
        supabase.from("orders").select("id,order_no,partner_name,supplier_name,status,total_amount,currency").eq("report_id", id).eq("user_id", user.id),
      ]);
      if (reportResult.error || !reportResult.data) {
        setMessage("Rapor bulunamadı veya bu kayda erişim yetkiniz yok.");
        return;
      }
      setReport(reportResult.data);
      setOrders(orderResult.data || []);
    }
    load();
  }, [id, router]);

  const groups = useMemo(() => asArray(report?.analysis), [report]);
  const source = useMemo(() => sourceInfo(report), [report]);
  const suppliers = useMemo(() => unique(groups.flatMap((group) => asArray(group.offers).map((offer) => offer.firmaAdi || offer.firma))), [groups]);
  const projects = useMemo(() => unique(groups.flatMap((group) => asArray(group.allocations).map((row) => row.projectCode || row.projectName || row.projectId))), [groups]);
  const incomplete = useMemo(() => groups.filter((group) => asArray(group.offers).some((offer) => Number(offer.firmaAdedi || 0) < Number(group.purchaseQuantity || group.talepEdilenAdet || 0))).length, [groups]);

  if (!report) return <div className="min-h-screen bg-slate-100 p-8"><div className="mx-auto max-w-5xl rounded-2xl bg-white p-6">{message || "Rapor yükleniyor..."}</div></div>;

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8">
      <main className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl">
          <Link href="/dashboard/raporlar" className="text-sm font-bold text-blue-200">← Raporlara dön</Link>
          <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-sm font-bold text-blue-200">{source.requestNumber}</div>
              <h1 className="mt-1 text-3xl font-black">{source.requestTitle}</h1>
              <p className="mt-2 text-sm text-slate-300">Talep, teklifler, mukayese kararı ve sipariş kayıtları aynı işlem zincirinde gösterilir.</p>
            </div>
            <Link href={`/dashboard/raporlar/${id}/mukayese`} className="rounded-xl bg-emerald-600 px-5 py-3 text-center font-black text-white">Kalem bazlı mukayeseyi incele</Link>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Info label="Rapor No" value={`RPR-${String(id).replaceAll("-", "").slice(0, 8).toUpperCase()}`} />
          <Info label="Rapor Tarihi" value={new Date(report.created_at || report.tarih).toLocaleString("tr-TR")} />
          <Info label="Talebi Açan" value={source.owner} />
          <Info label="Birim" value={source.department} />
          <Info label="Teklif Veren" value={`${suppliers.length} firma`} />
          <Info label="Sipariş" value={`${orders.length} kayıt`} />
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <div className="rounded-2xl border bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-xl font-black text-slate-900">Kısa karşılaştırma</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label="Talep kalemi" value={groups.length} />
              <Metric label="Teklif veren firma" value={suppliers.length} />
              <Metric label="Eksik miktar uyarısı" value={incomplete} warning={incomplete > 0} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {suppliers.map((name) => <span key={name} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">{name}</span>)}
              {!suppliers.length && <span className="text-sm text-slate-500">Teklif veren firma bulunamadı.</span>}
            </div>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-xl font-black text-slate-900">Bağlı projeler</h2>
            <div className="mt-4 space-y-2 text-sm font-semibold text-slate-700">
              {projects.map((project) => <div key={project} className="rounded-xl bg-slate-50 p-3">{project}</div>)}
              {!projects.length && <div className="rounded-xl bg-slate-50 p-3">Proje bağı yok</div>}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-xl font-black text-slate-900">Siparişe dönüşen kayıtlar</h2><p className="mt-1 text-sm text-slate-500">Seçilen tedarikçiler ayrı siparişlerde izlenir; kritik ticari alanlar rapordan sonra kilitlenir.</p></div>
            <Link href="/dashboard/siparisler" className="rounded-xl border border-blue-200 px-4 py-2 text-sm font-bold text-blue-700">Sipariş takibine git</Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {orders.map((order) => <Link key={order.id} href={`/dashboard/siparisler/${order.id}`} className="rounded-xl border p-4 hover:border-blue-400"><div className="font-black text-slate-900">{order.order_no}</div><div className="mt-1 text-sm text-slate-600">{order.partner_name || order.supplier_name} · {order.status}</div></Link>)}
            {!orders.length && <div className="rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-800">Bu rapordan henüz sipariş oluşturulmadı.</div>}
          </div>
        </section>
      </main>
    </div>
  );
}

function Info({ label, value }) { return <div className="rounded-2xl border bg-white p-4 shadow-sm"><div className="text-xs font-bold text-slate-500">{label}</div><div className="mt-2 break-words text-sm font-black text-slate-900">{value || "-"}</div></div>; }
function Metric({ label, value, warning }) { return <div className={`rounded-xl p-4 ${warning ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-900"}`}><div className="text-xs font-bold opacity-70">{label}</div><div className="mt-1 text-2xl font-black">{value}</div></div>; }
