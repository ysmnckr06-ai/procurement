"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

function formatMoney(value, currency = "TRY") {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} ${currency}`;
}

function normalizeFilter(value) {
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

function profitLossTotal(rows) {
  return rows.reduce((sum, row) => sum + Number(row.profitLoss || 0), 0);
}

function StatCard({ title, value, text, tone = "slate" }) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    orange: "border-orange-200 bg-orange-50 text-orange-800",
    red: "border-red-200 bg-red-50 text-red-800",
  };

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}>
      <div className="text-sm font-bold opacity-70">{title}</div>
      <div className="mt-2 text-2xl font-black">{value}</div>
      <div className="mt-1 text-sm opacity-70">{text}</div>
    </div>
  );
}

export default function FinancePage() {
  const [projects, setProjects] = useState([]);
  const [projectPayments, setProjectPayments] = useState([]);
  const [orders, setOrders] = useState([]);
  const [orderPayments, setOrderPayments] = useState([]);
  const [stockMovements, setStockMovements] = useState([]);
  const [settings, setSettings] = useState({ base_currency: "TRY" });
  const [partnerFilter, setPartnerFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setPartnerFilter(params.get("is_ortagi") || "");
    }
    loadFinance();
  }, []);

  async function loadFinance() {
    setLoading(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.href = "/login";
      return;
    }

    const [projectRes, projectPaymentRes, orderRes, orderPaymentRes, movementRes, settingsRes] =
      await Promise.all([
        supabase.from("projects").select("*").eq("user_id", user.id),
        supabase.from("project_payments").select("*").eq("user_id", user.id),
        supabase.from("orders").select("*").eq("user_id", user.id),
        supabase.from("order_payments").select("*").eq("user_id", user.id),
        supabase.from("stock_movements").select("*").eq("user_id", user.id),
        supabase.from("company_settings").select("*").eq("user_id", user.id).limit(1),
      ]);

    if (orderPaymentRes.error) {
      setMessage("Sipariş ödeme raporu için Supabase SQL tarafında order_payments tablosu çalıştırılmalı.");
    }

    setProjects(projectRes.data || []);
    setProjectPayments(projectPaymentRes.data || []);
    setOrders(orderRes.data || []);
    setOrderPayments(orderPaymentRes.data || []);
    setStockMovements(movementRes.data || []);
    if (settingsRes.data?.[0]) setSettings(settingsRes.data[0]);
    setLoading(false);
  }

  const report = useMemo(() => {
    const baseCurrency = settings.base_currency || settings.default_currency || "TRY";
    const filterNeedle = normalizeFilter(partnerFilter);
    const matchesFilter = (parts) => normalizeFilter(parts.join(" ")).includes(filterNeedle);
    const filteredProjects = filterNeedle
      ? projects.filter((project) =>
          matchesFilter([
            project.customer_name,
            project.customer_partner_name,
            project.project_name,
            project.project_code,
            project.description,
          ]),
        )
      : projects;
    const filteredProjectIds = new Set(filteredProjects.map((project) => project.id));
    const filteredOrders = filterNeedle
      ? orders.filter(
          (order) =>
            filteredProjectIds.has(order.project_id) ||
            matchesFilter([order.partner_name, order.supplier_name, order.customer_name, order.project_name]),
        )
      : orders;
    const filteredOrderIds = new Set(filteredOrders.map((order) => order.id));
    const filteredProjectPayments = filterNeedle
      ? projectPayments.filter((payment) => filteredProjectIds.has(payment.project_id))
      : projectPayments;
    const filteredOrderPayments = filterNeedle
      ? orderPayments.filter((payment) => filteredOrderIds.has(payment.order_id))
      : orderPayments;
    const filteredStockMovements = filterNeedle
      ? stockMovements.filter((movement) => filteredProjectIds.has(movement.project_id) || filteredOrderIds.has(movement.order_id))
      : stockMovements;

    const projectPaymentTotal = filteredProjectPayments.reduce(
      (sum, payment) => sum + Number(payment.base_amount || payment.amount || 0),
      0,
    );
    const contractTotal = filteredProjects.reduce(
      (sum, project) => sum + Number(project.contract_base_amount || project.contract_amount || 0),
      0,
    );
    const orderTotal = filteredOrders.reduce(
      (sum, order) => sum + Number(order.order_total_base || order.base_amount || order.total_amount || 0),
      0,
    );
    const orderPaid =
      filteredOrderPayments.reduce((sum, payment) => sum + Number(payment.base_amount || payment.amount || 0), 0) ||
      filteredOrders.reduce((sum, order) => sum + Number(order.paid_amount_base || order.paid_amount || 0), 0);
    const receivedValue = filteredStockMovements
      .filter((movement) => movement.movement_type !== "out")
      .reduce(
        (sum, movement) =>
          sum + Number(movement.quantity || 0) * Number(movement.unit_price || 0) * Number(movement.exchange_rate || 1),
        0,
      );
    const notReceivedValue = Math.max(orderTotal - receivedValue, 0);
    const paidNotReceived = filteredOrders
      .filter((order) => Number(order.paid_amount || 0) > 0 && Number(order.received_total || 0) <= 0)
      .reduce((sum, order) => sum + Number(order.paid_amount_base || order.paid_amount || 0), 0);
    const receivedNotPaid = Math.max(receivedValue - orderPaid, 0);

    const projectRows = filteredProjects.map((project) => {
      const payments = filteredProjectPayments
        .filter((payment) => payment.project_id === project.id)
        .reduce((sum, payment) => sum + Number(payment.base_amount || payment.amount || 0), 0);
      const projectOrders = filteredOrders.filter((order) => order.project_id === project.id);
      const projectOrderTotal = projectOrders.reduce(
        (sum, order) => sum + Number(order.order_total_base || order.base_amount || order.total_amount || 0),
        0,
      );
      const projectPaidOrders = projectOrders.reduce(
        (sum, order) => sum + Number(order.paid_amount_base || order.paid_amount || 0),
        0,
      );
      const contractBase = Number(project.contract_base_amount || project.contract_amount || 0);
      const profitLoss = contractBase - projectOrderTotal;

      return {
        ...project,
        payments,
        contractBase,
        remainingCollection: Math.max(contractBase - payments, 0),
        orderTotal: projectOrderTotal,
        paidOrders: projectPaidOrders,
        supplierDebt: Math.max(projectOrderTotal - projectPaidOrders, 0),
        profitLoss,
      };
    });

    const supplierDebtRows = Object.values(
      filteredOrders.reduce((map, order) => {
        const key = order.partner_name || order.supplier_name || "İş ortağı yok";
        const row = map[key] || { supplier: key, total: 0, paid: 0, debt: 0 };
        row.total += Number(order.order_total_base || order.base_amount || order.total_amount || 0);
        row.paid += Number(order.paid_amount_base || order.paid_amount || 0);
        row.debt = Math.max(row.total - row.paid, 0);
        map[key] = row;
        return map;
      }, {}),
    ).sort((a, b) => b.debt - a.debt);

    let partnerPerformance = null;
    if (partnerFilter) {
      let score = 100;
      const notes = [];
      const waitingRatio = contractTotal > 0 ? Math.max(contractTotal - projectPaymentTotal, 0) / contractTotal : 0;
      const debtRatio = orderTotal > 0 ? Math.max(orderTotal - orderPaid, 0) / orderTotal : 0;
      if (waitingRatio > 0.4) {
        score -= Math.min(25, Math.round(waitingRatio * 25));
        notes.push(`Bekleyen tahsilat oranı yüksek: %${Math.round(waitingRatio * 100)}.`);
      }
      if (debtRatio > 0.4) {
        score -= Math.min(20, Math.round(debtRatio * 20));
        notes.push(`Açık iş ortağı borcu oranı yüksek: %${Math.round(debtRatio * 100)}.`);
      }
      if (profitLossTotal(projectRows) < 0) {
        score -= 15;
        notes.push("Filtreli projelerde maliyet/sipariş toplamı sözleşme bedelini aşıyor.");
      }
      if (paidNotReceived > 0) {
        score -= 10;
        notes.push("Ödeme yapılmış ama ürün girişi tamamlanmamış kayıtlar var.");
      }
      if (notes.length === 0) notes.push("Finans tarafında kritik risk sinyali görünmüyor.");
      partnerPerformance = { score: Math.max(0, Math.min(100, Math.round(score))), notes };
    }

    return {
      contractTotal,
      projectPaymentTotal,
      waitingCollection: Math.max(contractTotal - projectPaymentTotal, 0),
      orderTotal,
      orderPaid,
      supplierDebt: Math.max(orderTotal - orderPaid, 0),
      receivedValue,
      notReceivedValue,
      paidNotReceived,
      receivedNotPaid,
      projectRows,
      supplierDebtRows,
      partnerPerformance,
      baseCurrency,
    };
  }, [projects, projectPayments, orders, orderPayments, stockMovements, settings, partnerFilter]);

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <main className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
              Finans Raporu
            </div>
            <h1 className="mt-3 text-4xl font-bold text-slate-900">
              Genel ve Proje Bazlı Finans
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Tahsilat, iş ortağı ödemesi, gelen ürün değeri ve proje kârlılığı tek ekranda izlenir.
            </p>
          </div>
          <button
            type="button"
            onClick={loadFinance}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
          >
            Yenile
          </button>
        </div>

        {message && (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
            {message}
          </div>
        )}

        {partnerFilter && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <span>İş ortağı filtresi: {partnerFilter}</span>
            <button
              type="button"
              onClick={() => {
                setPartnerFilter("");
                window.history.replaceState(null, "", "/dashboard/finans");
              }}
              className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
            >
              Filtreyi temizle
            </button>
          </div>
        )}

        {report.partnerPerformance && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-sm font-black text-slate-950">İş Ortağı Finans Performansı</div>
                <p className="mt-1 text-sm text-slate-500">
                  Seçili iş ortağının tahsilat, sipariş ödemesi, maliyet ve stok giriş sinyalleri.
                </p>
              </div>
              <div className={`rounded-2xl px-5 py-3 text-2xl font-black ${report.partnerPerformance.score >= 80 ? "bg-emerald-100 text-emerald-800" : report.partnerPerformance.score >= 60 ? "bg-blue-100 text-blue-800" : report.partnerPerformance.score >= 45 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                {report.partnerPerformance.score}
              </div>
            </div>
            <ul className="mt-4 grid grid-cols-1 gap-2 text-sm font-semibold text-slate-700 md:grid-cols-2">
              {report.partnerPerformance.notes.map((note) => (
                <li key={note} className="rounded-xl bg-slate-50 p-3">{note}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <StatCard title="Sözleşme Bedeli" value={formatMoney(report.contractTotal, report.baseCurrency)} text="Base toplam" tone="blue" />
          <StatCard title="Tahsilat" value={formatMoney(report.projectPaymentTotal, report.baseCurrency)} text="Base alınan ödeme" tone="green" />
          <StatCard title="Bekleyen Tahsilat" value={formatMoney(report.waitingCollection, report.baseCurrency)} text="Müşteri alacağı" tone="orange" />
          <StatCard title="Sipariş Tutarı" value={formatMoney(report.orderTotal, report.baseCurrency)} text="Base iş ortağı borç matrahı" />
          <StatCard title="Kalan İş Ortağı Ödemesi" value={formatMoney(report.supplierDebt, report.baseCurrency)} text="Base ödenecek kalan" tone="red" />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard title="Gelen Ürün Değeri" value={formatMoney(report.receivedValue, report.baseCurrency)} text="Ana para stok giriş değeri" tone="green" />
          <StatCard title="Gelmeyen Ürün Değeri" value={formatMoney(report.notReceivedValue, report.baseCurrency)} text="Sipariş - gelen" tone="orange" />
          <StatCard title="Ödendi / Gelmedi" value={formatMoney(report.paidNotReceived, report.baseCurrency)} text="Riskli ödeme" tone="red" />
          <StatCard title="Geldi / Ödenmedi" value={formatMoney(report.receivedNotPaid, report.baseCurrency)} text="İş ortağı borcu" tone="blue" />
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-xl font-bold text-slate-900">Proje Bazlı Kâr / Zarar</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-4">Proje</th>
                  <th className="p-4">Sözleşme</th>
                  <th className="p-4">Tahsilat</th>
                  <th className="p-4">Bekleyen</th>
                  <th className="p-4">Sipariş</th>
                  <th className="p-4">İş Ortağı Borcu</th>
                  <th className="p-4">Kâr / Zarar</th>
                </tr>
              </thead>
              <tbody>
                {report.projectRows.map((project) => (
                  <tr key={project.id} className="border-t border-slate-100">
                    <td className="p-4">
                      <Link href={`/dashboard/projeler/${project.id}`} className="font-black text-blue-700 hover:underline">
                        {project.project_code} · {project.project_name}
                      </Link>
                    </td>
                    <td className="p-4">
                      <div>{formatMoney(project.contractBase, report.baseCurrency)}</div>
                      <div className="text-xs text-slate-500">{formatMoney(project.contract_amount, project.contract_currency || report.baseCurrency)}</div>
                    </td>
                    <td className="p-4 text-emerald-700">{formatMoney(project.payments, report.baseCurrency)}</td>
                    <td className="p-4 text-orange-700">{formatMoney(project.remainingCollection, report.baseCurrency)}</td>
                    <td className="p-4">{formatMoney(project.orderTotal, report.baseCurrency)}</td>
                    <td className="p-4 text-red-700">{formatMoney(project.supplierDebt, report.baseCurrency)}</td>
                    <td className={`p-4 font-black ${project.profitLoss < 0 ? "text-red-700" : "text-emerald-700"}`}>
                      {formatMoney(project.profitLoss, report.baseCurrency)}
                    </td>
                  </tr>
                ))}
                {!loading && report.projectRows.length === 0 && (
                  <tr>
                    <td colSpan="7" className="p-8 text-center text-slate-500">
                      Henüz proje finans kaydı yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-xl font-bold text-slate-900">İş Ortağı Bazlı Borç Durumu</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-4">İş Ortağı</th>
                  <th className="p-4">Toplam Sipariş</th>
                  <th className="p-4">Ödenen</th>
                  <th className="p-4">Kalan Borç</th>
                </tr>
              </thead>
              <tbody>
                {report.supplierDebtRows.map((row) => (
                  <tr key={row.supplier} className="border-t border-slate-100">
                    <td className="p-4 font-black text-slate-900">{row.supplier}</td>
                    <td className="p-4">{formatMoney(row.total, report.baseCurrency)}</td>
                    <td className="p-4 text-emerald-700">{formatMoney(row.paid, report.baseCurrency)}</td>
                    <td className="p-4 text-red-700">{formatMoney(row.debt, report.baseCurrency)}</td>
                  </tr>
                ))}
                {!loading && report.supplierDebtRows.length === 0 && (
                  <tr>
                    <td colSpan="4" className="p-8 text-center text-slate-500">
                      Henüz iş ortağı borç kaydı yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
