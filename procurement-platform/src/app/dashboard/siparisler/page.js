"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

const emptyForm = {
  orderNo: "",
  company: "",
  product: "",
  quantity: 1,

  items: [],
  totalAmount: 0,
  note: "",
  currency: "TRY",

  orderDate: "",
  dueDate: "",
  deliveryDate: "",
  status: "Bekliyor",
};

function createOrderNo(count = 0) {
  return `SIP-${String(count + 1).padStart(5, "0")}`;

}

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function formatMoney(value, currency = "TRY") {
  const number = Number(value || 0);

  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number) + " " + currency;
}

function getStatusClass(status) {
  switch (status) {
    case "Bekliyor":
      return "bg-yellow-100 text-yellow-700";
    case "Hazırlanıyor":
      return "bg-blue-100 text-blue-700";
    case "Yolda":
      return "bg-purple-100 text-purple-700";
    case "Teslim Edildi":
      return "bg-green-100 text-green-700";
    case "Gecikti":
      return "bg-red-100 text-red-700";
    case "İptal":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function calculateDelayDays(order) {
  if (!order.termin_date) return 0;

  const due = new Date(order.termin_date);

  const endDate = order.delivery_date
    ? new Date(order.delivery_date)
    : new Date();

  const diff = Math.ceil(
    (endDate - due) / (1000 * 60 * 60 * 24)
  );

  return diff > 0 ? diff : 0;
}

function getSmartStatus(order) {
  if (order.status === "Teslim Edildi") {
    return "Teslim Edildi";
  }

  if (order.status === "İptal") {
    return "İptal";
  }

  if (
    order.termin_date &&
    !order.delivery_date &&
    new Date(order.termin_date) < new Date()
  ) {
    return "Gecikti";
  }

  return order.status;
}

function StatCard({ icon, title, value, text }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
          {icon}
        </div>
        <div>
          <div className="text-sm text-slate-500">{title}</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{value}</div>
          <div className="text-sm text-slate-500">{text}</div>
        </div>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const isSubmittingRef = useRef(false);
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [searchCompany, setSearchCompany] = useState("");
  const [searchProduct, setSearchProduct] = useState("");
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [sortConfig, setSortConfig] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [autoOrderMessage, setAutoOrderMessage] = useState("");

  useEffect(() => {
    loadOrders();
    async function loadOrders() {
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
        console.error("Siparişler yüklenemedi:", error);
        return;
      }

      setOrders(data || []);
    }


    const pendingOrder = localStorage.getItem("pendingOrder");

    if (pendingOrder) {
      const parsedOrder = JSON.parse(pendingOrder);

      const items = parsedOrder.items || [];

      setFormData({
        orderNo: createOrderNo(orders.length),

        company: parsedOrder.company || "",

        product:
          parsedOrder.reportName ||
          "Karşılaştırma Raporu",

        quantity: items.length || 1,

        orderDate: getToday(),

        dueDate: parsedOrder.dueDate || "",

        deliveryDate: "",

       status: "Bekliyor",

  reportId: parsedOrder.reportId || null,

  items,

  totalAmount: items.reduce(
    (sum, item) =>
      sum + Number(item.total || 0),
    0
  ),

  note: "",
});
      setShowForm(true);
      setEditingId(null);
      setAutoOrderMessage("Raporlardan gelen sipariş bilgileri forma aktarıldı ✅");
      localStorage.removeItem("pendingOrder");
    }
  }, []);


  const ordersWithSmartStatus = useMemo(() => {
    return orders.map((order) => ({
      ...order,
      status: getSmartStatus(order),
      delayDays: calculateDelayDays(order),
    }));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return ordersWithSmartStatus.filter((order) => {
      const matchCompany = String(order.company || "")
        .toLowerCase()
        .includes(searchCompany.toLowerCase());

      const matchProduct = String(order.product || "")
        .toLowerCase()
        .includes(searchProduct.toLowerCase());

      const matchStatus =
        statusFilter === "Tümü" ? true : order.status === statusFilter;

      return matchCompany && matchProduct && matchStatus;
    });
  }, [ordersWithSmartStatus, searchCompany, searchProduct, statusFilter]);

  const sortedOrders = useMemo(() => {
    const sortable = [...filteredOrders];

    if (sortConfig) {
      sortable.sort((a, b) => {
        const valueA = a[sortConfig.key] || "";
        const valueB = b[sortConfig.key] || "";

        if (valueA < valueB) return sortConfig.direction === "asc" ? -1 : 1;
        if (valueA > valueB) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return sortable;
  }, [filteredOrders, sortConfig]);

  const totalOrders = ordersWithSmartStatus.length;
  const waitingOrders = ordersWithSmartStatus.filter((o) => o.status === "Bekliyor").length;
  const deliveredOrders = ordersWithSmartStatus.filter((o) => o.status === "Teslim Edildi").length;
  const delayedOrders = ordersWithSmartStatus.filter((o) => o.status === "Gecikti").length;

  function handleSort(key) {
    let direction = "asc";

    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }

    setSortConfig({ key, direction });
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function updateOrderItem(index, field, value) {
  setFormData((prev) => {
    const items = [...(prev.items || [])];

    items[index] = {
      ...items[index],
      [field]: value,
    };

    const quantity = Number(items[index].quantity || 0);
    const unitPrice = Number(items[index].unitPrice || 0);
    const discount = Number(items[index].discount || 0);

    const netUnitPrice = unitPrice - (unitPrice * discount) / 100;
    const total = quantity * netUnitPrice;

    items[index].netUnitPrice = netUnitPrice;
    items[index].total = total;

    return {
      ...prev,
      items,
      quantity: items.length,
      totalAmount: items.reduce(
        (sum, item) => sum + Number(item.total || 0),
        0
      ),
    };
  });
  }

  function deleteOrderItem(index) {
  setFormData((prev) => {
    const items = [...(prev.items || [])];
    items.splice(index, 1);

    return {
      ...prev,
      items,
      quantity: items.length,
      totalAmount: items.reduce(
        (sum, item) => sum + Number(item.total || 0),
        0
      ),
    };
  });
  }

  function addOrderItem() {
  setFormData((prev) => {
    const items = [
      ...(prev.items || []),
      {
        productCode: "",
        productName: "",
        unit: "adet",
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        netUnitPrice: 0,
        total: 0,
        paymentTerm: "",
        deliveryTerm: "",
        currency: "TRY",
      },
    ];

    return {
      ...prev,
      items,
      quantity: items.length,
      totalAmount: items.reduce(
        (sum, item) => sum + Number(item.total || 0),
        0
      ),
    };
  });
}

  function resetForm() {
    setFormData(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setAutoOrderMessage("");
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    if (
      !formData.orderNo ||
      !formData.company ||
      !formData.product ||
      !formData.quantity ||
      !formData.orderDate ||
      !formData.status
    ) {
    alert("Lütfen zorunlu alanları doldurun.");
    isSubmittingRef.current = false;
    return;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    alert("Kullanıcı bulunamadı.");
    return;
  }
  
if (!editingId && formData.reportId) {
  const { data: existingOrder, error: existingError } = await supabase
    .from("orders")
    .select("id")
    .eq("user_id", user.id)
    .eq("report_id", formData.reportId)
    .limit(1);

  if (existingError) {
    alert("Sipariş kontrolü yapılamadı: " + existingError.message);
    isSubmittingRef.current = false;
    return;
  }

  if (existingOrder && existingOrder.length > 0) {
    alert("Bu rapor için zaten sipariş oluşturulmuş.");
    isSubmittingRef.current = false;
    return;
  }
}

const payload = {
  user_id: user.id,
  order_no: formData.orderNo,
  supplier_name: formData.company,
  product_name: formData.product,
  quantity: Number(formData.quantity),
  order_date: formData.orderDate || null,
  termin_date: formData.dueDate || null,
  delivery_date: formData.deliveryDate || null,
  status: formData.status,
  report_id: formData.reportId || null,

  items: formData.items || [],
  total_amount: Number(formData.totalAmount || 0),
  note: formData.note || "",
  currency: formData.currency || "TRY",
};
  if (editingId) {
    const { error } = await supabase
      .from("orders")
      .update(payload)
      .eq("id", editingId)
      .eq("user_id", user.id);

    if (error) {
      alert("Sipariş güncellenemedi: " + error.message);
      isSubmittingRef.current = false;
      return;
    }
  } else {
    const { error } = await supabase
      .from("orders")
      .insert(payload);

    if (error) {
      alert("Sipariş oluşturulamadı: " + error.message);
      isSubmittingRef.current = false;
      return;
    }
  }

  window.location.reload();
  resetForm();
  }

  async function handleDelete(id) {
  const confirmed = window.confirm("Bu sipariş silinsin mi?");
  if (!confirmed) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    alert("Kullanıcı bulunamadı.");
    isSubmittingRef.current = false;
    return;
  }

  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    alert("Sipariş silinemedi: " + error.message);
    return;
  }

  setOrders((prev) => prev.filter((order) => order.id !== id));
  }

function handleEdit(order) {
  setFormData({
    orderNo: order.order_no || "",
    company: order.supplier_name || "",
    product: order.product_name || "",
    quantity: order.quantity || (order.items?.length || 1),

    orderDate: order.order_date || "",
    dueDate: order.termin_date || "",
    deliveryDate: order.delivery_date || "",

    status: order.status || "Bekliyor",
    reportId: order.report_id || null,

    items: order.items || [],
    totalAmount: Number(order.total_amount || 0),
    note: order.note || "",
    currency: order.currency || "TRY",
  });

  setEditingId(order.id);
  setShowForm(true);
  setAutoOrderMessage("");
}

  function handleNewOrder() {
    if (showForm && !editingId) {
      resetForm();
      return;
    }

    setEditingId(null);
    setFormData({
      ...emptyForm,
      orderNo: createOrderNo(),
      orderDate: getToday(),
    });
    setShowForm(true);
    setAutoOrderMessage("");
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

              <h1 className="mt-3 text-4xl font-bold text-slate-900">
                Siparişler
              </h1>

              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Manuel veya raporlardan gelen siparişleri oluşturun, takip edin ve teslimat durumlarını yönetin.
              </p>
            </div>

            <button
              onClick={handleNewOrder}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              {showForm && !editingId ? "Formu Kapat" : "+ Yeni Sipariş"}
            </button>
          </div>

          {autoOrderMessage && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
              {autoOrderMessage}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard icon="🛒" title="Toplam Sipariş" value={totalOrders} text="Kayıtlı sipariş" />
            <StatCard icon="⏳" title="Bekleyen" value={waitingOrders} text="İşlem bekliyor" />
            <StatCard icon="✅" title="Teslim Edilen" value={deliveredOrders} text="Tamamlandı" />
            <StatCard icon="⚠️" title="Geciken" value={delayedOrders} text="Termin aşıldı" />
          </div>

          {showForm && (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {editingId ? "Siparişi Düzenle" : "Yeni Sipariş Oluştur"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Zorunlu alanları doldurup siparişi kaydedin.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  Vazgeç
                </button>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input name="orderNo" label="Sipariş No" value={formData.orderNo} onChange={handleChange} />
                <Input name="company" label="Firma" value={formData.company} onChange={handleChange} />
                <Input name="product" label="Sipariş Başlığı" value={formData.product} onChange={handleChange} />
                <Input name="quantity" label="Kalem Sayısı" type="number" value={formData.quantity} onChange={handleChange} />
                <Input name="orderDate" label="Sipariş Tarihi" type="date" value={formData.orderDate} onChange={handleChange} />
                <Input name="deliveryDate" label="Teslim Tarihi" type="date" value={formData.deliveryDate} onChange={handleChange} />
              <div>
  <label className="mb-2 block text-sm font-bold text-slate-700">
    Para Birimi
  </label>

  <select
    name="currency"
    value={formData.currency || "TRY"}
    onChange={handleChange}
    className="w-full rounded-xl border border-slate-300 p-3 text-sm"
  >
    <option value="TRY">TRY - Türk Lirası</option>
    <option value="USD">USD - Amerikan Doları</option>
    <option value="EUR">EUR - Euro</option>
    <option value="GBP">GBP - Sterlin</option>
  </select>
</div>

<div>
 
                  <label className="mb-2 block text-sm font-bold text-slate-700">
                    Durum
                  </label>
                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm"
                  >
                    <option>Bekliyor</option>
                    <option>Hazırlanıyor</option>
                    <option>Yolda</option>
                    <option>Teslim Edildi</option>
                    <option>Gecikti</option>
                    <option>İptal</option>
                  </select>
                </div>
              </div>
{formData.items?.length > 0 && (
  <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
<div className="mb-3 flex items-center justify-between">
  <h3 className="text-lg font-bold text-slate-900">
    Siparişe Aktarılan Ürün Kalemleri
  </h3>

  <button
    type="button"
    onClick={addOrderItem}
    className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
  >
    + Yeni Kalem Ekle
  </button>
</div>

    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-white text-slate-500">
          <tr>
            <th className="p-3">Ürün Kodu</th>
            <th className="p-3">Ürün Açıklaması</th>
            <th className="p-3">Birim</th>
            <th className="p-3">Miktar</th>
            <th className="p-3">Birim Fiyat</th>
            <th className="p-3">İskonto</th>
            <th className="p-3">Net Fiyat</th>
            <th className="p-3">Toplam</th>
            <th className="p-3">Vade</th>
            <th className="p-3">Termin</th>
            <th className="p-3">İşlem</th>
          </tr>
        </thead>

        <tbody>
          {formData.items.map((item, index) => (
            <tr key={index} className="border-t border-slate-200">
              <td className="p-3">
  <input
    className="w-full border rounded px-2 py-1"
    value={item.productCode || ""}
    onChange={(e) =>
      updateOrderItem(index, "productCode", e.target.value)
    }
  />
</td>
              <td className="p-3">
  <input
    className="w-full border rounded px-2 py-1"
    value={item.productName || ""}
    onChange={(e) =>
      updateOrderItem(index, "productName", e.target.value)
    }
  />
</td>
              <td className="p-3">
  <input
    className="w-16 border rounded px-2 py-1"
    value={item.unit || ""}
    onChange={(e) =>
      updateOrderItem(index, "unit", e.target.value)
    }
  />
</td>
              <td className="p-3">
  <input
    type="number"
    className="w-20 border rounded px-2 py-1"
    value={item.quantity || 0}
    onChange={(e) =>
      updateOrderItem(index, "quantity", e.target.value)
    }
  />
</td>
              <td className="p-3">
  <input
    type="number"
    className="w-24 border rounded px-2 py-1"
    value={item.unitPrice || 0}
    onChange={(e) =>
      updateOrderItem(index, "unitPrice", e.target.value)
    }
  />
</td>
              <td className="p-3">
  <input
    type="number"
    className="w-20 border rounded px-2 py-1"
    value={item.discount || 0}
    onChange={(e) =>
      updateOrderItem(index, "discount", e.target.value)
    }
  />
</td>
              <td className="p-3 font-semibold">
  {formatMoney(item.netUnitPrice, item.currency || "TRY")}
</td>
              <td className="p-3 font-bold">
  {formatMoney(item.total, item.currency || "TRY")}
</td>
              <td className="p-3">
  <input
    className="w-24 border rounded px-2 py-1"
    value={item.paymentTerm || ""}
    onChange={(e) =>
      updateOrderItem(index, "paymentTerm", e.target.value)
    }
  />
</td>
              <td className="p-3">
  <input
    className="w-24 border rounded px-2 py-1"
    value={item.deliveryTerm || ""}
    onChange={(e) =>
      updateOrderItem(index, "deliveryTerm", e.target.value)
    }
  />
</td>
              <td className="p-3">
  <button
    type="button"
    onClick={() => deleteOrderItem(index)}
    className="rounded bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-700"
  >
    Sil
  </button>
</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex justify-end">
  <div className="rounded-xl bg-white px-5 py-3 shadow-sm text-right">
    <div className="text-sm text-slate-500">
      Toplam Kalem: {formData.items?.length || 0}
    </div>

    <div className="mt-1 text-lg font-black text-slate-900">
      Genel Toplam: {formatMoney(formData.totalAmount, formData.currency || "TRY")}
    </div>
  </div>
</div>
    </div>
  </div>
)}
              <div className="mt-5 flex justify-end">
                <button
                  type="submit"
                  className="rounded-xl bg-green-600 px-5 py-3 text-sm font-bold text-white hover:bg-green-700"
                >
                  {editingId ? "Kaydet" : "Siparişi Oluştur"}
                </button>
              </div>
            </form>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <input
                placeholder="Firma ara..."
                value={searchCompany}
                onChange={(e) => setSearchCompany(e.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm"
              />

              <input
                placeholder="Ürün veya rapor ara..."
                value={searchProduct}
                onChange={(e) => setSearchProduct(e.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm"
              />

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-xl border border-slate-300 p-3 text-sm"
              >
                <option>Tümü</option>
                <option>Bekliyor</option>
                <option>Hazırlanıyor</option>
                <option>Yolda</option>
                <option>Teslim Edildi</option>
                <option>Gecikti</option>
                <option>İptal</option>
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-xl font-bold text-slate-900">
                Sipariş Listesi
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Oluşturulan tüm siparişler burada listelenir.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="p-4">Sipariş No</th>
                    <th onClick={() => handleSort("company")} className="cursor-pointer p-4">Firma ⬍</th>
                    <th onClick={() => handleSort("product")} className="cursor-pointer p-4">Ürün ⬍</th>
                    <th onClick={() => handleSort("quantity")} className="cursor-pointer p-4">Miktar ⬍</th>
                    <th className="p-4">Sipariş Tarihi</th>
                    <th onClick={() => handleSort("dueDate")} className="cursor-pointer p-4">Termin ⬍</th>
                    <th className="p-4">Teslim</th>
                    <th onClick={() => handleSort("delayDays")} className="cursor-pointer p-4">Gecikme ⬍</th>
                    <th className="p-4">Durum</th>
                    <th className="p-4">İşlem</th>
                  </tr>
                </thead>
                <tbody>
  {sortedOrders.map((o) => (
    <tr key={o.id} className="border-t border-slate-100">
      <td className="p-4 font-bold text-slate-800">
        {o.order_no}
      </td>

      <td className="p-4">
        {o.supplier_name}
      </td>

      <td className="p-4">
        {o.product_name}
      </td>

      <td className="p-4">
        {o.quantity}
      </td>

      <td className="p-4">
        {o.order_date}
      </td>

      <td className="p-4">
        {o.termin_date || "-"}
      </td>

      <td className="p-4">
        {o.delivery_date || "-"}
      </td>

      <td className="p-4">
        {o.delayDays > 0 ? `${o.delayDays} gün` : "-"}
      </td>

      <td className="p-4">
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(o.status)}`}
        >
          {o.status}
        </span>
      </td>

      <td className="p-4">
        <div className="flex gap-2">
          <button
            onClick={() => handleEdit(o)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold hover:bg-slate-50"
          >
            Düzenle
          </button>

          <button
            onClick={() => handleDelete(o.id)}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
          >
            Sil
          </button>
        </div>
      </td>
    </tr>
  ))}

  {sortedOrders.length === 0 && (
    <tr>
      <td
        colSpan="10"
        className="p-8 text-center text-slate-500"
      >
        Henüz sipariş kaydı yok.
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
    <div>
      <label className="mb-2 block text-sm font-bold text-slate-700">
        {label}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-slate-300 p-3 text-sm"
      />
    </div>
  );
}