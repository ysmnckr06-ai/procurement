"use client";

import { useEffect, useMemo, useState } from "react";

const initialOrders = [
  {
    id: 1,
    orderNo: "SIP-1001",
    company: "ABC Teknoloji",
    product: "Laptop",
    quantity: 10,
    orderDate: "2026-04-10",
    dueDate: "2026-04-18",
    deliveryDate: "",
    status: "Bekliyor",
  },
  {
    id: 2,
    orderNo: "SIP-1002",
    company: "Yıldız Medikal",
    product: "Eldiven",
    quantity: 250,
    orderDate: "2026-04-08",
    dueDate: "2026-04-15",
    deliveryDate: "2026-04-14",
    status: "Teslim Edildi",
  },
  {
    id: 3,
    orderNo: "SIP-1003",
    company: "Demir Ofis",
    product: "Yazıcı",
    quantity: 4,
    orderDate: "2026-04-05",
    dueDate: "2026-04-12",
    deliveryDate: "",
    status: "Bekliyor",
  },
];

const emptyForm = {
  orderNo: "",
  company: "",
  product: "",
  quantity: "",
  orderDate: "",
  dueDate: "",
  deliveryDate: "",
  status: "Bekliyor",
};

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
  if (!order.dueDate) return 0;

  const due = new Date(order.dueDate);
  const endDate = order.deliveryDate ? new Date(order.deliveryDate) : new Date();

  const diff = Math.ceil((endDate - due) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function getSmartStatus(order) {
  if (order.status === "Teslim Edildi") return "Teslim Edildi";
  if (order.status === "İptal") return "İptal";

  if (!order.deliveryDate && new Date(order.dueDate) < new Date()) {
    return "Gecikti";
  }

  return order.status;
}

function createOrderNo() {
  return `SIP-${Date.now().toString().slice(-5)}`;
}

function getToday() {
  return new Date().toISOString().split("T")[0];
}

export default function OrdersPage() {
  const [orders, setOrders] = useState(initialOrders);
  const [searchCompany, setSearchCompany] = useState("");
  const [searchProduct, setSearchProduct] = useState("");
  const [statusFilter, setStatusFilter] = useState("Tümü");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [sortConfig, setSortConfig] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [autoOrderMessage, setAutoOrderMessage] = useState("");

  useEffect(() => {
    const pendingOrder = localStorage.getItem("pendingOrder");

    if (pendingOrder) {
      const parsedOrder = JSON.parse(pendingOrder);

      setFormData({
        orderNo: createOrderNo(),
        company: parsedOrder.company || "",
        product: parsedOrder.product || "",
        quantity: parsedOrder.quantity || "",
        orderDate: getToday(),
        dueDate: parsedOrder.dueDate || "",
        deliveryDate: "",
        status: "Bekliyor",
      });

      setShowForm(true);
      setEditingId(null);
      setAutoOrderMessage(
        "Raporlardan gelen sipariş bilgileri forma aktarıldı."
      );

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
      const matchCompany = order.company
        .toLowerCase()
        .includes(searchCompany.toLowerCase());

      const matchProduct = order.product
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
        const valueA = a[sortConfig.key];
        const valueB = b[sortConfig.key];

        if (valueA < valueB) return sortConfig.direction === "asc" ? -1 : 1;
        if (valueA > valueB) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return sortable;
  }, [filteredOrders, sortConfig]);

  const totalOrders = ordersWithSmartStatus.length;
  const waitingOrders = ordersWithSmartStatus.filter(
    (o) => o.status === "Bekliyor"
  ).length;
  const deliveredOrders = ordersWithSmartStatus.filter(
    (o) => o.status === "Teslim Edildi"
  ).length;
  const delayedOrders = ordersWithSmartStatus.filter(
    (o) => o.status === "Gecikti"
  ).length;

  function handleSort(key) {
    let direction = "asc";

    if (
      sortConfig &&
      sortConfig.key === key &&
      sortConfig.direction === "asc"
    ) {
      direction = "desc";
    }

    setSortConfig({ key, direction });
  }

  function handleChange(e) {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function resetForm() {
    setFormData(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setAutoOrderMessage("");
  }

  function handleSubmit(e) {
    e.preventDefault();

    if (
      !formData.orderNo ||
      !formData.company ||
      !formData.product ||
      !formData.quantity ||
      !formData.orderDate ||
      !formData.dueDate ||
      !formData.status
    ) {
      alert("Lütfen zorunlu alanları doldurun.");
      return;
    }

    if (editingId) {
      setOrders((prev) =>
        prev.map((order) =>
          order.id === editingId
            ? {
                ...order,
                orderNo: formData.orderNo,
                company: formData.company,
                product: formData.product,
                quantity: Number(formData.quantity),
                orderDate: formData.orderDate,
                dueDate: formData.dueDate,
                deliveryDate: formData.deliveryDate,
                status: formData.status,
              }
            : order
        )
      );
    } else {
      const newOrder = {
        id: Date.now(),
        orderNo: formData.orderNo,
        company: formData.company,
        product: formData.product,
        quantity: Number(formData.quantity),
        orderDate: formData.orderDate,
        dueDate: formData.dueDate,
        deliveryDate: formData.deliveryDate,
        status: formData.status,
      };

      setOrders((prev) => [newOrder, ...prev]);
    }

    resetForm();
  }

  function handleDelete(id) {
    const confirmed = window.confirm("Bu sipariş silinsin mi?");
    if (!confirmed) return;

    setOrders((prev) => prev.filter((order) => order.id !== id));

    if (editingId === id) {
      resetForm();
    }
  }

  function handleEdit(order) {
    setFormData({
      orderNo: order.orderNo,
      company: order.company,
      product: order.product,
      quantity: order.quantity,
      orderDate: order.orderDate,
      dueDate: order.dueDate,
      deliveryDate: order.deliveryDate || "",
      status: order.status,
    });

    setEditingId(order.id);
    setShowForm(true);
    setAutoOrderMessage("");
  }

  function handleNewOrder() {
    if (showForm && !editingId) {
      setShowForm(false);
      setFormData(emptyForm);
      setAutoOrderMessage("");
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Siparişler</h1>
          <p className="text-sm text-gray-500">
            Manuel veya raporlardan gelen siparişleri buradan yönetebilirsiniz.
          </p>
        </div>

        <button
          onClick={handleNewOrder}
          className="rounded-lg bg-black text-white px-4 py-2"
        >
          {showForm && !editingId ? "Formu Kapat" : "+ Yeni Sipariş"}
        </button>
      </div>

      {autoOrderMessage && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
          {autoOrderMessage}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Toplam Sipariş</p>
          <h2 className="text-2xl font-bold mt-2">{totalOrders}</h2>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Bekleyen Sipariş</p>
          <h2 className="text-2xl font-bold mt-2">{waitingOrders}</h2>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Teslim Edilen</p>
          <h2 className="text-2xl font-bold mt-2">{deliveredOrders}</h2>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Geciken Sipariş</p>
          <h2 className="text-2xl font-bold mt-2">{delayedOrders}</h2>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border bg-white p-4 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {editingId ? "Siparişi Düzenle" : "Yeni Sipariş Oluştur"}
            </h2>

            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border px-3 py-2"
            >
              Vazgeç
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <input
              type="text"
              name="orderNo"
              placeholder="Sipariş No"
              value={formData.orderNo}
              onChange={handleChange}
              className="border rounded-lg p-2"
            />

            <input
              type="text"
              name="company"
              placeholder="Firma"
              value={formData.company}
              onChange={handleChange}
              className="border rounded-lg p-2"
            />

            <input
              type="text"
              name="product"
              placeholder="Ürün"
              value={formData.product}
              onChange={handleChange}
              className="border rounded-lg p-2"
            />

            <input
              type="number"
              name="quantity"
              placeholder="Miktar"
              value={formData.quantity}
              onChange={handleChange}
              className="border rounded-lg p-2"
            />

            <input
              type="date"
              name="orderDate"
              value={formData.orderDate}
              onChange={handleChange}
              className="border rounded-lg p-2"
            />

            <input
              type="date"
              name="dueDate"
              value={formData.dueDate}
              onChange={handleChange}
              className="border rounded-lg p-2"
            />

            <input
              type="date"
              name="deliveryDate"
              value={formData.deliveryDate}
              onChange={handleChange}
              className="border rounded-lg p-2"
            />

            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              className="border rounded-lg p-2"
            >
              <option>Bekliyor</option>
              <option>Hazırlanıyor</option>
              <option>Yolda</option>
              <option>Teslim Edildi</option>
              <option>Gecikti</option>
              <option>İptal</option>
            </select>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-black text-white px-4 py-2"
            >
              {editingId ? "Kaydet" : "Siparişi Oluştur"}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <input
          placeholder="Firma ara..."
          value={searchCompany}
          onChange={(e) => setSearchCompany(e.target.value)}
          className="border p-2 rounded-lg"
        />

        <input
          placeholder="Ürün ara..."
          value={searchProduct}
          onChange={(e) => setSearchProduct(e.target.value)}
          className="border p-2 rounded-lg"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border p-2 rounded-lg"
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

      <div className="border rounded-2xl overflow-hidden bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 text-left">Sipariş No</th>

              <th
                onClick={() => handleSort("company")}
                className="p-3 text-left cursor-pointer"
              >
                Firma ⬍
              </th>

              <th
                onClick={() => handleSort("product")}
                className="p-3 text-left cursor-pointer"
              >
                Ürün ⬍
              </th>

              <th
                onClick={() => handleSort("quantity")}
                className="p-3 text-left cursor-pointer"
              >
                Miktar ⬍
              </th>

              <th className="p-3 text-left">Sipariş Tarihi</th>

              <th
                onClick={() => handleSort("dueDate")}
                className="p-3 text-left cursor-pointer"
              >
                Termin ⬍
              </th>

              <th className="p-3 text-left">Teslim Tarihi</th>

              <th
                onClick={() => handleSort("delayDays")}
                className="p-3 text-left cursor-pointer"
              >
                Gecikme ⬍
              </th>

              <th className="p-3 text-left">Durum</th>
              <th className="p-3 text-left">İşlem</th>
            </tr>
          </thead>

          <tbody>
            {sortedOrders.map((o) => (
              <tr key={o.id} className="border-t">
                <td className="p-3">{o.orderNo}</td>
                <td className="p-3">{o.company}</td>
                <td className="p-3">{o.product}</td>
                <td className="p-3">{o.quantity}</td>
                <td className="p-3">{o.orderDate}</td>
                <td className="p-3">{o.dueDate}</td>
                <td className="p-3">{o.deliveryDate || "-"}</td>
                <td className="p-3">
                  {o.delayDays > 0 ? `${o.delayDays} gün` : "-"}
                </td>

                <td className="p-3">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusClass(
                      o.status
                    )}`}
                  >
                    {o.status}
                  </span>
                </td>

                <td className="p-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(o)}
                      className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50"
                    >
                      Düzenle
                    </button>

                    <button
                      onClick={() => handleDelete(o.id)}
                      className="rounded-lg border px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                    >
                      Sil
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {sortedOrders.length === 0 && (
              <tr>
                <td colSpan="10" className="p-4 text-center text-gray-500">
                  Kayıt yok
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}