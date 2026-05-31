"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { calculateBaseAmount, currencyOptions, formatMoney, getBaseCurrency, getExchangeRate } from "@/lib/currency";

const statusOptions = ["Taslak", "Onaylandı", "Devam Ediyor", "Tamamlandı", "Arşivlendi", "İptal"];

const emptyForm = {
  project_code: "",
  project_name: "",
  customer_name: "",
  description: "",
  contract_amount: "",
  contract_currency: "TRY",
  contract_exchange_rate: 1,
  estimated_budget: "",
  estimated_budget_currency: "TRY",
  estimated_budget_exchange_rate: 1,
  start_date: "",
  planned_end_date: "",
  project_owner: "",
  status: "Taslak",
};

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("tr-TR");
}

function nextProjectCode(projects) {
  const maxNumber = projects.reduce((max, project) => {
    const match = String(project.project_code || "").match(/PRJ-(\d+)/i);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);

  return `PRJ-${String(maxNumber + 1).padStart(5, "0")}`;
}

function statusClass(status) {
  const classes = {
    Taslak: "bg-slate-100 text-slate-700",
    Onaylandı: "bg-blue-100 text-blue-700",
    "Devam Ediyor": "bg-emerald-100 text-emerald-700",
    Tamamlandı: "bg-green-100 text-green-700",
    Arşivlendi: "bg-slate-200 text-slate-700",
    İptal: "bg-red-100 text-red-700",
  };

  return classes[status] || "bg-slate-100 text-slate-700";
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

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [relatedRows, setRelatedRows] = useState({
    items: [],
    requests: [],
    reports: [],
    orders: [],
    movements: [],
    payments: [],
  });
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState({ default_currency: "TRY", base_currency: "TRY" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    const [itemRes, requestRes, reportRes, orderRes, movementRes, paymentRes] = await Promise.all([
      supabase.from("project_items").select("*").eq("user_id", user.id),
      supabase.from("requests").select("id,project_id").eq("user_id", user.id),
      supabase.from("reports").select("id,project_id").eq("user_id", user.id),
      supabase.from("orders").select("*").eq("user_id", user.id),
      supabase.from("stock_movements").select("id,project_id").eq("user_id", user.id),
      supabase.from("project_payments").select("id,project_id").eq("user_id", user.id),
    ]);

    const { data: settingsData } = await supabase
      .from("company_settings")
      .select("*")
      .eq("user_id", user.id)
      .limit(1);

    if (settingsData?.[0]) setSettings(settingsData[0]);
    setRelatedRows({
      items: itemRes.data || [],
      requests: requestRes.data || [],
      reports: reportRes.data || [],
      orders: orderRes.data || [],
      movements: movementRes.data || [],
      payments: paymentRes.data || [],
    });

    if (error) {
      setMessage("Projeler tablosu hazır değil. Supabase şemasındaki proje bölümünü çalıştırın.");
      setProjects([]);
    } else {
      setMessage("");
      setProjects(data || []);
      setForm((prev) => ({
        ...prev,
        project_code: prev.project_code || nextProjectCode(data || []),
      }));
    }

    setLoading(false);
  }

  function openCreateForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      project_code: nextProjectCode(projects),
      contract_currency: settings.default_currency || "TRY",
      estimated_budget_currency: settings.default_currency || "TRY",
      contract_exchange_rate: getExchangeRate(settings.default_currency || "TRY", settings),
      estimated_budget_exchange_rate: getExchangeRate(settings.default_currency || "TRY", settings),
    });
    setShowForm(true);
  }

  function openEditForm(project) {
    setEditingId(project.id);
    setForm({
      ...emptyForm,
      project_code: project.project_code || "",
      project_name: project.project_name || "",
      customer_name: project.customer_name || "",
      description: project.description || "",
      contract_amount: project.contract_amount || "",
      contract_currency: project.contract_currency || settings.default_currency || "TRY",
      contract_exchange_rate: project.contract_exchange_rate || getExchangeRate(project.contract_currency || "TRY", settings),
      estimated_budget: project.estimated_budget || "",
      estimated_budget_currency: project.estimated_budget_currency || settings.default_currency || "TRY",
      estimated_budget_exchange_rate: project.estimated_budget_exchange_rate || getExchangeRate(project.estimated_budget_currency || "TRY", settings),
      start_date: project.start_date || "",
      planned_end_date: project.planned_end_date || "",
      project_owner: project.project_owner || "",
      status: project.status || "Taslak",
    });
    setShowForm(true);
    setMessage("");
  }

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function saveProject(event) {
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

    const payload = {
      user_id: user.id,
      project_code: form.project_code || nextProjectCode(projects),
      project_name: form.project_name.trim(),
      customer_name: form.customer_name.trim(),
      description: form.description.trim(),
      contract_amount: Number(form.contract_amount || 0),
      contract_currency: form.contract_currency || getBaseCurrency(settings),
      contract_exchange_rate: Number(form.contract_exchange_rate || getExchangeRate(form.contract_currency, settings)),
      contract_base_amount: calculateBaseAmount(form.contract_amount, form.contract_currency, settings, form.contract_exchange_rate),
      estimated_budget: Number(form.estimated_budget || 0),
      estimated_budget_currency: form.estimated_budget_currency || getBaseCurrency(settings),
      estimated_budget_exchange_rate: Number(form.estimated_budget_exchange_rate || getExchangeRate(form.estimated_budget_currency, settings)),
      estimated_budget_base_amount: calculateBaseAmount(form.estimated_budget, form.estimated_budget_currency, settings, form.estimated_budget_exchange_rate),
      start_date: form.start_date || null,
      planned_end_date: form.planned_end_date || null,
      project_owner: form.project_owner.trim(),
      status: form.status,
      updated_at: new Date().toISOString(),
    };
    if (!editingId) payload.actual_cost = 0;

    if (!payload.project_name) {
      setMessage("Proje adı zorunlu.");
      setSaving(false);
      return;
    }

    const request = editingId
      ? supabase
          .from("projects")
          .update(payload)
          .eq("id", editingId)
          .eq("user_id", user.id)
          .select("id")
          .single()
      : supabase
          .from("projects")
          .insert(payload)
          .select("id")
          .single();

    const { data, error } = await request;

    if (error) {
      setMessage("Proje kaydedilemedi. Proje kodu daha önce kullanılmış olabilir.");
      setSaving(false);
      return;
    }

    setSaving(false);
    setShowForm(false);
    setEditingId(null);
    await loadProjects();
    if (!editingId) router.push(`/dashboard/projeler/${data.id}`);
  }

  function projectMetrics(projectId) {
    const items = relatedRows.items.filter((item) => item.project_id === projectId);
    const orders = relatedRows.orders.filter((order) => order.project_id === projectId);
    const completedItems = items.filter((item) =>
      ["Depoda", "Tamamlandı", "Sevk edildi"].includes(item.status),
    ).length;
    const missingMaterials = items.filter((item) =>
      ["Satınalma gerekli", "Eksik geldi", "Tedarikçiden bekleniyor"].includes(item.status),
    ).length;
    const openOrders = orders.filter((order) =>
      !["Tam Teslim", "Teslim Edildi", "İptal"].includes(order.status),
    ).length;
    const dependencyCount =
      items.length +
      relatedRows.requests.filter((row) => row.project_id === projectId).length +
      relatedRows.reports.filter((row) => row.project_id === projectId).length +
      orders.length +
      relatedRows.movements.filter((row) => row.project_id === projectId).length +
      relatedRows.payments.filter((row) => row.project_id === projectId).length;

    return {
      completion: items.length > 0 ? Math.round((completedItems / items.length) * 100) : 0,
      openOrders,
      missingMaterials,
      dependencyCount,
    };
  }

  async function archiveProject(project) {
    const { error } = await supabase
      .from("projects")
      .update({
        status: "Arşivlendi",
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .eq("user_id", project.user_id);

    if (error) {
      setMessage("Proje arşivlenemedi. Supabase şemasında archived_at alanı çalıştırılmış olmalı.");
      return;
    }

    setMessage("Proje arşivlendi.");
    await loadProjects();
  }

  async function deleteProject(project) {
    const metrics = projectMetrics(project.id);

    if (metrics.dependencyCount > 0) {
      setMessage("Bu projeye bağlı talep, teklif, sipariş, stok hareketi veya ödeme var. Fiziksel silme güvenli değil; lütfen Arşivle aksiyonunu kullanın.");
      return;
    }

    const confirmed = window.confirm(`${project.project_name} kalıcı olarak silinsin mi?`);
    if (!confirmed) return;

    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", project.id)
      .eq("user_id", project.user_id);

    if (error) {
      setMessage("Proje silinemedi.");
      return;
    }

    setMessage("Proje silindi.");
    await loadProjects();
  }

  const stats = useMemo(() => {
    const activeStatuses = ["Onaylandı", "Devam Ediyor"];
    const active = projects.filter((project) => activeStatuses.includes(project.status)).length;
    const completed = projects.filter((project) => project.status === "Tamamlandı").length;
    const contractTotal = projects.reduce((sum, project) => sum + Number(project.contract_amount || 0), 0);
    const actualTotal = projects.reduce((sum, project) => sum + Number(project.actual_cost || 0), 0);
    const overBudget = projects.filter(
      (project) => Number(project.actual_cost || 0) > Number(project.estimated_budget || 0) && Number(project.estimated_budget || 0) > 0,
    ).length;

    return { active, completed, contractTotal, actualTotal, overBudget };
  }, [projects]);

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
              Proje Yönetimi
            </div>
            <h1 className="mt-3 text-4xl font-bold text-slate-900">Projeler</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Proje bazlı bütçe, satınalma, stok kullanımı ve tahsilat takibini buradan yönetin.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateForm}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
          >
            Yeni Proje
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <StatCard title="Aktif Proje" value={stats.active} text="Onaylı/devam eden" />
          <StatCard title="Tamamlanan" value={stats.completed} text="Kapanmış proje" />
          <StatCard title="Sözleşme Bedeli" value={formatMoney(stats.contractTotal)} text="Toplam" />
          <StatCard title="Gerçekleşen Maliyet" value={formatMoney(stats.actualTotal)} text="Şimdilik manuel/bağlantılı" />
          <StatCard title="Bütçeyi Aşan" value={stats.overBudget} text="Kontrol gerekli" />
        </div>

        {message && (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
            {message}
          </div>
        )}

        {showForm && (
          <form onSubmit={saveProject} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{editingId ? "Projeyi Düzenle" : "Yeni Proje Oluştur"}</h2>
                <p className="mt-1 text-sm text-slate-500">Proje kodu otomatik hazırlanır, gerekirse elle düzenlenebilir.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                Kapat
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="text-sm font-bold text-slate-700">
                Proje Kodu
                <input className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.project_code} onChange={(e) => updateForm("project_code", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Proje Adı
                <input className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.project_name} onChange={(e) => updateForm("project_name", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Müşteri Adı
                <input className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.customer_name} onChange={(e) => updateForm("customer_name", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700 md:col-span-3">
                Açıklama
                <textarea className="mt-2 w-full rounded-xl border border-slate-300 p-3" rows={3} value={form.description} onChange={(e) => updateForm("description", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Sözleşme Bedeli
                <input type="number" className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.contract_amount} onChange={(e) => updateForm("contract_amount", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Sözleşme Para Birimi
                <select className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.contract_currency} onChange={(e) => {
                  updateForm("contract_currency", e.target.value);
                  updateForm("contract_exchange_rate", getExchangeRate(e.target.value, settings));
                }}>
                  {currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-slate-700">
                Sözleşme Kuru
                <input type="number" className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.contract_exchange_rate} onChange={(e) => updateForm("contract_exchange_rate", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Tahmini Bütçe / Maliyet
                <input type="number" className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.estimated_budget} onChange={(e) => updateForm("estimated_budget", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Bütçe Para Birimi
                <select className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.estimated_budget_currency} onChange={(e) => {
                  updateForm("estimated_budget_currency", e.target.value);
                  updateForm("estimated_budget_exchange_rate", getExchangeRate(e.target.value, settings));
                }}>
                  {currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-slate-700">
                Bütçe Kuru
                <input type="number" className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.estimated_budget_exchange_rate} onChange={(e) => updateForm("estimated_budget_exchange_rate", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Proje Sorumlusu
                <input className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.project_owner} onChange={(e) => updateForm("project_owner", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Başlangıç Tarihi
                <input type="date" className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.start_date} onChange={(e) => updateForm("start_date", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Planlanan Bitiş
                <input type="date" className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.planned_end_date} onChange={(e) => updateForm("planned_end_date", e.target.value)} />
              </label>
              <label className="text-sm font-bold text-slate-700">
                Durum
                <select className="mt-2 w-full rounded-xl border border-slate-300 p-3" value={form.status} onChange={(e) => updateForm("status", e.target.value)}>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                {saving ? "Kaydediliyor..." : editingId ? "Projeyi Kaydet" : "Projeyi Oluştur"}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-xl font-bold text-slate-900">Proje Listesi</h2>
            <p className="mt-1 text-sm text-slate-500">
              {loading ? "Yükleniyor..." : `${projects.length} proje gösteriliyor.`}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-4">Proje</th>
                  <th className="p-4">Müşteri</th>
                  <th className="p-4">Sözleşme</th>
                  <th className="p-4">Tahmini</th>
                  <th className="p-4">Gerçekleşen</th>
                  <th className="p-4">Kalan Bütçe</th>
                  <th className="p-4">Tamamlanma</th>
                  <th className="p-4">Açık Sipariş</th>
                  <th className="p-4">Eksik Malzeme</th>
                  <th className="p-4">Tarih</th>
                  <th className="p-4">Durum</th>
                  <th className="p-4">İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const remaining = Number(project.estimated_budget || 0) - Number(project.actual_cost || 0);
                  const metrics = projectMetrics(project.id);

                  return (
                    <tr key={project.id} className="border-t border-slate-100 hover:bg-blue-50">
                      <td className="p-4">
                        <Link href={`/dashboard/projeler/${project.id}`} className="font-black text-blue-700 hover:underline">
                          {project.project_code || "-"}
                        </Link>
                        <div className="mt-1 font-bold text-slate-900">{project.project_name}</div>
                      </td>
                      <td className="p-4">{project.customer_name || "-"}</td>
                      <td className="p-4 font-bold">{formatMoney(project.contract_amount)}</td>
                      <td className="p-4">{formatMoney(project.estimated_budget)}</td>
                      <td className="p-4">{formatMoney(project.actual_cost)}</td>
                      <td className={`p-4 font-bold ${remaining < 0 ? "text-red-600" : "text-emerald-700"}`}>
                        {formatMoney(remaining)}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-blue-600" style={{ width: `${metrics.completion}%` }} />
                          </div>
                          <span className="font-bold text-slate-700">%{metrics.completion}</span>
                        </div>
                      </td>
                      <td className="p-4 font-bold text-blue-700">{metrics.openOrders}</td>
                      <td className={`p-4 font-bold ${metrics.missingMaterials > 0 ? "text-red-700" : "text-emerald-700"}`}>
                        {metrics.missingMaterials}
                      </td>
                      <td className="p-4">
                        <div>{formatDate(project.start_date)}</div>
                        <div className="text-xs text-slate-500">{formatDate(project.planned_end_date)}</div>
                      </td>
                      <td className="p-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass(project.status)}`}>
                          {project.status || "Taslak"}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => router.push(`/dashboard/projeler/${project.id}`)}
                            className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"
                          >
                            Detay
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditForm(project)}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={() => archiveProject(project)}
                            className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-50"
                          >
                            Arşivle
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteProject(project)}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
                          >
                            Sil
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && projects.length === 0 && (
                  <tr>
                    <td colSpan="12" className="p-8 text-center text-slate-500">
                      Henüz proje yok. İlk projeyi oluşturarak başlayın.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
