"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const emptyForm = {
  name: "",
  category: "",
  contact: "",
  phone: "",
  email: "",
  city: "",
  taxNo: "",
  address: "",
  website: "",
  paymentTerm: "",
  lastOrderDate: "",
  totalOrders: "0",
  onTimeRate: "85",
  productGroups: "",
  deliveryScore: "4",
  qualityScore: "4",
  priceScore: "4",
  status: "Aktif",
  notes: "",
};

const categories = [
  "Tumu",
  "Elektrik",
  "Mekanik",
  "IT",
  "Insaat",
  "Lojistik",
  "Hizmet",
  "Kimya",
  "Ambalaj",
  "Diger",
];

const statuses = ["Tumu", "Aktif", "Onay Bekliyor", "Riskli", "Pasif"];
const sortOptions = [
  { label: "Puana gore", value: "score" },
  { label: "Firma adina gore", value: "name" },
  { label: "Son siparise gore", value: "lastOrderDate" },
  { label: "Teslim oranina gore", value: "onTimeRate" },
];

function getAverageScore(supplier) {
  const scores = [
    Number(supplier.deliveryScore || 0),
    Number(supplier.qualityScore || 0),
    Number(supplier.priceScore || 0),
  ];

  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

function getHealth(supplier) {
  const score = getAverageScore(supplier);
  const onTimeRate = Number(supplier.onTimeRate || 0);

  if (supplier.status === "Riskli" || score < 3 || onTimeRate < 60) {
    return {
      label: "Riskli",
      className: "bg-red-100 text-red-700",
      bar: "bg-red-500",
    };
  }

  if (supplier.status === "Onay Bekliyor" || score < 4 || onTimeRate < 80) {
    return {
      label: "Izlemede",
      className: "bg-yellow-100 text-yellow-700",
      bar: "bg-yellow-500",
    };
  }

  return {
    label: "Guvenilir",
    className: "bg-green-100 text-green-700",
    bar: "bg-green-500",
  };
}

function getStatusClass(status) {
  switch (status) {
    case "Aktif":
      return "bg-green-100 text-green-700";
    case "Onay Bekliyor":
      return "bg-yellow-100 text-yellow-700";
    case "Riskli":
      return "bg-red-100 text-red-700";
    case "Pasif":
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function formatDate(value) {
  if (!value) return "-";

  return new Date(value).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysSince(value) {
  if (!value) return null;

  const diff = Date.now() - new Date(value).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function StatCard({ title, value, text, tone }) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-900",
    green: "border-green-200 bg-green-50 text-green-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    red: "border-red-200 bg-red-50 text-red-800",
  };

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}>
      <div className="text-sm font-bold opacity-70">{title}</div>
      <div className="mt-3 text-3xl font-black">{value}</div>
      <div className="mt-1 text-sm opacity-70">{text}</div>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder = "",
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-2 block text-sm font-bold text-slate-700"
      >
        {label}
      </label>
      <input
        id={name}
        type={type}
        name={name}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={onChange}
        className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      />
    </div>
  );
}

function SelectField({ label, name, value, onChange, children }) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-2 block text-sm font-bold text-slate-700"
      >
        {label}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
      >
        {children}
      </select>
    </div>
  );
}

function ScoreInput({ label, name, value, onChange }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <label
          htmlFor={name}
          className="block text-sm font-bold text-slate-700"
        >
          {label}
        </label>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-slate-900">
          {value}/5
        </span>
      </div>
      <input
        id={name}
        type="range"
        min="1"
        max="5"
        name={name}
        value={value}
        onChange={onChange}
        className="w-full accent-blue-600"
      />
    </div>
  );
}

function ScoreBar({ label, value }) {
  const width = `${Math.min(100, Math.max(0, Number(value || 0) * 20))}%`;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-600">
        <span>{label}</span>
        <span>{value}/5</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-blue-600" style={{ width }} />
      </div>
    </div>
  );
}

function SyncBadge({ status, lastSync }) {
  const labels = {
    loading: {
      text: "Baglanti kontrol ediliyor",
      className: "bg-slate-100 text-slate-600",
    },
    connected: {
      text: "Canli backend bagli",
      className: "bg-green-100 text-green-700",
    },
    local: {
      text: "Yerel mod",
      className: "bg-yellow-100 text-yellow-800",
    },
    saving: {
      text: "Kaydediliyor",
      className: "bg-blue-100 text-blue-700",
    },
  };
  const item = labels[status] || labels.loading;

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <span
        className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${item.className}`}
      >
        {item.text}
      </span>
      <span className="text-xs font-medium text-slate-500">
        {lastSync ? `Son yenileme ${lastSync}` : "Henuz yenilenmedi"}
      </span>
    </div>
  );
}

export default function SuppliersPage() {
  const API_URL = process.env.NEXT_PUBLIC_API_URL;
  const [suppliers, setSuppliers] = useState([]);
  const [apiStatus, setApiStatus] = useState("loading");
  const [lastSync, setLastSync] = useState("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Tumu");
  const [statusFilter, setStatusFilter] = useState("Tumu");
  const [sortBy, setSortBy] = useState("score");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [message, setMessage] = useState(null);

  const loadSuppliers = useCallback(async () => {
    if (!API_URL) {
      const savedSuppliers = JSON.parse(
        localStorage.getItem("tedarikciler") || "[]",
      );
      setSuppliers(savedSuppliers);
      setApiStatus("local");
      setLastSync(new Date().toLocaleTimeString("tr-TR"));
      setMessage({
        type: "warning",
        text: "Backend adresi tanimli degil; yerel modda calisiliyor.",
      });
      return;
    }

    setApiStatus((current) => (current === "saving" ? "saving" : "loading"));

    try {
      const response = await fetch(`${API_URL}/suppliers`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Tedarikci listesi alinamadi");
      }

      const result = await response.json();
      const nextSuppliers = Array.isArray(result.suppliers)
        ? result.suppliers
        : [];

      setSuppliers(nextSuppliers);
      setApiStatus("connected");
      setLastSync(new Date().toLocaleTimeString("tr-TR"));
      setSelectedId((current) =>
        current && nextSuppliers.some((supplier) => supplier.id === current)
          ? current
          : nextSuppliers[0]?.id || null,
      );
    } catch (error) {
      console.error(error);
      const savedSuppliers = JSON.parse(
        localStorage.getItem("tedarikciler") || "[]",
      );
      setSuppliers(savedSuppliers);
      setApiStatus("local");
      setLastSync(new Date().toLocaleTimeString("tr-TR"));
      setMessage({
        type: "warning",
        text: "Backend baglantisi kesildi; yerel kayitlar gosteriliyor.",
      });
    }
  }, [API_URL]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  useEffect(() => {
    localStorage.setItem("tedarikciler", JSON.stringify(suppliers));
  }, [suppliers]);

  const enrichedSuppliers = useMemo(() => {
    return suppliers.map((supplier) => ({
      ...supplier,
      averageScore: getAverageScore(supplier),
      health: getHealth(supplier),
    }));
  }, [suppliers]);

  const filteredSuppliers = useMemo(() => {
    const filtered = enrichedSuppliers.filter((supplier) => {
      const searchText = [
        supplier.name,
        supplier.category,
        supplier.contact,
        supplier.email,
        supplier.city,
        supplier.taxNo,
        supplier.productGroups,
      ]
        .join(" ")
        .toLowerCase();

      const matchesQuery = searchText.includes(query.toLowerCase());
      const matchesCategory =
        categoryFilter === "Tumu" || supplier.category === categoryFilter;
      const matchesStatus =
        statusFilter === "Tumu" || supplier.status === statusFilter;

      return matchesQuery && matchesCategory && matchesStatus;
    });

    return filtered.sort((a, b) => {
      if (sortBy === "name") {
        return String(a.name || "").localeCompare(String(b.name || ""), "tr");
      }

      if (sortBy === "lastOrderDate") {
        return new Date(b.lastOrderDate || 0) - new Date(a.lastOrderDate || 0);
      }

      if (sortBy === "onTimeRate") {
        return Number(b.onTimeRate || 0) - Number(a.onTimeRate || 0);
      }

      return b.averageScore - a.averageScore;
    });
  }, [enrichedSuppliers, query, categoryFilter, statusFilter, sortBy]);

  const selectedSupplier =
    enrichedSuppliers.find((supplier) => supplier.id === selectedId) ||
    filteredSuppliers[0] ||
    null;

  const activeCount = enrichedSuppliers.filter(
    (supplier) => supplier.status === "Aktif",
  ).length;
  const approvalCount = enrichedSuppliers.filter(
    (supplier) => supplier.status === "Onay Bekliyor",
  ).length;
  const riskyCount = enrichedSuppliers.filter(
    (supplier) => supplier.health.label === "Riskli",
  ).length;
  const averageScore =
    enrichedSuppliers.length === 0
      ? "0.0"
      : (
          enrichedSuppliers.reduce(
            (total, supplier) => total + supplier.averageScore,
            0,
          ) / enrichedSuppliers.length
        ).toFixed(1);

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function resetForm() {
    setFormData(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  function handleNewSupplier() {
    setFormData(emptyForm);
    setEditingId(null);
    setShowForm(true);
    setMessage(null);
  }

  async function saveSupplierStatus(supplier, status) {
    await saveSupplier({ ...supplier, status }, supplier.id, false);
  }

  async function getErrorMessage(response) {
    try {
      const result = await response.json();
      return result.detail || "Islem tamamlanamadi";
    } catch {
      return "Islem tamamlanamadi";
    }
  }

  async function saveSupplier(
    payload,
    supplierId = editingId,
    closeForm = true,
  ) {
    const onTimeRate = Number(payload.onTimeRate || 0);

    if (onTimeRate < 0 || onTimeRate > 100) {
      setMessage({
        type: "error",
        text: "Zamaninda teslim orani 0 ile 100 arasinda olmali.",
      });
      return;
    }

    const supplierPayload = {
      ...payload,
      deliveryScore: Number(payload.deliveryScore),
      qualityScore: Number(payload.qualityScore),
      priceScore: Number(payload.priceScore),
      totalOrders: Number(payload.totalOrders || 0),
      onTimeRate: Number(payload.onTimeRate || 0),
    };

    setApiStatus(API_URL ? "saving" : "local");

    try {
      if (API_URL && apiStatus !== "local") {
        const response = await fetch(
          supplierId
            ? `${API_URL}/suppliers/${supplierId}`
            : `${API_URL}/suppliers`,
          {
            method: supplierId ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(supplierPayload),
          },
        );

        if (!response.ok) {
          throw new Error(await getErrorMessage(response));
        }

        const result = await response.json();

        setSuppliers((prev) =>
          supplierId
            ? prev.map((supplier) =>
                supplier.id === supplierId ? result.supplier : supplier,
              )
            : [result.supplier, ...prev],
        );
        setSelectedId(result.supplier.id);
        setApiStatus("connected");
        setLastSync(new Date().toLocaleTimeString("tr-TR"));
        setMessage({
          type: "success",
          text: supplierId
            ? "Tedarikci bilgileri guncellendi."
            : "Tedarikci kaydi olusturuldu.",
        });
      } else {
        const localSupplier = supplierId
          ? { ...supplierPayload, id: supplierId }
          : { ...supplierPayload, id: Date.now().toString() };

        setSuppliers((prev) =>
          supplierId
            ? prev.map((supplier) =>
                supplier.id === supplierId ? localSupplier : supplier,
              )
            : [localSupplier, ...prev],
        );
        setSelectedId(localSupplier.id);
        setApiStatus("local");
        setMessage({
          type: "success",
          text: supplierId
            ? "Yerel tedarikci bilgileri guncellendi."
            : "Yerel tedarikci kaydi olusturuldu.",
        });
      }

      if (closeForm) resetForm();
    } catch (error) {
      console.error(error);
      setApiStatus(API_URL ? "connected" : "local");
      setMessage({
        type: "error",
        text: error.message || "Tedarikci kaydedilemedi.",
      });
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await saveSupplier(formData);
  }

  function handleEdit(supplier) {
    setFormData({
      name: supplier.name || "",
      category: supplier.category || "",
      contact: supplier.contact || "",
      phone: supplier.phone || "",
      email: supplier.email || "",
      city: supplier.city || "",
      taxNo: supplier.taxNo || "",
      address: supplier.address || "",
      website: supplier.website || "",
      paymentTerm: supplier.paymentTerm || "",
      lastOrderDate: supplier.lastOrderDate || "",
      totalOrders: String(supplier.totalOrders || 0),
      onTimeRate: String(supplier.onTimeRate || 0),
      productGroups: supplier.productGroups || "",
      deliveryScore: String(supplier.deliveryScore || 4),
      qualityScore: String(supplier.qualityScore || 4),
      priceScore: String(supplier.priceScore || 4),
      status: supplier.status || "Aktif",
      notes: supplier.notes || "",
    });
    setEditingId(supplier.id);
    setSelectedId(supplier.id);
    setShowForm(true);
  }

  async function handleDelete(id) {
    const confirmed = window.confirm("Bu tedarikci kaydi silinsin mi?");
    if (!confirmed) return;

    if (API_URL && apiStatus !== "local") {
      try {
        const response = await fetch(`${API_URL}/suppliers/${id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("Tedarikci silinemedi");
        }
      } catch (error) {
        console.error(error);
        setMessage({
          type: "error",
          text: "Tedarikci silinemedi. Backend baglantisini kontrol edin.",
        });
        return;
      }
    }

    setSuppliers((prev) => prev.filter((supplier) => supplier.id !== id));
    setSelectedId((current) => (current === id ? null : current));

    if (editingId === id) resetForm();

    setMessage({
      type: "success",
      text: "Tedarikci kaydi silindi.",
    });
  }

  function exportSuppliersCsv() {
    const headers = [
      "Firma",
      "Kategori",
      "Yetkili",
      "Telefon",
      "E-posta",
      "Sehir",
      "Vergi No",
      "Durum",
      "Ortalama Puan",
      "Zamaninda Teslim",
      "Siparis Adedi",
      "Son Siparis",
      "Urun Gruplari",
    ];
    const rows = filteredSuppliers.map((supplier) => [
      supplier.name,
      supplier.category,
      supplier.contact,
      supplier.phone,
      supplier.email,
      supplier.city,
      supplier.taxNo,
      supplier.status,
      supplier.averageScore.toFixed(1),
      supplier.onTimeRate || 0,
      supplier.totalOrders || 0,
      supplier.lastOrderDate || "",
      supplier.productGroups,
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((value) => `"${String(value || "").replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `tedarikciler-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    setMessage({
      type: "success",
      text: "Filtrelenen tedarikci listesi CSV olarak indirildi.",
    });
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="p-4 lg:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="inline-flex rounded-full bg-blue-100 px-4 py-2 text-sm font-black text-blue-700">
                  Canli Tedarikci Yonetimi
                </div>
                <h1 className="mt-3 text-4xl font-black text-slate-950">
                  Tedarikciler
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                  Firma kartlarini, performans puanlarini, teslim disiplinini ve
                  satin alma notlarini tek ekrandan yonetin.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <SyncBadge status={apiStatus} lastSync={lastSync} />
                <button
                  type="button"
                  onClick={loadSuppliers}
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50"
                >
                  Yenile
                </button>
                <button
                  type="button"
                  onClick={exportSuppliersCsv}
                  disabled={filteredSuppliers.length === 0}
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  CSV Aktar
                </button>
                <button
                  type="button"
                  onClick={handleNewSupplier}
                  className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800"
                >
                  + Yeni Tedarikci
                </button>
              </div>
            </div>
          </section>

          {message && (
            <div
              className={`rounded-2xl border p-4 text-sm font-bold ${
                message.type === "success"
                  ? "border-green-200 bg-green-50 text-green-800"
                  : message.type === "warning"
                    ? "border-yellow-200 bg-yellow-50 text-yellow-800"
                    : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <span>{message.text}</span>
                <button
                  type="button"
                  onClick={() => setMessage(null)}
                  className="rounded-lg px-2 py-1 text-xs font-black hover:bg-white/70"
                >
                  Kapat
                </button>
              </div>
            </div>
          )}

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Toplam Tedarikci"
              value={enrichedSuppliers.length}
              text="Kayitli firma"
              tone="slate"
            />
            <StatCard
              title="Aktif"
              value={activeCount}
              text="Kullanima uygun"
              tone="green"
            />
            <StatCard
              title="Ortalama Puan"
              value={averageScore}
              text="Termin, kalite, fiyat"
              tone="blue"
            />
            <StatCard
              title="Risk / Onay"
              value={`${riskyCount}/${approvalCount}`}
              text="Takip gerektirenler"
              tone="red"
            />
          </section>

          {showForm && (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-950">
                    {editingId ? "Tedarikciyi Duzenle" : "Yeni Tedarikci"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Kimlik, iletisim, operasyon ve performans bilgilerini
                    kaydedin.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
                >
                  Vazgec
                </button>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field
                  label="Firma Adi"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                />
                <SelectField
                  label="Kategori"
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                >
                  <option value="">Seciniz</option>
                  {categories.slice(1).map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </SelectField>
                <Field
                  label="Yetkili"
                  name="contact"
                  value={formData.contact}
                  onChange={handleChange}
                />
                <Field
                  label="Telefon"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                />
                <Field
                  label="E-posta"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                />
                <Field
                  label="Sehir"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                />
                <Field
                  label="Vergi No"
                  name="taxNo"
                  value={formData.taxNo}
                  onChange={handleChange}
                />
                <Field
                  label="Web Sitesi"
                  name="website"
                  value={formData.website}
                  onChange={handleChange}
                  placeholder="https://"
                />
                <Field
                  label="Odeme Vadesi"
                  name="paymentTerm"
                  value={formData.paymentTerm}
                  onChange={handleChange}
                  placeholder="30 Gun"
                />
                <Field
                  label="Son Siparis"
                  name="lastOrderDate"
                  type="date"
                  value={formData.lastOrderDate}
                  onChange={handleChange}
                />
                <Field
                  label="Siparis Adedi"
                  name="totalOrders"
                  type="number"
                  value={formData.totalOrders}
                  onChange={handleChange}
                />
                <Field
                  label="Zamaninda Teslim %"
                  name="onTimeRate"
                  type="number"
                  value={formData.onTimeRate}
                  onChange={handleChange}
                />
                <Field
                  label="Urun Gruplari"
                  name="productGroups"
                  value={formData.productGroups}
                  onChange={handleChange}
                  placeholder="Kablo, pano, sarf"
                />
                <SelectField
                  label="Durum"
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                >
                  {statuses.slice(1).map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </SelectField>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
                <ScoreInput
                  label="Termin"
                  name="deliveryScore"
                  value={formData.deliveryScore}
                  onChange={handleChange}
                />
                <ScoreInput
                  label="Kalite"
                  name="qualityScore"
                  value={formData.qualityScore}
                  onChange={handleChange}
                />
                <ScoreInput
                  label="Fiyat"
                  name="priceScore"
                  value={formData.priceScore}
                  onChange={handleChange}
                />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
                <Field
                  label="Adres"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                />
                <div>
                  <label
                    htmlFor="notes"
                    className="mb-2 block text-sm font-bold text-slate-700"
                  >
                    Notlar
                  </label>
                  <textarea
                    id="notes"
                    name="notes"
                    value={formData.notes}
                    onChange={handleChange}
                    rows="3"
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white hover:bg-blue-700"
                >
                  {editingId ? "Kaydet" : "Tedarikci Ekle"}
                </button>
              </div>
            </form>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr]">
              <input
                placeholder="Firma, yetkili, vergi no, kategori veya sehir ara..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />

              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white p-3 text-sm"
              >
                {categories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white p-3 text-sm"
              >
                {statuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>

              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white p-3 text-sm"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {statuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-full px-4 py-2 text-xs font-black transition ${
                    statusFilter === status
                      ? "bg-slate-950 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </section>

          {apiStatus === "local" && (
            <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-bold text-yellow-800">
              Backend baglantisi bulunamadi; kayitlar bu tarayicida yerel olarak
              saklaniyor.
            </div>
          )}

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-2 border-b border-slate-100 p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-950">
                    Tedarikci Listesi
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {filteredSuppliers.length} kayit gosteriliyor.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="p-4">Firma</th>
                      <th className="p-4">Operasyon</th>
                      <th className="p-4">Performans</th>
                      <th className="p-4">Durum</th>
                      <th className="p-4">Islem</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredSuppliers.map((supplier) => {
                      const lastOrderAge = daysSince(supplier.lastOrderDate);

                      return (
                        <tr
                          key={supplier.id}
                          onClick={() => setSelectedId(supplier.id)}
                          className={`cursor-pointer border-t border-slate-100 align-top transition hover:bg-slate-50 ${
                            selectedSupplier?.id === supplier.id
                              ? "bg-blue-50/60"
                              : ""
                          }`}
                        >
                          <td className="p-4">
                            <div className="font-black text-slate-900">
                              {supplier.name}
                            </div>
                            <div className="mt-1 text-xs font-medium text-slate-500">
                              {supplier.category || "-"} /{" "}
                              {supplier.city || "-"}
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              {supplier.contact || "-"} /{" "}
                              {supplier.phone || "-"}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="font-bold text-slate-800">
                              {supplier.paymentTerm || "Vade yok"}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {supplier.totalOrders || 0} siparis
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              Son: {formatDate(supplier.lastOrderDate)}
                              {lastOrderAge !== null
                                ? ` (${lastOrderAge} gun)`
                                : ""}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="text-2xl font-black text-slate-950">
                                {supplier.averageScore.toFixed(1)}
                              </div>
                              <div className="min-w-28 flex-1">
                                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className={`h-full rounded-full ${supplier.health.bar}`}
                                    style={{
                                      width: `${supplier.averageScore * 20}%`,
                                    }}
                                  />
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  Teslim %{supplier.onTimeRate || 0}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col gap-2">
                              <span
                                className={`w-max rounded-full px-3 py-1 text-xs font-black ${getStatusClass(
                                  supplier.status,
                                )}`}
                              >
                                {supplier.status}
                              </span>
                              <span
                                className={`w-max rounded-full px-3 py-1 text-xs font-black ${supplier.health.className}`}
                              >
                                {supplier.health.label}
                              </span>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleEdit(supplier);
                                }}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black hover:bg-white"
                              >
                                Duzenle
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDelete(supplier.id);
                                }}
                                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-black text-red-600 hover:bg-red-50"
                              >
                                Sil
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {filteredSuppliers.length === 0 && (
                      <tr>
                        <td
                          colSpan="5"
                          className="p-10 text-center text-slate-500"
                        >
                          Kayit bulunamadi. Yeni tedarikci ekleyerek canli
                          listeyi baslatin.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {selectedSupplier
                ? <div className="space-y-5">
                    <div>
                      <div className="text-xs font-black uppercase tracking-wide text-slate-400">
                        Secili Tedarikci
                      </div>
                      <h3 className="mt-2 text-2xl font-black text-slate-950">
                        {selectedSupplier.name}
                      </h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black ${getStatusClass(
                            selectedSupplier.status,
                          )}`}
                        >
                          {selectedSupplier.status}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black ${selectedSupplier.health.className}`}
                        >
                          {selectedSupplier.health.label}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Detail
                        label="Kategori"
                        value={selectedSupplier.category}
                      />
                      <Detail label="Sehir" value={selectedSupplier.city} />
                      <Detail
                        label="Yetkili"
                        value={selectedSupplier.contact}
                      />
                      <Detail label="Telefon" value={selectedSupplier.phone} />
                      <Detail label="E-posta" value={selectedSupplier.email} />
                      <Detail label="Vergi No" value={selectedSupplier.taxNo} />
                      <Detail
                        label="Son Siparis"
                        value={formatDate(selectedSupplier.lastOrderDate)}
                      />
                      <Detail
                        label="Teslim Orani"
                        value={`%${selectedSupplier.onTimeRate || 0}`}
                      />
                    </div>

                    <div className="space-y-3">
                      <ScoreBar
                        label="Termin"
                        value={selectedSupplier.deliveryScore || 0}
                      />
                      <ScoreBar
                        label="Kalite"
                        value={selectedSupplier.qualityScore || 0}
                      />
                      <ScoreBar
                        label="Fiyat"
                        value={selectedSupplier.priceScore || 0}
                      />
                    </div>

                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-xs font-black uppercase tracking-wide text-slate-400">
                        Urun Gruplari
                      </div>
                      <div className="mt-2 text-sm font-bold text-slate-800">
                        {selectedSupplier.productGroups || "-"}
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 p-4">
                      <div className="text-xs font-black uppercase tracking-wide text-slate-400">
                        Notlar
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-700">
                        {selectedSupplier.notes || "Not eklenmemis."}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(selectedSupplier)}
                        className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white hover:bg-slate-800"
                      >
                        Duzenle
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          saveSupplierStatus(
                            selectedSupplier,
                            selectedSupplier.status === "Riskli"
                              ? "Aktif"
                              : "Riskli",
                          )
                        }
                        className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50"
                      >
                        {selectedSupplier.status === "Riskli"
                          ? "Aktif Yap"
                          : "Riskli Isaretle"}
                      </button>
                    </div>
                  </div>
                : <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
                    Detaylari gormek icin bir tedarikci secin.
                  </div>}
            </aside>
          </section>
        </div>
      </main>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-slate-800">
        {value || "-"}
      </div>
    </div>
  );
}
