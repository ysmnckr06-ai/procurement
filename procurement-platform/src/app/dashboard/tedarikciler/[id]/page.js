"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function formatMoney(value, currency = "TRY") {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} ${currency}`;
}

function getStatusClass(status) {
  if (status === "Aktif") return "bg-green-100 text-green-700";
  if (status === "Riskli") return "bg-red-100 text-red-700";
  if (status === "Teslim Edildi") return "bg-green-100 text-green-700";
  if (status === "Kısmi Teslim") return "bg-amber-100 text-amber-700";
  if (status === "Gecikti") return "bg-red-100 text-red-700";
  if (status === "İptal") return "bg-slate-200 text-slate-700";
  return "bg-blue-100 text-blue-700";
}

function getHealthClass(score) {
  if (score >= 80) return "text-green-700";
  if (score >= 60) return "text-yellow-700";
  return "text-red-700";
}

function getHealthLabel(score) {
  if (score >= 80) return "Güçlü";
  if (score >= 60) return "İzlenmeli";
  return "Riskli";
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const today = new Date(new Date().toISOString().split("T")[0]);
  const target = new Date(dateValue);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
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

function Info({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 font-bold text-slate-900">{value || "-"}</div>
    </div>
  );
}

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id;
  const [supplier, setSupplier] = useState(null);
  const [orders, setOrders] = useState([]);
  const [orderFilter, setOrderFilter] = useState("Tümü");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSupplier();
  }, [id]);

  async function loadSupplier() {
    setLoading(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data: supplierData, error: supplierError } = await supabase
      .from("suppliers")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (supplierError) {
      console.error(supplierError);
      setMessage("Tedarikçi bulunamadı.");
      setLoading(false);
      return;
    }

    const { data: orderData, error: ordersError } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", user.id)
      .eq("supplier_name", supplierData.name)
      .order("created_at", { ascending: false });

    if (ordersError) {
      console.error(ordersError);
      setMessage("Tedarikçi bilgisi yüklendi, siparişler alınamadı.");
    }

    setSupplier(supplierData);
    setOrders(orderData || []);
    setLoading(false);
  }

  const stats = useMemo(() => {
    const totalAmount = orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
    const deliveredOrders = orders.filter((order) => ["Teslim Edildi", "Tam Teslim"].includes(order.status)).length;
    const openOrders = orders.filter(
      (order) => !["Teslim Edildi", "Tam Teslim", "İptal"].includes(order.status)
    ).length;
    const delayedOrders = orders.filter((order) => {
      if (["Teslim Edildi", "Tam Teslim", "İptal"].includes(order.status)) return false;
      if (order.status === "Gecikti") return true;
      return order.termin_date ? daysUntil(order.termin_date) < 0 : false;
    }).length;
    const missingDeliveries = orders.filter((order) => order.receipt_status === "Eksik geldi").length;
    const defectiveItems = orders.reduce((sum, order) => sum + Number(order.defective_total || 0), 0);
    const deliveryDurations = orders
      .map((order) => {
        if (!order.order_date || !order.delivery_date) return null;
        const start = new Date(order.order_date);
        const end = new Date(order.delivery_date);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
        return Math.max(0, Math.ceil((end - start) / 86400000));
      })
      .filter((value) => value !== null);
    const averageDeliveryDays =
      deliveryDurations.length > 0
        ? Math.round(deliveryDurations.reduce((sum, value) => sum + value, 0) / deliveryDurations.length)
        : 0;
    const completionRate = orders.length > 0 ? Math.round((deliveredOrders / orders.length) * 100) : 0;
    const onTimeRate = orders.length > 0 ? Math.round(((orders.length - delayedOrders) / orders.length) * 100) : 0;
    const baseScore = Number(supplier?.score || 100);
    const delayPenalty = Math.min(delayedOrders * 15, 45);
    const openPenalty = openOrders > 0 && completionRate < 50 ? 10 : 0;
    const issuePenalty = missingDeliveries * 10 + defectiveItems * 4;
    const healthScore = Math.max(Math.min(baseScore - delayPenalty - openPenalty - issuePenalty, 100), 0);

    return {
      totalAmount,
      deliveredOrders,
      openOrders,
      delayedOrders,
      missingDeliveries,
      defectiveItems,
      averageDeliveryDays,
      onTimeRate,
      completionRate,
      healthScore,
    };
  }, [orders, supplier]);

  const filteredOrders = useMemo(() => {
    if (orderFilter === "Tümü") return orders;

    return orders.filter((order) => {
      const remainingDays = daysUntil(order.termin_date);
      const isDelayed =
        !["Teslim Edildi", "Tam Teslim", "İptal"].includes(order.status) &&
        remainingDays !== null &&
        remainingDays < 0;

      if (orderFilter === "Açık") return !["Teslim Edildi", "Tam Teslim", "İptal"].includes(order.status);
      if (orderFilter === "Geciken") return order.status === "Gecikti" || isDelayed;
      if (orderFilter === "Teslim") return ["Teslim Edildi", "Tam Teslim"].includes(order.status);
      return true;
    });
  }, [orders, orderFilter]);

  async function updateSupplierStatus(nextStatus) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !supplier) {
      router.push("/login");
      return;
    }

    const { error } = await supabase
      .from("suppliers")
      .update({ status: nextStatus })
      .eq("id", supplier.id)
      .eq("user_id", user.id);

    if (error) {
      setMessage("Tedarikçi durumu güncellenemedi.");
      return;
    }

    setSupplier((prev) => ({ ...prev, status: nextStatus }));
    setMessage(`Tedarikçi durumu ${nextStatus} olarak güncellendi.`);
  }

  if (loading || !supplier) {
    return (
      <div className="min-h-screen bg-slate-100 p-8">
        <div className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-sm">
          {message || "Tedarikçi yükleniyor..."}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link href="/dashboard/tedarikciler" className="text-sm font-bold text-blue-700">
              Tedarikçiler
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-black text-slate-900">{supplier.name}</h1>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(supplier.status)}`}>
                {supplier.status || "Aktif"}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Bu tedarikçiye ait iletişim bilgileri, sipariş hareketleri ve performans özeti.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {["Aktif", "Pasif", "Riskli"].map((status) => (
              <button
                key={status}
                type="button"
                disabled={supplier.status === status}
                onClick={() => updateSupplierStatus(status)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                {status}
              </button>
            ))}
            <button
              type="button"
              onClick={() => router.push("/dashboard/siparisler")}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700"
            >
              Siparişlere Git
            </button>
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
            {message}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <StatCard title="Sipariş" value={orders.length} text="Toplam kayıt" />
          <StatCard title="Açık" value={stats.openOrders} text="Devam eden sipariş" />
          <StatCard title="Teslim" value={stats.deliveredOrders} text="Tamamlanan sipariş" />
          <StatCard title="Geciken" value={stats.delayedOrders} text="Kontrol gereken" />
          <StatCard title="Tutar" value={formatMoney(stats.totalAmount)} text="Toplam sipariş" />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard title="Zamanında Teslim" value={`%${stats.onTimeRate}`} text="Termin performansı" />
          <StatCard title="Eksik Teslim" value={stats.missingDeliveries} text="Eksik gelen sipariş" />
          <StatCard title="Hatalı Ürün" value={stats.defectiveItems} text="Kabul dışı miktar" />
          <StatCard title="Ortalama Süre" value={`${stats.averageDeliveryDays} gün`} text="Teslim süresi" />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-lg font-bold text-slate-900">Firma Bilgileri</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Info label="Kategori" value={supplier.category || "Genel"} />
              <Info label="Vergi No" value={supplier.tax_no} />
              <Info label="Yetkili" value={supplier.contact_name} />
              <Info
                label="E-posta"
                value={
                  supplier.email ? (
                    <a className="text-blue-700" href={`mailto:${supplier.email}`}>
                      {supplier.email}
                    </a>
                  ) : (
                    "-"
                  )
                }
              />
              <Info
                label="Telefon"
                value={
                  supplier.phone ? (
                    <a className="text-blue-700" href={`tel:${supplier.phone}`}>
                      {supplier.phone}
                    </a>
                  ) : (
                    "-"
                  )
                }
              />
              <Info label="Skor" value={`${supplier.score || 0} / 100`} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Performans</h2>
            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">Tedarikçi Sağlığı</div>
              <div className={`mt-1 text-2xl font-black ${getHealthClass(stats.healthScore)}`}>
                {getHealthLabel(stats.healthScore)} · %{stats.healthScore}
              </div>
            </div>
            <div className="mt-4">
              <div className="mb-2 flex justify-between text-sm text-slate-600">
                <span>Teslim Tamamlama</span>
                <span>%{stats.completionRate}</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100">
                <div
                  className="h-3 rounded-full bg-green-500"
                  style={{ width: `${stats.completionRate}%` }}
                />
              </div>
            </div>
            {stats.delayedOrders > 0 && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
                Bu tedarikçide geciken sipariş var. Durumu Riskli olarak işaretlemek iyi olur.
              </div>
            )}
            <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              <div className="font-black text-slate-900">Performans nedenleri</div>
              <div className="mt-2 space-y-1">
                <div>Termin gecikmesi: {stats.delayedOrders}</div>
                <div>Eksik teslim: {stats.missingDeliveries}</div>
                <div>Hatalı ürün: {stats.defectiveItems}</div>
                <div>Ödeme / teslimat uyumu: {stats.healthScore >= 80 ? "Uyumlu" : "Kontrol edilmeli"}</div>
              </div>
            </div>
            <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
              {supplier.notes || "Not bulunmuyor."}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Tedarikçi Siparişleri</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Bu firma adıyla eşleşen sipariş kayıtları gösteriliyor.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {["Tümü", "Açık", "Geciken", "Teslim"].map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setOrderFilter(filter)}
                    className={`rounded-lg px-3 py-2 text-xs font-bold ${
                      orderFilter === filter
                        ? "bg-blue-600 text-white"
                        : "border border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-4">Sipariş No</th>
                  <th className="p-4">Başlık</th>
                  <th className="p-4">Tarih</th>
                  <th className="p-4">Termin</th>
                  <th className="p-4">Tutar</th>
                  <th className="p-4">Durum</th>
                  <th className="p-4">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const remainingDays = daysUntil(order.termin_date);
                  const isDelayed =
                    !["Teslim Edildi", "İptal"].includes(order.status) &&
                    remainingDays !== null &&
                    remainingDays < 0;
                  const status = isDelayed ? "Gecikti" : order.status;

                  return (
                    <tr key={order.id} className="border-t border-slate-100">
                      <td className="p-4 font-bold text-slate-900">{order.order_no}</td>
                      <td className="p-4">{order.product_name || "-"}</td>
                      <td className="p-4">{order.order_date || "-"}</td>
                      <td className="p-4">
                        <div>{order.termin_date || "-"}</div>
                        {remainingDays !== null && (
                          <div className={`mt-1 text-xs font-bold ${isDelayed ? "text-red-600" : "text-slate-500"}`}>
                            {remainingDays < 0
                              ? `${Math.abs(remainingDays)} gün geçti`
                              : `${remainingDays} gün kaldı`}
                          </div>
                        )}
                      </td>
                      <td className="p-4 font-semibold">
                        {formatMoney(order.total_amount, order.currency || "TRY")}
                      </td>
                      <td className="p-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(status)}`}>
                          {status || "Bekliyor"}
                        </span>
                      </td>
                      <td className="p-4">
                        <button
                          type="button"
                          onClick={() => router.push(`/dashboard/siparisler/${order.id}`)}
                          className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700"
                        >
                          Siparişe Git
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan="7" className="p-8 text-center text-slate-500">
                      Bu filtreye uygun sipariş bulunamadı.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
