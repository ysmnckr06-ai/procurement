"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const emptyForm = {
  orderNo: "",
  company: "",
  product: "",
  orderDate: "",
  dueDate: "",
  deliveryDate: "",
  status: "Bekliyor",
  items: [],
  totalAmount: 0,
  note: "",
  currency: "TRY",
  reportId: null,
};

const statusOptions = [
  "Bekliyor",
  "Firmaya Gönderildi",
  "Onay Bekliyor",
  "Üretimde",
  "Kargolandı",
  "Kısmi Teslim",
  "Teslim Edildi",
  "Gecikti",
  "İptal",
];

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function createOrderNo(count = 0) {
  return `SIP-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;
}

function formatMoney(value, currency = "TRY") {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} ${currency}`;
}

function normalizeItems(items) {
  return (items || []).map((item) => {
    const quantity = Number(item.quantity || item.miktar || 0);
    const unitPrice = Number(item.unitPrice || item.birimFiyat || 0);
    const discount = Number(item.discount || item.iskonto || 0);
    const netUnitPrice = Number(item.netUnitPrice || unitPrice - (unitPrice * discount) / 100);
    const total = Number(item.total || quantity * netUnitPrice);
    const deliveredQuantity = Number(item.deliveredQuantity || item.delivered || 0);

    return {
      productCode: item.productCode || item.urunKodu || "",
      productName: item.productName || item.urunAciklamasi || item.product || "",
      unit: item.unit || item.birim || "adet",
      quantity,
      deliveredQuantity,
      unitPrice,
      discount,
      netUnitPrice,
      total,
      paymentTerm: item.paymentTerm || item.vade || "",
      deliveryTerm: item.deliveryTerm || item.termin || "",
      currency: item.currency || "TRY",
    };
  });
}

function calculateOrderTotal(items) {
  return normalizeItems(items).reduce((sum, item) => sum + Number(item.total || 0), 0);
}

function calculateItemCounts(order) {
  const items = normalizeItems(order.items);
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const deliveredQuantity = items.reduce(
    (sum, item) => sum + Number(item.deliveredQuantity || 0),
    0
  );

  return {
    itemCount: items.length || Number(order.quantity || 0),
    totalQuantity,
    deliveredQuantity,
    remainingQuantity: Math.max(totalQuantity - deliveredQuantity, 0),
  };
}

function getSmartStatus(order) {
  const status = order.status || "Bekliyor";
  if (status === "Teslim Edildi" || status === "İptal" || status === "Kısmi Teslim") {
    return status;
  }

  if (order.termin_date && !order.delivery_date && new Date(order.termin_date) < new Date()) {
    return "Gecikti";
  }

  return status;
}

function getStatusClass(status) {
  const classes = {
    Bekliyor: "bg-yellow-100 text-yellow-700",
    "Firmaya Gönderildi": "bg-blue-100 text-blue-700",
    "Onay Bekliyor": "bg-orange-100 text-orange-700",
    Üretimde: "bg-purple-100 text-purple-700",
    Kargolandı: "bg-sky-100 text-sky-700",
    "Kısmi Teslim": "bg-amber-100 text-amber-700",
    "Teslim Edildi": "bg-green-100 text-green-700",
    Gecikti: "bg-red-100 text-red-700",
    İptal: "bg-slate-200 text-slate-700",
  };

  return classes[status] || "bg-slate-100 text-slate-700";
}

function calculateDelayDays(order) {
  if (!order.termin_date) return 0;

  const due = new Date(order.termin_date);
  const endDate = order.delivery_date ? new Date(order.delivery_date) : new Date();
  const diff = Math.ceil((endDate - due) / (1000 * 60 * 60 * 24));

  return diff > 0 ? diff : 0;
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const today = new Date(getToday());
  const target = new Date(dateValue);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function StatCard({ title, value, text }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{text}</div>
    </div>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const isSubmittingRef = useRef(false);
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [formData, setFormData] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadData();
    hydratePendingOrder();
  }, []);

  async function loadData() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setMessage("Siparişler yüklenemedi.");
      return;
    }

    const { data: supplierData } = await supabase
      .from("suppliers")
      .select("id,name,status")
      .eq("user_id", user.id)
      .order("name", { ascending: true });

    setOrders(data || []);
    setSuppliers(supplierData || []);
  }

  function hydratePendingOrder() {
    const pendingOrder = localStorage.getItem("pendingOrder");
    if (!pendingOrder) return;

    const parsedOrder = JSON.parse(pendingOrder);
    const items = normalizeItems(parsedOrder.items || []);

    setFormData({
      ...emptyForm,
      orderNo: parsedOrder.orderNo || createOrderNo(orders.length),
      company: parsedOrder.company || "",
      product: parsedOrder.reportName || "Karşılaştırma Raporu",
      orderDate: parsedOrder.orderDate || getToday(),
      dueDate: parsedOrder.dueDate || "",
      status: "Bekliyor",
      reportId: parsedOrder.reportId || null,
      items,
      totalAmount: calculateOrderTotal(items),
      note: parsedOrder.paymentTerm ? `Ödeme vadesi: ${parsedOrder.paymentTerm}` : "",
    });
    setShowForm(true);
    setEditingId(null);
    setMessage("Rapor verileri otomatik olarak yüklendi. Kontrol edip siparişi oluşturabilirsiniz.");
    localStorage.removeItem("pendingOrder");
  }

  const enrichedOrders = useMemo(() => {
    return orders.map((order) => ({
      ...order,
      status: getSmartStatus(order),
      delayDays: calculateDelayDays(order),
      ...calculateItemCounts(order),
    }));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return enrichedOrders.filter((order) => {
      const haystack = [order.order_no, order.supplier_name, order.product_name]
        .join(" ")
        .toLowerCase();
      const searchMatch = needle ? haystack.includes(needle) : true;
      const statusMatch = statusFilter === "Tümü" ? true : order.status === statusFilter;

      return searchMatch && statusMatch;
    });
  }, [enrichedOrders, search, statusFilter]);

  const totalAmount = enrichedOrders.reduce(
    (sum, order) => sum + Number(order.total_amount || 0),
    0
  );
  const waitingCount = enrichedOrders.filter((order) => order.status === "Bekliyor").length;
  const deliveredCount = enrichedOrders.filter((order) => order.status === "Teslim Edildi").length;
  const delayedCount = enrichedOrders.filter((order) => order.status === "Gecikti").length;

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function handleSupplierChange(event) {
    setFormData((prev) => ({ ...prev, company: event.target.value }));
  }

  function updateOrderItem(index, field, value) {
    setFormData((prev) => {
      const items = normalizeItems(prev.items);
      items[index] = { ...items[index], [field]: value };

      const quantity = Number(items[index].quantity || 0);
      const unitPrice = Number(items[index].unitPrice || 0);
      const discount = Number(items[index].discount || 0);
      const deliveredQuantity = Number(items[index].deliveredQuantity || 0);
      const netUnitPrice = unitPrice - (unitPrice * discount) / 100;

      items[index].deliveredQuantity = Math.min(Math.max(deliveredQuantity, 0), quantity);
      items[index].netUnitPrice = netUnitPrice;
      items[index].total = quantity * netUnitPrice;

      return {
        ...prev,
        items,
        totalAmount: calculateOrderTotal(items),
      };
    });
  }

  function addOrderItem() {
    setFormData((prev) => {
      const items = [
        ...normalizeItems(prev.items),
        {
          productCode: "",
          productName: "",
          unit: "adet",
          quantity: 1,
          deliveredQuantity: 0,
          unitPrice: 0,
          discount: 0,
          netUnitPrice: 0,
          total: 0,
          paymentTerm: "",
          deliveryTerm: "",
          currency: prev.currency || "TRY",
        },
      ];

      return {
        ...prev,
        items,
        totalAmount: calculateOrderTotal(items),
      };
    });
  }

  function deleteOrderItem(index) {
    setFormData((prev) => {
      const items = normalizeItems(prev.items);
      items.splice(index, 1);

      return {
        ...prev,
        items,
        totalAmount: calculateOrderTotal(items),
      };
    });
  }

  function resetForm() {
    setFormData(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setMessage("");
  }

  function startNewOrder() {
    setEditingId(null);
    setFormData({
      ...emptyForm,
      orderNo: createOrderNo(orders.length),
      orderDate: getToday(),
    });
    setShowForm(true);
    setMessage("");
  }

  function startEdit(order) {
    setFormData({
      ...emptyForm,
      orderNo: order.order_no || "",
      company: order.supplier_name || "",
      product: order.product_name || "",
      orderDate: order.order_date || "",
      dueDate: order.termin_date || "",
      deliveryDate: order.delivery_date || "",
      status: order.status || "Bekliyor",
      reportId: order.report_id || null,
      items: normalizeItems(order.items || []),
      totalAmount: Number(order.total_amount || 0),
      note: order.note || "",
      currency: order.currency || "TRY",
    });
    setEditingId(order.id);
    setShowForm(true);
    setMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    if (!formData.orderNo || !formData.company || !formData.product || !formData.orderDate) {
      setMessage("Sipariş no, firma, başlık ve sipariş tarihi zorunludur.");
      isSubmittingRef.current = false;
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const items = normalizeItems(formData.items);
    const payload = {
      user_id: user.id,
      order_no: formData.orderNo,
      supplier_name: formData.company,
      product_name: formData.product,
      quantity: items.length || 1,
      order_date: formData.orderDate || null,
      termin_date: formData.dueDate || null,
      delivery_date: formData.deliveryDate || null,
      status: formData.status,
      report_id: formData.reportId || null,
      items,
      total_amount: Number(formData.totalAmount || calculateOrderTotal(items)),
      note: formData.note || "",
      currency: formData.currency || "TRY",
    };

    const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const deliveredQuantity = items.reduce((sum, item) => sum + Number(item.deliveredQuantity || 0), 0);
    if (deliveredQuantity >= totalQuantity && totalQuantity > 0) {
      payload.status = "Teslim Edildi";
      payload.delivery_date = payload.delivery_date || getToday();
    } else if (deliveredQuantity > 0) {
      payload.status = "Kısmi Teslim";
    }

    const request = editingId
      ? supabase
          .from("orders")
          .update(payload)
          .eq("id", editingId)
          .eq("user_id", user.id)
          .select("id")
          .single()
      : supabase.from("orders").insert(payload).select("id").single();

    const { data: savedOrder, error } = await request;
    isSubmittingRef.current = false;

    if (error) {
      console.error(error);
      setMessage("Sipariş kaydedilemedi.");
      return;
    }

    if (savedOrder?.id) {
      router.push(`/dashboard/siparisler/${savedOrder.id}`);
      return;
    }

    resetForm();
    await loadData();
  }

  async function handleDelete(id) {
    const confirmed = window.confirm("Bu sipariş silinsin mi?");
    if (!confirmed) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { error } = await supabase
      .from("orders")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      setMessage("Sipariş silinemedi.");
      return;
    }

    setOrders((prev) => prev.filter((order) => order.id !== id));
  }

  return (
    <div className="bg-slate-100">
      <main className="p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-green-100 px-4 py-2 text-sm font-bold text-green-700">
                Sipariş Yönetimi
              </div>
              <h1 className="mt-3 text-4xl font-bold text-slate-900">Siparişler</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Raporlardan gelen veya manuel oluşturulan siparişleri durum, termin ve teslimat
                bilgileriyle takip edin.
              </p>
            </div>

            <button
              type="button"
              onClick={showForm ? resetForm : startNewOrder}
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700"
            >
              {showForm ? "Formu Kapat" : "+ Yeni Sipariş"}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <StatCard title="Toplam Sipariş" value={enrichedOrders.length} text="Kayıtlı sipariş" />
            <StatCard title="Toplam Tutar" value={formatMoney(totalAmount)} text="Tüm siparişler" />
            <StatCard title="Bekleyen" value={waitingCount} text="Aksiyon bekliyor" />
            <StatCard title="Teslim Edilen" value={deliveredCount} text="Tamamlandı" />
            <StatCard title="Geciken" value={delayedCount} text="Termin aşıldı" />
          </div>

          {message && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-900">
              {message}
            </div>
          )}

          {showForm && (
            <OrderForm
              formData={formData}
              suppliers={suppliers}
              editingId={editingId}
              onChange={handleChange}
              onSupplierChange={handleSupplierChange}
              onItemChange={updateOrderItem}
              onAddItem={addOrderItem}
              onDeleteItem={deleteOrderItem}
              onCancel={resetForm}
              onSubmit={handleSubmit}
            />
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_220px_180px]">
              <input
                placeholder="Sipariş no, firma veya ürün ara..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm"
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm"
              >
                <option>Tümü</option>
                {statusOptions.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={startNewOrder}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white"
              >
                + Yeni Sipariş
              </button>
            </div>
          </div>

          <OrdersTable
            orders={filteredOrders}
            onView={(order) => router.push(`/dashboard/siparisler/${order.id}`)}
            onEdit={startEdit}
            onDelete={handleDelete}
          />

          <TerminTable orders={enrichedOrders} />
        </div>
      </main>
    </div>
  );
}

function OrderForm({
  formData,
  suppliers,
  editingId,
  onChange,
  onSupplierChange,
  onItemChange,
  onAddItem,
  onDeleteItem,
  onCancel,
  onSubmit,
}) {
  const items = normalizeItems(formData.items);

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {editingId ? "Siparişi Düzenle" : "Sipariş Oluştur"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Rapor verileri geldiyse ürün kalemleri otomatik dolar; istersen elle de ekleyebilirsin.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700"
        >
          Vazgeç
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Input label="Sipariş No" name="orderNo" value={formData.orderNo} onChange={onChange} />
        <SupplierInput
          label="Firma"
          name="company"
          value={formData.company}
          onChange={onSupplierChange}
          suppliers={suppliers}
        />
        <Input label="Sipariş Başlığı" name="product" value={formData.product} onChange={onChange} />
        <Select
          label="Durum"
          name="status"
          value={formData.status}
          onChange={onChange}
          options={statusOptions}
        />
        <Input
          label="Sipariş Tarihi"
          name="orderDate"
          type="date"
          value={formData.orderDate}
          onChange={onChange}
        />
        <Input
          label="Termin Tarihi"
          name="dueDate"
          type="date"
          value={formData.dueDate}
          onChange={onChange}
        />
        <Input
          label="Teslim Tarihi"
          name="deliveryDate"
          type="date"
          value={formData.deliveryDate}
          onChange={onChange}
        />
        <Select
          label="Para Birimi"
          name="currency"
          value={formData.currency}
          onChange={onChange}
          options={["TRY", "USD", "EUR", "GBP"]}
        />
      </div>

      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-bold text-slate-700">Not</span>
        <textarea
          name="note"
          value={formData.note}
          onChange={onChange}
          rows={2}
          className="w-full rounded-xl border border-slate-300 p-3 text-sm"
        />
      </label>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Ürün Kalemleri</h3>
          <button
            type="button"
            onClick={onAddItem}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700"
          >
            + Ürün Ekle
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white text-slate-500">
              <tr>
                <th className="p-3">Ürün / Rapor</th>
                <th className="p-3">Miktar</th>
                <th className="p-3">Gelen</th>
                <th className="p-3">Kalan</th>
                <th className="p-3">Birim Fiyat</th>
                <th className="p-3">İskonto</th>
                <th className="p-3">Tutar</th>
                <th className="p-3">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.productName}-${index}`} className="border-t border-slate-200">
                  <td className="p-3">
                    <input
                      value={item.productName}
                      onChange={(event) => onItemChange(index, "productName", event.target.value)}
                      className="w-full rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-3">
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(event) => onItemChange(index, "quantity", event.target.value)}
                      className="w-24 rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max={item.quantity}
                        value={item.deliveredQuantity}
                        onChange={(event) =>
                          onItemChange(index, "deliveredQuantity", event.target.value)
                        }
                        className="w-24 rounded border border-slate-300 px-2 py-1"
                      />
                      <button
                        type="button"
                        onClick={() => onItemChange(index, "deliveredQuantity", item.quantity)}
                        className="whitespace-nowrap rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-bold text-green-700"
                      >
                        Tamamı
                      </button>
                    </div>
                  </td>
                  <td className="p-3 font-semibold text-slate-700">
                    {Math.max(Number(item.quantity || 0) - Number(item.deliveredQuantity || 0), 0)}
                  </td>
                  <td className="p-3">
                    <input
                      type="number"
                      value={item.unitPrice}
                      onChange={(event) => onItemChange(index, "unitPrice", event.target.value)}
                      className="w-28 rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-3">
                    <input
                      type="number"
                      value={item.discount}
                      onChange={(event) => onItemChange(index, "discount", event.target.value)}
                      className="w-20 rounded border border-slate-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-3 font-bold">{formatMoney(item.total, formData.currency)}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => onDeleteItem(index)}
                      className="rounded bg-red-600 px-3 py-1 text-xs font-bold text-white"
                    >
                      Sil
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan="8" className="p-5 text-center text-slate-500">
                    Henüz ürün kalemi yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <div className="rounded-xl bg-white px-5 py-3 text-right shadow-sm">
            <div className="text-sm text-slate-500">Toplam Tutar</div>
            <div className="mt-1 text-xl font-black text-slate-900">
              {formatMoney(formData.totalAmount, formData.currency)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-xl border px-5 py-3 text-sm font-bold">
          İptal
        </button>
        <button
          type="submit"
          className="rounded-xl bg-green-600 px-5 py-3 text-sm font-bold text-white hover:bg-green-700"
        >
          {editingId ? "Kaydet" : "Siparişi Oluştur"}
        </button>
      </div>
    </form>
  );
}

function OrdersTable({ orders, onView, onEdit, onDelete }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <h2 className="text-xl font-bold text-slate-900">Sipariş Listesi</h2>
        <p className="mt-1 text-sm text-slate-500">Durum ve termin odaklı sipariş görünümü.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-4">Sipariş No</th>
              <th className="p-4">Firma</th>
              <th className="p-4">Tarih</th>
              <th className="p-4">Termin</th>
              <th className="p-4">Toplam Tutar</th>
              <th className="p-4">Durum</th>
              <th className="p-4">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-slate-100">
                <td className="p-4 font-bold text-slate-900">{order.order_no}</td>
                <td className="p-4">{order.supplier_name}</td>
                <td className="p-4">{order.order_date || "-"}</td>
                <td className="p-4">{order.termin_date || "-"}</td>
                <td className="p-4 font-semibold">
                  {formatMoney(order.total_amount, order.currency || "TRY")}
                </td>
                <td className="p-4">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(order.status)}`}>
                    {order.status}
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onView(order)}
                      className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700"
                    >
                      Detay
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(order)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold"
                    >
                      Düzenle
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(order.id)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600"
                    >
                      Sil
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan="7" className="p-8 text-center text-slate-500">
                  Henüz sipariş kaydı yok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TerminTable({ orders }) {
  const dueOrders = [...orders]
    .filter((order) => order.status !== "Teslim Edildi" && order.status !== "İptal")
    .sort((a, b) => new Date(a.termin_date || "2999-01-01") - new Date(b.termin_date || "2999-01-01"))
    .slice(0, 6);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">Termin Takip Görünümü</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3">Sipariş No</th>
              <th className="p-3">Firma</th>
              <th className="p-3">Termin</th>
              <th className="p-3">Kalan Süre</th>
              <th className="p-3">Durum</th>
            </tr>
          </thead>
          <tbody>
            {dueOrders.map((order) => {
              const remaining = daysUntil(order.termin_date);
              return (
                <tr key={order.id} className="border-t border-slate-100">
                  <td className="p-3 font-bold">{order.order_no}</td>
                  <td className="p-3">{order.supplier_name}</td>
                  <td className="p-3">{order.termin_date || "-"}</td>
                  <td className="p-3">
                    {remaining === null ? (
                      "-"
                    ) : (
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          remaining < 0
                            ? "bg-red-100 text-red-700"
                            : remaining <= 7
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {remaining < 0 ? `${Math.abs(remaining)} gün geçti` : `${remaining} gün kaldı`}
                      </span>
                    )}
                  </td>
                  <td className="p-3">{order.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

function SupplierInput({ label, name, value, onChange, suppliers }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <input
        list="supplier-options"
        name={name}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-slate-300 p-3 text-sm"
      />
      <datalist id="supplier-options">
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.name}>
            {supplier.status || "Aktif"}
          </option>
        ))}
      </datalist>
    </label>
  );
}
