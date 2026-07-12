"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizePartnerName, normalizePartnerRecord } from "@/lib/businessPartners";
import { supabase } from "@/lib/supabase";

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

function badgeClass(value) {
  const classes = {
    Müşteri: "bg-blue-100 text-blue-700",
    Tedarikçi: "bg-emerald-100 text-emerald-700",
    Taşeron: "bg-purple-100 text-purple-700",
    Nakliye: "bg-orange-100 text-orange-700",
    "Hizmet Sağlayıcı": "bg-cyan-100 text-cyan-700",
    Aktif: "bg-green-100 text-green-700",
    Pasif: "bg-slate-100 text-slate-600",
    Riskli: "bg-red-100 text-red-700",
    "Onay Bekliyor": "bg-yellow-100 text-yellow-700",
  };

  return classes[value] || "bg-slate-100 text-slate-700";
}

export default function BusinessPartnerDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id;
  const [partner, setPartner] = useState(null);
  const [projects, setProjects] = useState([]);
  const [orders, setOrders] = useState([]);
  const [movements, setMovements] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const loadPartner = useCallback(async () => {
    setLoading(true);
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
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error) {
      console.error(error);
      setMessage("İş ortağı bulunamadı.");
      setLoading(false);
      return;
    }

    const normalized = normalizePartnerRecord(data);
    const nameKey = normalizePartnerName(normalized.name);

    const [projectRes, orderRes, movementRes] = await Promise.all([
      supabase.from("projects").select("*").eq("user_id", user.id),
      supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("stock_movements").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500),
    ]);

    setPartner(normalized);
    setProjects((projectRes.data || []).filter((project) =>
      project.customer_partner_id === normalized.id ||
      normalizePartnerName(project.customer_partner_name || project.customer_name) === nameKey
    ));
    setOrders((orderRes.data || []).filter((order) =>
      order.partner_id === normalized.id ||
      normalizePartnerName(order.partner_name || order.supplier_name) === nameKey
    ));
    setMovements((movementRes.data || []).filter((movement) =>
      movement.partner_id === normalized.id ||
      normalizePartnerName(movement.partner_name || movement.supplier_name) === nameKey
    ));
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    loadPartner();
  }, [loadPartner]);

  const totals = useMemo(() => {
    const orderTotal = orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
    const openOrders = orders.filter((order) => !["Tam Teslim", "Teslim Edildi", "İptal"].includes(order.status)).length;
    return { orderTotal, openOrders };
  }, [orders]);

  if (loading || !partner) {
    return (
      <div className="mx-auto max-w-[1100px] rounded-2xl bg-white p-8 text-center text-slate-600">
        {message || "İş ortağı yükleniyor..."}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link href="/dashboard/tedarikciler" className="text-sm font-bold text-blue-700">
            İş Ortakları
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-black text-slate-950">{partner.name}</h1>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${badgeClass(partner.partner_type)}`}>{partner.partner_type}</span>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${badgeClass(partner.status)}`}>{partner.status || "Aktif"}</span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Bu iş ortağına ait proje, sipariş ve stok hareketleri tek ekranda izlenir.
          </p>
        </div>
        <Link href="/dashboard/tedarikciler" className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white">
          Listeye Dön
        </Link>
      </div>

      {message && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm font-semibold text-yellow-900">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Stat title="Bağlı Proje" value={projects.length} text="Müşteri bağlantısı" />
        <Stat title="Sipariş" value={orders.length} text={`${totals.openOrders} açık sipariş`} />
        <Stat title="Toplam Alış" value={formatMoney(totals.orderTotal)} text="Sipariş toplamı" />
        <Stat title="Stok Hareketi" value={movements.length} text="Son kayıtlarda" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">Temel Bilgiler</h2>
          <div className="mt-4 space-y-3">
            <Info label="Yetkili" value={partner.contact_person} />
            <Info label="Telefon" value={partner.phone} />
            <Info label="E-posta" value={partner.email} />
            <Info label="Vergi No" value={partner.tax_number} />
            <Info label="Şehir" value={partner.city} />
            <Info label="Adres" value={partner.address} />
            <Info label="Notlar" value={partner.notes} />
          </div>
        </div>

        <ListPanel
          title="Bağlı Projeler"
          empty="Bağlı proje yok."
          rows={projects.map((project) => ({
            key: project.id,
            title: project.project_name || "-",
            text: `${project.project_code || "-"} · ${project.status || "-"}`,
          }))}
        />

        <ListPanel
          title="Stok Hareketleri"
          empty="Stok hareketi yok."
          rows={movements.slice(0, 12).map((movement) => ({
            key: movement.id,
            title: movement.product_name || "-",
            text: `${formatDate(movement.movement_date)} · ${movement.quantity || 0} ${movement.unit || ""}`,
          }))}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <h2 className="text-xl font-bold text-slate-900">Sipariş Geçmişi</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-4">Sipariş No</th>
                <th className="p-4">Başlık</th>
                <th className="p-4">Tarih</th>
                <th className="p-4">Tutar</th>
                <th className="p-4">Durum</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t border-slate-100">
                  <td className="p-4 font-bold text-blue-700">
                    <Link href={`/dashboard/siparisler/${order.id}`}>{order.order_no || "-"}</Link>
                  </td>
                  <td className="p-4">{order.product_name || "-"}</td>
                  <td className="p-4">{formatDate(order.order_date)}</td>
                  <td className="p-4 font-bold">{formatMoney(order.total_amount, order.currency || "TRY")}</td>
                  <td className="p-4">{order.status || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && <div className="p-8 text-center text-sm text-slate-500">Sipariş kaydı yok.</div>}
      </div>
    </div>
  );
}

function Stat({ title, value, text }) {
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
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-slate-900">{value || "-"}</div>
    </div>
  );
}

function ListPanel({ title, rows, empty }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.length > 0 ? rows.map((row) => (
          <div key={row.key} className="rounded-xl bg-slate-50 p-4">
            <div className="font-bold text-slate-900">{row.title}</div>
            <div className="mt-1 text-xs text-slate-500">{row.text}</div>
          </div>
        )) : (
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">{empty}</div>
        )}
      </div>
    </div>
  );
}
