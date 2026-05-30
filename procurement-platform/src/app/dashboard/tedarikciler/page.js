"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const emptySupplier = {
  name: "",
  category: "Genel",
  status: "Aktif",
  tax_no: "",
  contact_name: "",
  email: "",
  phone: "",
  score: 80,
  notes: "",
};

const categories = ["Genel", "Kırtasiye", "Teknoloji", "Hammadde", "Lojistik", "Hizmet"];
const statuses = ["Aktif", "Pasif", "Riskli"];

function formatMoney(value, currency = "TRY") {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} ${currency}`;
}

function getStatusClass(status) {
  if (status === "Aktif") return "bg-green-100 text-green-700";
  if (status === "Riskli") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function getScoreClass(score) {
  if (Number(score || 0) >= 80) return "bg-green-500";
  if (Number(score || 0) >= 60) return "bg-yellow-500";
  return "bg-red-500";
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const today = new Date(new Date().toISOString().split("T")[0]);
  const target = new Date(dateValue);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function calculateSupplierMetrics(supplier, orders) {
  const supplierOrders = orders.filter((order) => order.supplier_name === supplier.name);
  const totalAmount = supplierOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const openOrders = supplierOrders.filter(
    (order) => !["Teslim Edildi", "İptal"].includes(order.status)
  ).length;
  const delayedOrders = supplierOrders.filter((order) => {
    if (["Teslim Edildi", "İptal"].includes(order.status)) return false;
    if (order.status === "Gecikti") return true;
    return order.termin_date ? daysUntil(order.termin_date) < 0 : false;
  }).length;
  const lastOrder = supplierOrders[0];

  return {
    orderCount: supplierOrders.length,
    totalAmount,
    openOrders,
    delayedOrders,
    lastOrderDate: lastOrder?.order_date || lastOrder?.created_at?.split("T")[0] || "",
  };
}

function StatCard({ title, value, text }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{text}</div>
    </div>
  );
}

export default function SuppliersPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [formData, setFormData] = useState(emptySupplier);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Tümü");
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSuppliers();
  }, []);

  async function loadSuppliers() {
    setLoading(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setSuppliers([]);
      setMessage("Tedarikçiler tablosu hazır değil veya kayıtlar yüklenemedi.");
      setLoading(false);
      return;
    }

    const { data: orderData } = await supabase
      .from("orders")
      .select("id,supplier_name,status,total_amount,currency,order_date,termin_date,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    setSuppliers(data || []);
    setOrders(orderData || []);
    setLoading(false);
  }

  const filteredSuppliers = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return suppliers.filter((supplier) => {
      const haystack = [
        supplier.name,
        supplier.category,
        supplier.tax_no,
        supplier.contact_name,
        supplier.email,
        supplier.phone,
      ]
        .join(" ")
        .toLowerCase();

      const searchMatch = needle ? haystack.includes(needle) : true;
      const categoryMatch =
        categoryFilter === "Tümü" ? true : supplier.category === categoryFilter;
      const statusMatch = statusFilter === "Tümü" ? true : supplier.status === statusFilter;

      return searchMatch && categoryMatch && statusMatch;
    });
  }, [suppliers, search, categoryFilter, statusFilter]);

  const suppliersWithMetrics = useMemo(
    () =>
      suppliers.map((supplier) => ({
        ...supplier,
        metrics: calculateSupplierMetrics(supplier, orders),
      })),
    [suppliers, orders]
  );
  const activeCount = suppliers.filter((supplier) => supplier.status === "Aktif").length;
  const riskCount = suppliers.filter(
    (supplier) =>
      supplier.status === "Riskli" ||
      calculateSupplierMetrics(supplier, orders).delayedOrders > 0 ||
      Number(supplier.score || 0) < 60
  ).length;
  const openOrderCount = suppliersWithMetrics.reduce(
    (sum, supplier) => sum + supplier.metrics.openOrders,
    0
  );
  const totalSupplierAmount = suppliersWithMetrics.reduce(
    (sum, supplier) => sum + supplier.metrics.totalAmount,
    0
  );
  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function startNewSupplier() {
    setEditingId(null);
    setFormData(emptySupplier);
    setShowForm(true);
    setMessage("");
  }

  function startEdit(supplier) {
    setEditingId(supplier.id);
    setFormData({
      name: supplier.name || "",
      category: supplier.category || "Genel",
      status: supplier.status || "Aktif",
      tax_no: supplier.tax_no || "",
      contact_name: supplier.contact_name || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
      score: supplier.score || 80,
      notes: supplier.notes || "",
    });
    setShowForm(true);
    setMessage("");
  }

  function resetForm() {
    setEditingId(null);
    setFormData(emptySupplier);
    setShowForm(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!formData.name.trim()) {
      setMessage("Firma adı zorunludur.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const payload = {
      user_id: user.id,
      name: formData.name.trim(),
      category: formData.category,
      status: formData.status,
      tax_no: formData.tax_no.trim(),
      contact_name: formData.contact_name.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      score: Number(formData.score || 0),
      notes: formData.notes.trim(),
    };

    const request = editingId
      ? supabase.from("suppliers").update(payload).eq("id", editingId).eq("user_id", user.id)
      : supabase.from("suppliers").insert(payload);

    const { error } = await request;

    if (error) {
      console.error(error);
      setMessage("Tedarikçi kaydedilemedi. Supabase suppliers tablosunu kontrol edin.");
      return;
    }

    resetForm();
    await loadSuppliers();
  }

  async function deleteSupplier(id) {
    const confirmed = window.confirm("Bu tedarikçiyi silmek istediğine emin misin?");
    if (!confirmed) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { error } = await supabase
      .from("suppliers")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error(error);
      setMessage("Tedarikçi silinemedi.");
      return;
    }

    setSuppliers((prev) => prev.filter((supplier) => supplier.id !== id));
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-700">
                Tedarikçi Yönetimi
              </div>
              <h1 className="mt-3 text-4xl font-bold text-slate-900">Tedarikçiler</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Firma kartlarını, iletişim bilgilerini, kategori ve performans durumlarını takip edin.
              </p>
            </div>

            <button
              type="button"
              onClick={showForm ? resetForm : startNewSupplier}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              {showForm ? "Formu Kapat" : "+ Yeni Tedarikçi"}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <StatCard title="Toplam" value={suppliers.length} text="Kayıtlı firma" />
            <StatCard title="Aktif" value={activeCount} text="Çalışılabilir firma" />
            <StatCard title="Riskli" value={riskCount} text="Dikkat gereken firma" />
            <StatCard title="Açık Sipariş" value={openOrderCount} text="Devam eden iş" />
            <StatCard title="Toplam İş" value={formatMoney(totalSupplierAmount)} text="Sipariş hacmi" />
          </div>

          {showForm && (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {editingId ? "Tedarikçiyi Düzenle" : "Yeni Tedarikçi"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Firma bilgilerini kaydedin ve satınalma süreçlerinde kullanın.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700"
                >
                  Vazgeç
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input label="Firma Adı" name="name" value={formData.name} onChange={handleChange} />
                <Select
                  label="Kategori"
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  options={categories}
                />
                <Select
                  label="Durum"
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  options={statuses}
                />
                <Input label="Vergi No" name="tax_no" value={formData.tax_no} onChange={handleChange} />
                <Input
                  label="Yetkili"
                  name="contact_name"
                  value={formData.contact_name}
                  onChange={handleChange}
                />
                <Input label="E-posta" name="email" type="email" value={formData.email} onChange={handleChange} />
                <Input label="Telefon" name="phone" value={formData.phone} onChange={handleChange} />
                <Input label="Skor" name="score" type="number" value={formData.score} onChange={handleChange} />
              </div>

              <label className="mt-4 block">
                <span className="mb-2 block text-sm font-bold text-slate-700">Not</span>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={3}
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm"
                />
              </label>

              <div className="mt-5 flex justify-end">
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700"
                >
                  {editingId ? "Kaydet" : "Tedarikçi Ekle"}
                </button>
              </div>
            </form>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <input
                placeholder="Firma, yetkili, e-posta veya telefon ara..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm"
              />
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm"
              >
                <option>Tümü</option>
                {categories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm"
              >
                <option>Tümü</option>
                {statuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </div>
          </div>

          {message && (
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
              {message}
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-xl font-bold text-slate-900">Tedarikçi Listesi</h2>
              <p className="mt-1 text-sm text-slate-500">
                {loading ? "Kayıtlar yükleniyor..." : `${filteredSuppliers.length} kayıt gösteriliyor.`}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="p-4">Firma</th>
                    <th className="p-4">Kategori</th>
                    <th className="p-4">Yetkili</th>
                    <th className="p-4">İletişim</th>
                    <th className="p-4">Sipariş Özeti</th>
                    <th className="p-4">Skor</th>
                    <th className="p-4">Durum</th>
                    <th className="p-4">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((supplier) => {
                    const metrics = calculateSupplierMetrics(supplier, orders);

                    return (
                      <tr key={supplier.id} className="border-t border-slate-100 align-top">
                        <td className="p-4">
                          <div className="font-bold text-slate-900">{supplier.name}</div>
                          <div className="text-xs text-slate-500">{supplier.tax_no || "-"}</div>
                        </td>
                        <td className="p-4">{supplier.category || "-"}</td>
                        <td className="p-4">{supplier.contact_name || "-"}</td>
                        <td className="p-4">
                          <div>{supplier.email || "-"}</div>
                          <div className="text-xs text-slate-500">{supplier.phone || "-"}</div>
                        </td>
                        <td className="p-4">
                          <div className="font-bold text-slate-900">
                            {metrics.orderCount} sipariş
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatMoney(metrics.totalAmount)}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {metrics.openOrders > 0 && (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                                {metrics.openOrders} açık
                              </span>
                            )}
                            {metrics.delayedOrders > 0 && (
                              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">
                                {metrics.delayedOrders} geciken
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="font-bold text-slate-900">{supplier.score || 0}</div>
                          <div className="mt-2 h-2 w-24 rounded-full bg-slate-100">
                            <div
                              className={`h-2 rounded-full ${getScoreClass(supplier.score)}`}
                              style={{ width: `${Math.min(Number(supplier.score || 0), 100)}%` }}
                            />
                          </div>
                        </td>
                        <td className="p-4">
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(supplier.status)}`}>
                            {supplier.status || "Aktif"}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => router.push(`/dashboard/tedarikciler/${supplier.id}`)}
                              className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700"
                            >
                              Detay
                            </button>
                            <button
                              type="button"
                              onClick={() => startEdit(supplier)}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold"
                            >
                              Düzenle
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSupplier(supplier.id)}
                              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600"
                            >
                              Sil
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {!loading && filteredSuppliers.length === 0 && (
                    <tr>
                      <td colSpan="8" className="p-8 text-center text-slate-500">
                        Tedarikçi kaydı bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Input({ label, name, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-slate-300 p-3 text-sm"
      />
    </label>
  );
}

function Select({ label, name, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-slate-300 p-3 text-sm"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
