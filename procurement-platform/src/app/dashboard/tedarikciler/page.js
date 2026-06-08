"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  backfillProjectCustomerPartners,
  deduplicateBusinessPartners,
  findOrCreateBusinessPartner,
  normalizePartnerName,
  normalizePartnerRecord,
  partnerTypes,
} from "@/lib/businessPartners";
import { supabase } from "@/lib/supabase";

const emptyForm = {
  name: "",
  partner_type: "Tedarikçi",
  contact_person: "",
  phone: "",
  email: "",
  tax_number: "",
  city: "",
  address: "",
  notes: "",
  status: "Aktif",
};

const statusOptions = ["Tümü", "Aktif", "Pasif", "Onay Bekliyor", "Riskli"];

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

function addMoney(map, currency, amount) {
  const key = currency || "TRY";
  map.set(key, Number(map.get(key) || 0) + Number(amount || 0));
}

function moneyRows(map) {
  return Array.from(map.entries())
    .map(([currency, amount]) => ({ currency, amount }))
    .filter((row) => Math.abs(row.amount) > 0.0001)
    .sort((a, b) => a.currency.localeCompare(b.currency, "tr-TR"));
}

function projectContractCurrency(project) {
  return project?.contract_currency || project?.currency || "TRY";
}

function projectBudgetCurrency(project) {
  return project?.estimated_budget_currency || project?.contract_currency || project?.currency || "TRY";
}

function projectTitle(project) {
  return [project?.project_code, project?.project_name].filter(Boolean).join(" · ") || "Proje";
}

function statusClass(status) {
  const classes = {
    Aktif: "bg-green-100 text-green-700",
    Pasif: "bg-slate-100 text-slate-600",
    "Onay Bekliyor": "bg-yellow-100 text-yellow-700",
    Riskli: "bg-red-100 text-red-700",
  };

  return classes[status] || "bg-slate-100 text-slate-600";
}

function typeClass(type) {
  const classes = {
    Müşteri: "bg-blue-100 text-blue-700",
    Tedarikçi: "bg-emerald-100 text-emerald-700",
    Taşeron: "bg-purple-100 text-purple-700",
    Nakliye: "bg-orange-100 text-orange-700",
    "Hizmet Sağlayıcı": "bg-cyan-100 text-cyan-700",
    Diğer: "bg-slate-100 text-slate-700",
  };

  return classes[type] || classes.Diğer;
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

export default function BusinessPartnersPage() {
  const router = useRouter();
  const [partners, setPartners] = useState([]);
  const [projects, setProjects] = useState([]);
  const [orders, setOrders] = useState([]);
  const [projectPayments, setProjectPayments] = useState([]);
  const [orderPayments, setOrderPayments] = useState([]);
  const [movements, setMovements] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [typeFilter, setTypeFilter] = useState("Tümü");
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const [partnerRes, projectRes, orderRes, projectPaymentRes, orderPaymentRes, movementRes] = await Promise.all([
      supabase
        .from("suppliers")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true }),
      supabase
        .from("projects")
        .select("*")
        .eq("user_id", user.id),
      supabase
        .from("orders")
        .select("*")
        .eq("user_id", user.id),
      supabase
        .from("project_payments")
        .select("*")
        .eq("user_id", user.id),
      supabase
        .from("order_payments")
        .select("*")
        .eq("user_id", user.id),
      supabase
        .from("stock_movements")
        .select(
          "id,partner_id,partner_name,supplier_name,product_name,quantity,movement_type,movement_date",
        )
        .eq("user_id", user.id)
        .limit(500),
    ]);

    if (partnerRes.error) {
      console.error(partnerRes.error);
      setMessage(
        "İş ortakları yüklenemedi. SQL migration çalıştı mı kontrol edin.",
      );
      setPartners([]);
    } else {
      const backfillSummary = await backfillProjectCustomerPartners(
        supabase,
        user.id,
        projectRes.data || [],
        partnerRes.data || [],
      );
      const { data: partnersAfterBackfill } = await supabase
        .from("suppliers")
        .select("*")
        .eq("user_id", user.id)
        .order("name", { ascending: true });
      const dedupeSummary = await deduplicateBusinessPartners(
        supabase,
        user.id,
        partnersAfterBackfill || partnerRes.data || [],
      );
      const shouldReloadPartners =
        backfillSummary.createdCustomers > 0 ||
        backfillSummary.linkedProjects > 0 ||
        backfillSummary.existingCustomers > 0 ||
        dedupeSummary.duplicateCount > 0;
      const { data: refreshedPartnerData } = shouldReloadPartners
        ? await supabase
            .from("suppliers")
            .select("*")
            .eq("user_id", user.id)
            .order("name", { ascending: true })
        : { data: partnerRes.data || [] };
      const { data: refreshedProjectData } = shouldReloadPartners
        ? await supabase
            .from("projects")
            .select("*")
            .eq("user_id", user.id)
        : { data: projectRes.data || [] };
      const rows = (refreshedPartnerData || [])
        .map(normalizePartnerRecord)
        .filter((partner) => partner.status !== "Silindi");
      setPartners(rows);
      setProjects(refreshedProjectData || []);
      setMessage("");
    }

    if (partnerRes.error) setProjects(projectRes.data || []);
    setOrders(orderRes.data || []);
    setProjectPayments(projectPaymentRes.data || []);
    setOrderPayments(orderPaymentRes.data || []);
    setMovements(movementRes.data || []);
    setLoading(false);
  }

  const partnerStats = useMemo(() => {
    return {
      total: partners.length,
      customers: partners.filter(
        (partner) => partner.partner_type === "Müşteri",
      ).length,
      suppliers: partners.filter(
        (partner) => partner.partner_type === "Tedarikçi",
      ).length,
      risk: partners.filter((partner) =>
        ["Riskli", "Pasif", "Onay Bekliyor"].includes(partner.status),
      ).length,
    };
  }, [partners]);

  // Initial page hydration only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadData reads current auth state on mount.
  useEffect(() => {
    loadData();
  }, []);

  const metricsFor = useCallback(
    (partner) => {
      const key = normalizePartnerName(partner.name);
      const partnerOrders = orders.filter((order) => {
        if (order.partner_id && order.partner_id === partner.id) return true;
        return (
          normalizePartnerName(order.partner_name || order.supplier_name) ===
          key
        );
      });
      const partnerProjects = projects.filter((project) => {
        if (
          project.customer_partner_id &&
          project.customer_partner_id === partner.id
        )
          return true;
        return (
          normalizePartnerName(
            project.customer_partner_name || project.customer_name,
          ) === key
        );
      });
      const partnerProjectIds = new Set(partnerProjects.map((project) => project.id));
      const projectOrders = orders.filter((order) => order.project_id && partnerProjectIds.has(order.project_id));
      const allRelatedOrders = [...new Map([...partnerOrders, ...projectOrders].map((order) => [order.id, order])).values()];
      const relatedOrderIds = new Set(allRelatedOrders.map((order) => order.id));
      const partnerProjectPayments = projectPayments.filter((payment) => partnerProjectIds.has(payment.project_id));
      const partnerOrderPayments = orderPayments.filter((payment) => relatedOrderIds.has(payment.order_id));
      const partnerMovements = movements.filter((movement) => {
        if (movement.partner_id && movement.partner_id === partner.id)
          return true;
        return (
          normalizePartnerName(
            movement.partner_name || movement.supplier_name,
          ) === key
        );
      });

      const contractTotals = new Map();
      const estimatedTotals = new Map();
      const receivedPaymentTotals = new Map();
      const pendingPaymentTotals = new Map();
      const projectOrderTotals = new Map();
      const orderPaymentTotals = new Map();
      const supplierDebtTotals = new Map();
      const profitTotals = new Map();

      partnerProjects.forEach((project) => {
        const contractCurrency = projectContractCurrency(project);
        const budgetCurrency = projectBudgetCurrency(project);
        const contractAmount = Number(project.contract_amount || 0);
        const estimatedBudget = Number(project.estimated_budget || project.actual_cost || 0);
        const projectPaymentsTotal = partnerProjectPayments
          .filter((payment) => payment.project_id === project.id)
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const orderTotal = orders
          .filter((order) => order.project_id === project.id)
          .reduce((sum, order) => sum + Number(order.total_amount || order.order_total || order.total || 0), 0);

        addMoney(contractTotals, contractCurrency, contractAmount);
        addMoney(estimatedTotals, budgetCurrency, estimatedBudget);
        addMoney(receivedPaymentTotals, contractCurrency, projectPaymentsTotal);
        addMoney(pendingPaymentTotals, contractCurrency, Math.max(contractAmount - projectPaymentsTotal, 0));
        addMoney(projectOrderTotals, budgetCurrency, orderTotal);
        addMoney(profitTotals, contractCurrency, contractAmount - orderTotal);
      });

      allRelatedOrders.forEach((order) => {
        const currency = order.currency || order.para_birimi || "TRY";
        const orderAmount = Number(order.total_amount || order.order_total || order.total || 0);
        const paidAmount = partnerOrderPayments
          .filter((payment) => payment.order_id === order.id)
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0) || Number(order.paid_amount || 0);

        addMoney(orderPaymentTotals, currency, paidAmount);
        addMoney(supplierDebtTotals, currency, Math.max(orderAmount - paidAmount, 0));
      });

      const projectRows = partnerProjects.map((project) => {
        const contractCurrency = projectContractCurrency(project);
        const budgetCurrency = projectBudgetCurrency(project);
        const projectPaymentRows = partnerProjectPayments.filter((payment) => payment.project_id === project.id);
        const projectOrderRows = orders.filter((order) => order.project_id === project.id);
        const paid = projectPaymentRows.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const contract = Number(project.contract_amount || 0);
        const orderTotal = projectOrderRows.reduce((sum, order) => sum + Number(order.total_amount || order.order_total || order.total || 0), 0);

        return {
          ...project,
          contractCurrency,
          budgetCurrency,
          paid,
          pending: Math.max(contract - paid, 0),
          orderTotal,
          profitLoss: contract - orderTotal,
          paymentRows: projectPaymentRows,
          orderRows: projectOrderRows,
        };
      });

      return {
        orders: partnerOrders,
        relatedOrders: allRelatedOrders,
        projectOrders,
        projects: partnerProjects,
        projectRows,
        projectPayments: partnerProjectPayments,
        orderPayments: partnerOrderPayments,
        movements: partnerMovements,
        totalOrderAmount: partnerOrders.reduce(
          (sum, order) => sum + Number(order.total_amount || 0),
          0,
        ),
        contractTotals: moneyRows(contractTotals),
        estimatedTotals: moneyRows(estimatedTotals),
        receivedPaymentTotals: moneyRows(receivedPaymentTotals),
        pendingPaymentTotals: moneyRows(pendingPaymentTotals),
        projectOrderTotals: moneyRows(projectOrderTotals),
        orderPaymentTotals: moneyRows(orderPaymentTotals),
        supplierDebtTotals: moneyRows(supplierDebtTotals),
        profitTotals: moneyRows(profitTotals),
      };
    },
    [orders, projects, projectPayments, orderPayments, movements],
  );

  const enrichedPartners = useMemo(
    () =>
      partners.map((partner) => ({
        ...partner,
        metrics: metricsFor(partner),
      })),
    [partners, metricsFor],
  );

  const filteredPartners = useMemo(() => {
    const needle = normalizePartnerName(search);
    return enrichedPartners.filter((partner) => {
      const typeMatch =
        typeFilter === "Tümü" || partner.partner_type === typeFilter;
      const statusMatch =
        statusFilter === "Tümü" || partner.status === statusFilter;
      const searchMatch = needle
        ? normalizePartnerName(
            [
              partner.name,
              partner.partner_type,
              partner.contact_person,
              partner.phone,
              partner.email,
              partner.city,
              partner.tax_number,
            ].join(" "),
          ).includes(needle)
        : true;

      return typeMatch && statusMatch && searchMatch;
    });
  }, [enrichedPartners, search, typeFilter, statusFilter]);

  const selectedPartner =
    enrichedPartners.find((partner) => partner.id === selectedId) ||
    null;

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
    setDetailOpen(false);
    setMessage("");
  }

  function startEdit(partner) {
    setEditingId(partner.id);
    setSelectedId(partner.id);
    setFormOpen(true);
    setDetailOpen(true);
    setForm({
      name: partner.name || "",
      partner_type: partner.partner_type || "Tedarikçi",
      contact_person: partner.contact_person || "",
      phone: partner.phone || "",
      email: partner.email || "",
      tax_number: partner.tax_number || "",
      city: partner.city || "",
      address: partner.address || "",
      notes: partner.notes || "",
      status: partner.status || "Aktif",
    });
    setMessage("");
  }

  async function savePartner(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const cleanName = form.name.trim().replace(/\s+/g, " ");
    if (!cleanName) {
      setMessage("İş ortağı adı zorunlu.");
      setSaving(false);
      return;
    }

    const payload = {
      user_id: user.id,
      name: cleanName,
      partner_type: form.partner_type || "Diğer",
      category: form.partner_type || "Diğer",
      normalized_name: normalizePartnerName(cleanName),
      contact_person: form.contact_person || "",
      contact_name: form.contact_person || "",
      phone: form.phone || "",
      email: form.email || "",
      tax_number: form.tax_number || "",
      tax_no: form.tax_number || "",
      city: form.city || "",
      address: form.address || "",
      notes: form.notes || "",
      status: form.status || "Aktif",
      updated_at: new Date().toISOString(),
    };

    if (!editingId) {
      const partner = await findOrCreateBusinessPartner(supabase, user.id, {
        name: payload.name,
        partnerType: payload.partner_type,
        taxNumber: payload.tax_number,
        email: payload.email,
        phone: payload.phone,
        contactPerson: payload.contact_person,
        city: payload.city,
        address: payload.address,
        notes: payload.notes,
      });

      setSaving(false);

      if (!partner?.id) {
        setMessage("İş ortağı kaydedilemedi.");
        return;
      }

      setEditingId(partner.id);
      setSelectedId(partner.id);
      setFormOpen(false);
      setDetailOpen(true);
      setMessage(
        "İş ortağı kaydedildi. Benzer kayıt varsa mevcut karta bağlandı.",
      );
      await loadData();
      return;
    }

    const request = supabase
      .from("suppliers")
      .update(payload)
      .eq("id", editingId)
      .eq("user_id", user.id)
      .select("*")
      .single();

    const { data, error } = await request;
    setSaving(false);

    if (error) {
      console.error(error);
      setMessage(error.message || "İş ortağı kaydedilemedi.");
      return;
    }

    setEditingId(data.id);
    setSelectedId(data.id);
    setFormOpen(false);
    setDetailOpen(true);
    setMessage("İş ortağı kaydedildi.");
    await loadData();
  }

  async function deletePartner(partner) {
    if (!partner?.id) return;

    if (
      !window.confirm(
        "Bu iş ortağı silinsin mi? Bağlı kayıt varsa geçmiş bozulmasın diye kayıt listeden kaldırılır.",
      )
    ) {
      return;
    }

    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const currentMetrics = metricsFor(partner);
    const [paymentRes, receiptRes, reportRes] = await Promise.all([
      supabase
        .from("order_payments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("partner_id", partner.id),
      supabase
        .from("order_receipts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("partner_id", partner.id),
      supabase
        .from("reports")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("partner_id", partner.id),
    ]);

    const relationError =
      paymentRes.error || receiptRes.error || reportRes.error;
    if (relationError) {
      console.error("İş ortağı bağlantı kontrol hatası:", relationError);
      setMessage(relationError.message || "Bağlı kayıt kontrolü yapılamadı.");
      return;
    }

    const linkedCount =
      currentMetrics.orders.length +
      currentMetrics.projects.length +
      currentMetrics.movements.length +
      Number(paymentRes.count || 0) +
      Number(receiptRes.count || 0) +
      Number(reportRes.count || 0);

    console.log("İş ortağı silme kontrolü", {
      partnerId: partner.id,
      partnerName: partner.name,
      projects: currentMetrics.projects.length,
      orders: currentMetrics.orders.length,
      stockMovements: currentMetrics.movements.length,
      payments: paymentRes.count || 0,
      receipts: receiptRes.count || 0,
      reports: reportRes.count || 0,
      linkedCount,
    });

    if (linkedCount > 0) {
      const { data, error } = await supabase
        .from("suppliers")
        .update({
          status: "Silindi",
          updated_at: new Date().toISOString(),
        })
        .eq("id", partner.id)
        .eq("user_id", user.id)
        .select("id,status")
        .single();

      console.log("İş ortağı pasife alma sonucu", { data, error, linkedCount });

      if (error) {
        console.error("İş ortağı pasife alınamadı:", error);
        setMessage(error.message || "İş ortağı pasife alınamadı.");
        return;
      }

      setMessage(
        "Bu iş ortağı bağlı kayıtları olduğu için geçmişten koparılmadı, aktif listeden kaldırıldı.",
      );
      setSelectedId(null);
      setEditingId((current) => (current === partner.id ? null : current));
      await loadData();
      return;
    }

    const { data, error } = await supabase
      .from("suppliers")
      .delete()
      .eq("id", partner.id)
      .eq("user_id", user.id)
      .select("id");

    console.log("İş ortağı fiziksel silme sonucu", { data, error });

    if (error) {
      console.error("İş ortağı silinemedi:", error);
      setMessage(error.message || "İş ortağı silinemedi.");
      return;
    }

    setMessage("İş ortağı silindi.");
    setSelectedId(null);
    setEditingId(null);
    setDetailOpen(false);
    await loadData();
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
            Ticari taraf merkezi
          </div>
          <h1 className="mt-3 text-4xl font-black text-slate-950">
            İş Ortakları
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Müşteri, tedarikçi, taşeron, nakliye firması ve hizmet sağlayıcıları
            tek merkezden yönetin.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700"
        >
          + Yeni İş Ortağı
        </button>
      </div>

      {message && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard
          title="Toplam İş Ortağı"
          value={partnerStats.total}
          text="Tüm ticari taraflar"
        />
        <StatCard
          title="Müşteri"
          value={partnerStats.customers}
          text="Proje bağlantılı"
        />
        <StatCard
          title="Tedarikçi"
          value={partnerStats.suppliers}
          text="Teklif ve sipariş tarafı"
        />
        <StatCard
          title="Risk / Pasif"
          value={partnerStats.risk}
          text="İzlenmesi gereken kayıt"
        />
      </div>

      {formOpen && (
        <form
          onSubmit={savePartner}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-slate-950">
                {editingId ? "İş Ortağını Düzenle" : "Yeni İş Ortağı"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Firma kimliği, iletişim ve ticari durum bilgilerini düzenleyin.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Kapat
            </button>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-12">
            <label className="text-sm font-bold text-slate-700 md:col-span-12">
              İş ortağı adı
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.name}
                onChange={(event) => updateForm("name", event.target.value)}
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-6">
              Tür
              <select
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.partner_type}
                onChange={(event) =>
                  updateForm("partner_type", event.target.value)
                }
              >
                {partnerTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-6">
              Durum
              <select
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.status}
                onChange={(event) => updateForm("status", event.target.value)}
              >
                {statusOptions
                  .filter((status) => status !== "Tümü")
                  .map((status) => (
                    <option key={status}>{status}</option>
                  ))}
              </select>
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-6">
              Yetkili
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.contact_person}
                onChange={(event) =>
                  updateForm("contact_person", event.target.value)
                }
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-6">
              Telefon
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.phone}
                onChange={(event) => updateForm("phone", event.target.value)}
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-7">
              E-posta
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.email}
                onChange={(event) => updateForm("email", event.target.value)}
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-5">
              Vergi no
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.tax_number}
                onChange={(event) =>
                  updateForm("tax_number", event.target.value)
                }
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-12">
              Şehir
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.city}
                onChange={(event) => updateForm("city", event.target.value)}
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-12">
              Adres
              <input
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.address}
                onChange={(event) => updateForm("address", event.target.value)}
              />
            </label>
            <label className="text-sm font-bold text-slate-700 md:col-span-12">
              Notlar
              <textarea
                rows={4}
                className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={form.notes}
                onChange={(event) => updateForm("notes", event.target.value)}
              />
            </label>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300"
            >
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={startCreate}
                className="rounded-xl border border-slate-300 px-6 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Yeni kayıt
              </button>
            )}
          </div>
        </form>
      )}

      <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px_180px]">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="İş ortağı adı, telefon, e-posta veya şehir ara..."
                className="rounded-xl border border-slate-300 p-3 text-sm"
              />
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm font-bold"
              >
                <option>Tümü</option>
                {partnerTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm font-bold"
              >
                {statusOptions.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-xl font-bold text-slate-900">
                İş Ortağı Listesi
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {loading
                  ? "Yükleniyor..."
                  : `${filteredPartners.length} kayıt gösteriliyor.`}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-4">İş ortağı</th>
                    <th className="p-4">Tür</th>
                    <th className="p-4">Yetkili</th>
                    <th className="p-4">İletişim</th>
                    <th className="p-4">Şehir</th>
                    <th className="p-4">Sipariş</th>
                    <th className="p-4">Toplam alış</th>
                    <th className="p-4">Projeler</th>
                    <th className="p-4">Durum</th>
                    <th className="p-4 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPartners.map((partner) => (
                    <tr
                      key={partner.id}
                      onClick={() => setSelectedId(partner.id)}
                      className={`cursor-pointer border-t border-slate-100 hover:bg-blue-50 ${selectedPartner?.id === partner.id ? "bg-blue-50" : ""}`}
                    >
                      <td className="p-4 font-black text-slate-900">
                        {partner.name}
                      </td>
                      <td className="p-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${typeClass(partner.partner_type)}`}
                        >
                          {partner.partner_type}
                        </span>
                      </td>
                      <td className="p-4">{partner.contact_person || "-"}</td>
                      <td className="p-4">
                        <div>{partner.phone || "-"}</div>
                        <div className="text-xs text-slate-500">
                          {partner.email || "-"}
                        </div>
                      </td>
                      <td className="p-4">{partner.city || "-"}</td>
                      <td className="p-4 font-bold">
                        {partner.metrics.orders.length}
                      </td>
                      <td className="p-4 font-bold">
                        {formatMoney(partner.metrics.totalOrderAmount)}
                      </td>
                      <td className="p-4 font-bold">
                        {partner.metrics.projects.length}
                      </td>
                      <td className="p-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(partner.status)}`}
                        >
                          {partner.status || "Aktif"}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedId(partner.id);
                              setFormOpen(false);
                              setDetailOpen(true);
                            }}
                            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
                          >
                            Detay
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              startEdit(partner);
                            }}
                            className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              deletePartner(partner);
                            }}
                            className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                          >
                            Sil
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && filteredPartners.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-500">
                Kayıt bulunamadı.
              </div>
            )}
          </div>

          {detailOpen && selectedPartner && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-blue-600">
                    İş ortağı detayı
                  </div>
                  <h2 className="mt-1 text-2xl font-black text-slate-900">
                    {selectedPartner.name}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${typeClass(selectedPartner.partner_type)}`}
                    >
                      {selectedPartner.partner_type}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(selectedPartner.status)}`}
                    >
                      {selectedPartner.status || "Aktif"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(selectedPartner)}
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
                  >
                    Düzenle
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePartner(selectedPartner)}
                    className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700 hover:bg-red-100"
                  >
                    Sil
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailOpen(false)}
                    className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Kapat
                  </button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <Info label="Yetkili" value={selectedPartner.contact_person} />
                <Info label="Telefon" value={selectedPartner.phone} />
                <Info label="E-posta" value={selectedPartner.email} />
                <Info label="Vergi No" value={selectedPartner.tax_number} />
                <Info label="Şehir" value={selectedPartner.city} />
                <Info label="Adres" value={selectedPartner.address} />
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MoneySummary title="Sözleşme Bedeli" rows={selectedPartner.metrics.contractTotals} empty="0,00" />
                <MoneySummary title="Alınan Ödemeler" rows={selectedPartner.metrics.receivedPaymentTotals} empty="0,00" tone="green" />
                <MoneySummary title="Bekleyen Tahsilat" rows={selectedPartner.metrics.pendingPaymentTotals} empty="0,00" tone="orange" />
                <MoneySummary title="Proje Siparişleri" rows={selectedPartner.metrics.projectOrderTotals} empty="0,00" />
                <MoneySummary title="Sipariş Ödemeleri" rows={selectedPartner.metrics.orderPaymentTotals} empty="0,00" tone="green" />
                <MoneySummary title="Kalan İş Ortağı Borcu" rows={selectedPartner.metrics.supplierDebtTotals} empty="0,00" tone="red" />
                <MoneySummary title="Tahmini / Maliyet" rows={selectedPartner.metrics.estimatedTotals} empty="0,00" />
                <MoneySummary title="Kâr / Zarar" rows={selectedPartner.metrics.profitTotals} empty="0,00" tone="blue" />
              </div>

              <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
                <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-black text-slate-950">Bağlı Projeler ve Finans</div>
                    <div className="text-xs font-semibold text-slate-500">
                      {selectedPartner.metrics.projectRows.length} proje · sözleşme, tahsilat, bekleyen ödeme ve sipariş maliyeti
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push(`/dashboard/finans?is_ortagi=${encodeURIComponent(selectedPartner.name)}`)}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                  >
                    Finans ekranına git
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(`/dashboard/projeler?musteri=${encodeURIComponent(selectedPartner.name)}`)}
                    className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50"
                  >
                    Projeler sayfasında göster
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-white text-xs uppercase text-slate-500">
                      <tr>
                        <th className="p-4">Proje</th>
                        <th className="p-4">Sözleşme</th>
                        <th className="p-4">Tahsilat</th>
                        <th className="p-4">Bekleyen</th>
                        <th className="p-4">Sipariş</th>
                        <th className="p-4">Kâr / Zarar</th>
                        <th className="p-4 text-right">İşlem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPartner.metrics.projectRows.map((project) => (
                        <tr key={project.id} className="border-t border-slate-100">
                          <td className="p-4">
                            <div className="font-black text-slate-950">{projectTitle(project)}</div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">{project.status || "-"}</div>
                          </td>
                          <td className="p-4 font-bold">{formatMoney(project.contract_amount, project.contractCurrency)}</td>
                          <td className="p-4 font-bold text-emerald-700">{formatMoney(project.paid, project.contractCurrency)}</td>
                          <td className="p-4 font-bold text-orange-700">{formatMoney(project.pending, project.contractCurrency)}</td>
                          <td className="p-4 font-bold">{formatMoney(project.orderTotal, project.budgetCurrency)}</td>
                          <td className={`p-4 font-black ${project.profitLoss < 0 ? "text-red-700" : "text-emerald-700"}`}>
                            {formatMoney(project.profitLoss, project.contractCurrency)}
                          </td>
                          <td className="p-4 text-right">
                            <button
                              type="button"
                              onClick={() => router.push(`/dashboard/projeler/${project.id}`)}
                              className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                            >
                              Projeyi Aç
                            </button>
                          </td>
                        </tr>
                      ))}
                      {selectedPartner.metrics.projectRows.length === 0 && (
                        <tr>
                          <td colSpan="7" className="p-8 text-center text-slate-500">
                            Bu iş ortağına bağlı proje yok.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <PaymentTimeline
                  title="Proje Ödeme / Tahsilat Hareketleri"
                  rows={selectedPartner.metrics.projectPayments}
                  projectRows={selectedPartner.metrics.projectRows}
                />
                <PaymentTimeline
                  title="Sipariş Ödeme Hareketleri"
                  rows={selectedPartner.metrics.orderPayments}
                  orders={selectedPartner.metrics.relatedOrders}
                />
              </div>

              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                <div className="font-bold text-slate-900">Notlar</div>
                <div className="mt-1">
                  {selectedPartner.notes || "Not bulunmuyor."}
                </div>
              </div>
            </div>
          )}
        </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-slate-900">
        {value || "-"}
      </div>
    </div>
  );
}

function MoneySummary({ title, rows, empty = "0,00", tone = "slate" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-950",
    green: "bg-emerald-50 text-emerald-800",
    orange: "bg-orange-50 text-orange-800",
    red: "bg-red-50 text-red-800",
    blue: "bg-blue-50 text-blue-800",
  };

  return (
    <div className={`rounded-xl p-4 ${tones[tone] || tones.slate}`}>
      <div className="text-xs font-black uppercase tracking-wide opacity-70">{title}</div>
      <div className="mt-2 space-y-1">
        {rows?.length > 0 ? (
          rows.map((row) => (
            <div key={`${title}-${row.currency}`} className="break-words text-lg font-black leading-tight">
              {formatMoney(row.amount, row.currency)}
            </div>
          ))
        ) : (
          <div className="text-lg font-black leading-tight">{empty}</div>
        )}
      </div>
    </div>
  );
}

function PaymentTimeline({ title, rows, projectRows = [], orders = [] }) {
  const projectById = new Map(projectRows.map((project) => [project.id, project]));
  const orderById = new Map(orders.map((order) => [order.id, order]));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="font-black text-slate-950">{title}</div>
      <div className="mt-3 space-y-2">
        {rows?.length > 0 ? (
          rows.slice(0, 12).map((row) => {
            const project = projectById.get(row.project_id);
            const order = orderById.get(row.order_id);
            const label = project ? projectTitle(project) : order?.order_no || order?.product_name || "Bağlı kayıt";
            const amount = Number(row.amount || row.base_amount || 0);
            const currency = row.currency || row.base_currency || order?.currency || project?.contractCurrency || "TRY";

            return (
              <div key={row.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate font-black text-slate-900" title={label}>{label}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">
                      {formatDate(row.payment_date || row.date || row.created_at)} · {row.payment_type || row.type || row.method || "Ödeme"} · {row.description || row.note || "-"}
                    </div>
                  </div>
                  <div className="whitespace-nowrap font-black text-slate-950">{formatMoney(amount, currency)}</div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            Kayıt yok.
          </div>
        )}
      </div>
    </div>
  );
}

function DetailList({ title, rows }) {
  return (
    <div className="rounded-xl border border-slate-100 p-4">
      <div className="font-bold text-slate-900">{title}</div>
      <div className="mt-3 space-y-2">
        {rows.length > 0
          ? rows.map((row) => (
              <div
                key={`${title}-${row}`}
                className="rounded-lg bg-slate-50 p-3 text-xs font-semibold text-slate-600"
              >
                {row}
              </div>
            ))
          : <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              Kayıt yok.
            </div>}
      </div>
    </div>
  );
}
