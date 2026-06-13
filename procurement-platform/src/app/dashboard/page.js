"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

const closedOrderStatuses = ["Teslim Edildi", "Tam Teslim", "İptal"];
const activeProjectStatuses = ["Onaylandı", "Devam Ediyor"];

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysUntil(value) {
  if (!value) return null;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due - todayStart()) / 86400000);
}

function formatMoney(value) {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} TRY`;
}

function orderPaidAmount(order) {
  return Number(
    order.paid_amount ||
      order.paid_total ||
      order.payment_amount ||
      order.total_paid ||
      0,
  );
}

function orderRemainingPayment(order) {
  return Math.max(Number(order.total_amount || 0) - orderPaidAmount(order), 0);
}

function projectPaidAmount(project, payments) {
  return payments
    .filter((payment) => payment.project_id === project.id)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function productCriticalLimit(product) {
  return Math.max(
    Number(product.min_stock || 0),
    Number(product.critical_stock || 0),
    Number(product.minimum_stock || 0),
  );
}

function StatCard({ icon, title, value, text, href, tone = "blue" }) {
  const tones = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    red: "bg-red-50 text-red-700 border-red-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100",
    green: "bg-emerald-50 text-emerald-700 border-emerald-100",
    slate: "bg-slate-50 text-slate-700 border-slate-100",
  };

  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-blue-100"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div
            className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border text-xl ${tones[tone]}`}
          >
            {icon}
          </div>
          <div className="text-sm font-semibold text-slate-500">{title}</div>
          <div className="mt-1 text-3xl font-black text-slate-900">{value}</div>
          <div className="mt-1 text-sm text-slate-500">{text}</div>
        </div>
        <span className="text-lg text-slate-400 transition group-hover:translate-x-1">
          →
        </span>
      </div>
    </Link>
  );
}

function WorkItemCard({ item }) {
  const tones = {
    red: "border-red-200 bg-red-50 text-red-900",
    orange: "border-orange-200 bg-orange-50 text-orange-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
  };

  const buttonTones = {
    red: "bg-red-600 hover:bg-red-700",
    orange: "bg-orange-600 hover:bg-orange-700",
    green: "bg-emerald-600 hover:bg-emerald-700",
    blue: "bg-blue-600 hover:bg-blue-700",
  };

  return (
    <div className={`rounded-2xl border p-4 ${tones[item.tone]}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-black">{item.title}</div>
          <div className="mt-2 text-lg font-black text-slate-950">
            {item.subject}
          </div>
          <div className="mt-1 text-sm font-semibold opacity-80">
            {item.projectName || "Proje bağlantısı yok"}
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            {item.description}
          </p>
        </div>
        <Link
          href={item.href}
          className={`shrink-0 rounded-xl px-4 py-2 text-center text-sm font-bold text-white ${buttonTones[item.tone]}`}
        >
          Detaya git
        </Link>
      </div>
    </div>
  );
}

function ProcessGapCard({ gap }) {
  const tones = {
    red: "border-red-200 bg-red-50 text-red-900",
    orange: "border-orange-200 bg-orange-50 text-orange-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
  };

  return (
    <Link
      href={gap.href}
      className={`block rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${tones[gap.tone]}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-black">{gap.title}</div>
          <p className="mt-2 text-sm leading-6 text-slate-700">{gap.text}</p>
        </div>
        <div className="shrink-0 rounded-xl bg-white/75 px-3 py-2 text-xl font-black text-slate-950">
          {gap.count}
        </div>
      </div>
    </Link>
  );
}

function ModuleCard({ icon, title, text, href, button, tone = "blue" }) {
  const styles = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    purple: "bg-purple-50 text-purple-700 border-purple-100",
    green: "bg-green-50 text-green-700 border-green-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md">
      <div className="flex items-start justify-between gap-5">
        <div>
          <div
            className={`mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border text-2xl ${styles[tone]}`}
          >
            {icon}
          </div>
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
            {text}
          </p>
          <Link
            href={href}
            className={`mt-5 inline-flex rounded-xl border px-5 py-3 text-sm font-bold transition-all hover:scale-[1.02] ${styles[tone]}`}
          >
            {button} →
          </Link>
        </div>
        <div className="hidden text-7xl opacity-20 md:block">{icon}</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [currentTime, setCurrentTime] = useState("--:--");
  const [dashboardData, setDashboardData] = useState({
    requests: [],
    reports: [],
    orders: [],
    products: [],
    projects: [],
    projectPayments: [],
    projectItems: [],
    suppliers: [],
  });

  useEffect(() => {
    const updateClock = () => {
      setCurrentTime(
        new Date().toLocaleTimeString("tr-TR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadDashboard = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const [
        requestsRes,
        reportsRes,
        ordersRes,
        productsRes,
        projectsRes,
        paymentsRes,
        projectItemsRes,
        suppliersRes,
      ] = await Promise.all([
        supabase.from("requests").select("*").eq("user_id", user.id),
        supabase.from("reports").select("*").eq("user_id", user.id),
        supabase.from("orders").select("*").eq("user_id", user.id),
        supabase.from("products").select("*").eq("user_id", user.id),
        supabase.from("projects").select("*").eq("user_id", user.id),
        supabase.from("project_payments").select("*").eq("user_id", user.id),
        supabase.from("project_items").select("*").eq("user_id", user.id),
        supabase.from("suppliers").select("*").eq("user_id", user.id),
      ]);

      setDashboardData({
        requests: requestsRes.data || [],
        reports: reportsRes.data || [],
        orders: ordersRes.data || [],
        products: productsRes.data || [],
        projects: projectsRes.data || [],
        projectPayments: paymentsRes.data || [],
        projectItems: projectItemsRes.data || [],
        suppliers: suppliersRes.data || [],
      });
    };

    loadDashboard();
  }, []);

  const projectById = useMemo(() => {
    return Object.fromEntries(
      dashboardData.projects.map((project) => [project.id, project]),
    );
  }, [dashboardData.projects]);

  const intelligence = useMemo(() => {
    const orders = dashboardData.orders;
    const projects = dashboardData.projects;
    const products = dashboardData.products;
    const projectItems = dashboardData.projectItems;
    const payments = dashboardData.projectPayments;
    const reports = dashboardData.reports;
    const requests = dashboardData.requests;
    const suppliers = dashboardData.suppliers;

    const openOrders = orders.filter(
      (order) => !closedOrderStatuses.includes(order.status),
    );
    const delayedOrders = openOrders.filter((order) => {
      const remainingDays = daysUntil(order.termin_date);
      return (
        order.status === "Gecikti" ||
        (remainingDays !== null && remainingDays < 0)
      );
    });
    const weekDeliveries = openOrders.filter((order) => {
      const remainingDays = daysUntil(order.termin_date);
      return remainingDays !== null && remainingDays >= 0 && remainingDays <= 7;
    });
    const pendingApprovals = orders.filter((order) =>
      ["Onay Bekliyor", "Bekliyor", "Taslak"].includes(order.status),
    );
    const paymentPendingOrders = orders.filter(
      (order) =>
        orderRemainingPayment(order) > 0 && Number(order.total_amount || 0) > 0,
    );
    const paidButNotReceivedOrders = orders.filter(
      (order) =>
        orderPaidAmount(order) > 0 &&
        !closedOrderStatuses.includes(order.status) &&
        Number(order.received_total || 0) <= 0,
    );
    const criticalProducts = products.filter((product) => {
      const criticalLimit = productCriticalLimit(product);
      return (
        criticalLimit > 0 && Number(product.current_stock || 0) <= criticalLimit
      );
    });
    const activeProjects = projects.filter((project) =>
      activeProjectStatuses.includes(project.status),
    );
    const overBudgetProjects = projects.filter(
      (project) =>
        Number(project.estimated_budget || 0) > 0 &&
        Number(project.actual_cost || 0) >
          Number(project.estimated_budget || 0),
    );
    const delayedCollections = projects.filter((project) => {
      const paid = projectPaidAmount(project, payments);
      const remainingCollection = Number(project.contract_amount || 0) - paid;
      const remainingDays = daysUntil(project.planned_end_date);
      return (
        remainingCollection > 0 && remainingDays !== null && remainingDays < 0
      );
    });
    const productionOpenPanels = projectItems.filter((item) =>
      ["Üretime verildi", "Üretimde", "Montajda"].includes(item.status),
    );
    const readyToShipPanels = projectItems.filter((item) =>
      ["Sevke Hazır", "Sevk edildi"].includes(item.panel_status || item.status),
    );

    const orderReportIds = new Set(
      orders.map((order) => order.report_id).filter(Boolean),
    );
    const reportsWithoutOrders = reports.filter(
      (report) => report.id && !orderReportIds.has(report.id),
    );
    const requestsWithoutProject = requests.filter(
      (request) => !request.project_id,
    );
    const ordersWithoutProject = orders.filter((order) => !order.project_id);
    const ordersWithoutTermin = openOrders.filter(
      (order) => !order.termin_date,
    );
    const activeProjectsWithoutEndDate = activeProjects.filter(
      (project) => !project.planned_end_date,
    );
    const productsWithoutStockLimit = products.filter(
      (product) => productCriticalLimit(product) <= 0,
    );
    const riskyPartners = suppliers.filter((partner) =>
      ["Riskli", "Onay Bekliyor", "Pasif"].includes(partner.status),
    );

    const processGaps = [
      {
        title: "Siparişe dönmeyen rapor",
        count: reportsWithoutOrders.length,
        text: "Mukayese sonrası sipariş kararı bekliyor.",
        href: "/dashboard/raporlar",
        tone: "orange",
      },
      {
        title: "Projesiz sipariş",
        count: ordersWithoutProject.length,
        text: "Maliyet ve teslimat proje karlılığına bağlanmıyor.",
        href: "/dashboard/siparisler",
        tone: "blue",
      },
      {
        title: "Terminsiz açık sipariş",
        count: ordersWithoutTermin.length,
        text: "Gecikme takibi için termin tarihi girilmeli.",
        href: "/dashboard/siparisler",
        tone: "red",
      },
      {
        title: "Bitiş tarihi olmayan aktif proje",
        count: activeProjectsWithoutEndDate.length,
        text: "Tahsilat ve kapanış riski takip edilemiyor.",
        href: "/dashboard/projeler",
        tone: "orange",
      },
      {
        title: "Kritik stok limiti olmayan ürün",
        count: productsWithoutStockLimit.length,
        text: "Minimum stok tanımlanmadığı için uyarı üretilemez.",
        href: "/dashboard/stok",
        tone: "blue",
      },
      {
        title: "Projesiz talep listesi",
        count: requestsWithoutProject.length,
        text: "Talep hangi işe ait olduğu bilinmeden ilerliyor.",
        href: "/dashboard/talepler",
        tone: "blue",
      },
      {
        title: "Riskli iş ortağı",
        count: riskyPartners.length,
        text: "Pasif, riskli veya onay bekleyen kayıtlar kontrol edilmeli.",
        href: "/dashboard/tedarikciler",
        tone: "red",
      },
    ].filter((gap) => gap.count > 0);

    const workItems = [
      ...delayedOrders.slice(0, 4).map((order) => ({
        tone: "red",
        title: "Geciken sipariş",
        subject:
          order.order_no ||
          order.partner_name ||
          order.supplier_name ||
          "Sipariş",
        projectName: projectById[order.project_id]?.project_name,
        description: `${order.partner_name || order.supplier_name || "İş ortağı"} teslim tarihi geçti. Termin: ${order.termin_date || "-"}.`,
        href: `/dashboard/siparisler/${order.id}`,
      })),
      ...criticalProducts.slice(0, 3).map((product) => ({
        tone: "red",
        title: "Kritik stok",
        subject: product.product_name || "Ürün",
        projectName: "",
        description: `Mevcut stok ${Number(product.current_stock || 0)} ${product.unit || "adet"}, kritik seviye ${productCriticalLimit(product)}.`,
        href: "/dashboard/stok",
      })),
      ...weekDeliveries.slice(0, 4).map((order) => ({
        tone: "orange",
        title: "Bu hafta teslim",
        subject:
          order.order_no ||
          order.partner_name ||
          order.supplier_name ||
          "Sipariş",
        projectName: projectById[order.project_id]?.project_name,
        description: `${daysUntil(order.termin_date)} gün içinde teslim bekleniyor. İş ortağı: ${order.partner_name || order.supplier_name || "-"}.`,
        href: `/dashboard/siparisler/${order.id}`,
      })),
      ...overBudgetProjects.slice(0, 3).map((project) => ({
        tone: "orange",
        title: "Bütçeyi aşan proje",
        subject: project.project_name,
        projectName: project.project_code,
        description: `Gerçekleşen maliyet ${formatMoney(project.actual_cost)}, tahmini bütçe ${formatMoney(project.estimated_budget)}.`,
        href: `/dashboard/projeler/${project.id}`,
      })),
      ...pendingApprovals.slice(0, 3).map((order) => ({
        tone: "green",
        title: "Onay bekleyen sipariş",
        subject:
          order.order_no ||
          order.partner_name ||
          order.supplier_name ||
          "Sipariş",
        projectName: projectById[order.project_id]?.project_name,
        description: "Sipariş durumu onay veya takip bekliyor.",
        href: `/dashboard/siparisler/${order.id}`,
      })),
      ...paidButNotReceivedOrders.slice(0, 3).map((order) => ({
        tone: "blue",
        title: "Ödendi ama ürün gelmedi",
        subject:
          order.order_no ||
          order.partner_name ||
          order.supplier_name ||
          "Sipariş",
        projectName: projectById[order.project_id]?.project_name,
        description: `${formatMoney(orderPaidAmount(order))} ödeme var, teslim kaydı henüz tamamlanmamış.`,
        href: `/dashboard/siparisler/${order.id}`,
      })),
      ...productionOpenPanels.slice(0, 3).map((item) => ({
        tone: "blue",
        title: "Üretimde açık pano",
        subject: item.product_name || "Pano",
        projectName: projectById[item.project_id]?.project_name,
        description: `Durum: ${item.status}. Üretim tamamlanma takibi gerekiyor.`,
        href: `/dashboard/projeler/${item.project_id}`,
      })),
      ...readyToShipPanels.slice(0, 3).map((item) => ({
        tone: "green",
        title: "Sevke hazır pano",
        subject: item.product_name || "Pano",
        projectName: projectById[item.project_id]?.project_name,
        description: "Sevk veya kapanış işlemi için kontrol edilebilir.",
        href: `/dashboard/projeler/${item.project_id}`,
      })),
      ...delayedCollections.slice(0, 3).map((project) => ({
        tone: "orange",
        title: "Tahsilatı geciken proje",
        subject: project.project_name,
        projectName: project.project_code,
        description: `Bekleyen tahsilat: ${formatMoney(Number(project.contract_amount || 0) - projectPaidAmount(project, payments))}.`,
        href: `/dashboard/projeler/${project.id}`,
      })),
    ].slice(0, 12);

    const recentActivities = [
      ...reports.map((report) => ({
        type: "Rapor",
        title:
          report.ad ||
          report.name ||
          report.report_name ||
          report.file_name ||
          "Mukayese raporu",
        date: report.created_at,
        href: report.id ? `/dashboard/raporlar/${report.id}` : "/dashboard/raporlar",
      })),
      ...orders.map((order) => ({
        type: "Siparis",
        title: order.order_no || order.partner_name || order.supplier_name || "Siparis",
        date: order.created_at || order.order_date,
        href: order.id ? `/dashboard/siparisler/${order.id}` : "/dashboard/siparisler",
      })),
      ...requests.map((request) => ({
        type: "Talep",
        title:
          request.name ||
          request.fileName ||
          request.file_name ||
          request.ad ||
          "Talep listesi",
        date: request.created_at,
        href: "/dashboard/talepler",
      })),
      ...projects.map((project) => ({
        type: "Proje",
        title: project.project_name || project.project_code || "Proje",
        date: project.updated_at || project.created_at,
        href: project.id ? `/dashboard/projeler/${project.id}` : "/dashboard/projeler",
      })),
    ]
      .filter((activity) => activity.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);

    return {
      activeProjects,
      delayedOrders,
      weekDeliveries,
      pendingApprovals,
      paymentPendingOrders,
      criticalProducts,
      overBudgetProjects,
      workItems,
      processGaps,
      recentActivities,
    };
  }, [dashboardData, projectById]);

  return (
    <div className="flex min-h-screen bg-slate-100">
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h1 className="text-4xl font-bold text-slate-900">
                  CORVIAN Business Suite
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                  Bugünkü takip işleri, proje riskleri, sipariş teslimleri ve
                  stok uyarıları tek ekranda toplanır.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-slate-500">Bugün</div>
                  <div className="mt-1 font-bold text-slate-900">
                    {new Date().toLocaleDateString("tr-TR", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-slate-500">Saat</div>
                  <div className="mt-1 font-bold text-slate-900">
                    {currentTime}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-slate-500">İş Merkezi</div>
                  <div className="mt-1 font-bold text-slate-900">
                    {intelligence.workItems.length} açık iş
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-7">
            <StatCard
              icon="📁"
              title="Aktif Projeler"
              value={intelligence.activeProjects.length}
              text="Onaylı/devam eden"
              href="/dashboard/projeler"
              tone="blue"
            />
            <StatCard
              icon="⏰"
              title="Geciken Siparişler"
              value={intelligence.delayedOrders.length}
              text="Termin aşımı"
              href="/dashboard/siparisler"
              tone="red"
            />
            <StatCard
              icon="📦"
              title="Kritik Stok"
              value={intelligence.criticalProducts.length}
              text="Minimum altında"
              href="/dashboard/stok"
              tone="orange"
            />
            <StatCard
              icon="🚚"
              title="Bu Hafta Teslimatlar"
              value={intelligence.weekDeliveries.length}
              text="7 gün içinde"
              href="/dashboard/siparisler"
              tone="green"
            />
            <StatCard
              icon="✅"
              title="Onay Bekleyenler"
              value={intelligence.pendingApprovals.length}
              text="Takip bekliyor"
              href="/dashboard/siparisler"
              tone="blue"
            />
            <StatCard
              icon="₺"
              title="Ödeme Bekleyen"
              value={intelligence.paymentPendingOrders.length}
              text="Kalan ödeme var"
              href="/dashboard/siparisler"
              tone="orange"
            />
            <StatCard
              icon="📉"
              title="Bütçeyi Aşan"
              value={intelligence.overBudgetProjects.length}
              text="Proje riski"
              href="/dashboard/projeler"
              tone="red"
            />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-900">
                  Süreç Açıkları
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Satınalma akışında rapor, proje, termin, stok limiti veya iş
                  ortağı bağlantısı eksik kalan kayıtlar.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">
                {intelligence.processGaps.length} konu
              </span>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {intelligence.processGaps.map((gap) => (
                <ProcessGapCard key={gap.title} gap={gap} />
              ))}
              {intelligence.processGaps.length === 0 && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-bold text-emerald-900 md:col-span-2 xl:col-span-3">
                  Temel akış bağlantılarında belirgin bir eksik görünmüyor.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-900">
                  İş Merkezi
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Bugün bakılması gereken sipariş, stok, proje ve üretim
                  aksiyonları.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">
                  Acil
                </span>
                <span className="rounded-full bg-orange-100 px-3 py-1 text-orange-700">
                  Risk
                </span>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
                  Tamamlanabilir
                </span>
                <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700">
                  Bilgi
                </span>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
              {intelligence.workItems.map((item, index) => (
                <WorkItemCard
                  key={`${item.title}-${item.subject}-${index}`}
                  item={item}
                />
              ))}
              {intelligence.workItems.length === 0 && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-bold text-emerald-900 xl:col-span-2">
                  Bugün müdahale gerektiren kritik iş görünmüyor.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-900">
                  Son Aktiviteler
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Son olusan rapor, siparis, talep ve proje hareketleri.
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">
                {intelligence.recentActivities.length} kayit
              </span>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
              {intelligence.recentActivities.map((activity, index) => (
                <Link
                  key={`${activity.type}-${activity.title}-${activity.date}-${index}`}
                  href={activity.href}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-blue-200 hover:bg-white"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase text-blue-700">
                      {activity.type}
                    </div>
                    <div className="mt-1 truncate text-sm font-black text-slate-900">
                      {activity.title}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs font-semibold text-slate-500">
                    {new Date(activity.date).toLocaleString("tr-TR")}
                  </div>
                </Link>
              ))}
              {intelligence.recentActivities.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm font-bold text-slate-600 md:col-span-2">
                  Henuz gosterilecek aktivite yok.
                </div>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ModuleCard
              icon="📚"
              title="Talepler"
              text="Müşteriden veya departmanlardan gelen talepleri oluşturun, yönetin ve icmal listesine dönüştürün."
              href="/dashboard/talepler"
              button="Talepleri Yönet"
              tone="purple"
            />
            <ModuleCard
              icon="📊"
              title="Teklifler"
              text="Tedarikçi tekliflerini yükleyin, analiz edin ve fiyat, vade, termin gibi kriterlere göre karşılaştırın."
              href="/dashboard/teklifler"
              button="Teklifleri Yönet"
              tone="blue"
            />
            <ModuleCard
              icon="🛒"
              title="Siparişler"
              text="Onaylanan tekliflerden sipariş oluşturun ve tüm satınalma sürecinizi takip edin."
              href="/dashboard/siparisler"
              button="Siparişleri Yönet"
              tone="green"
            />
            <ModuleCard
              icon="📄"
              title="Raporlar"
              text="Satınalma süreçlerinizi özetleyen raporları görüntüleyin, dışa aktarın ve arşivleyin."
              href="/dashboard/raporlar"
              button="Raporları Görüntüle"
              tone="orange"
            />
          </section>
        </div>
      </main>
    </div>
  );
}
