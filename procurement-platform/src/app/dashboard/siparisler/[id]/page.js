"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { calculateBaseAmount, currencyOptions, getBaseCurrency, getExchangeRate } from "@/lib/currency";
import { findOrCreateBusinessPartner } from "@/lib/businessPartners";

const statusFlow = [
  "Taslak",
  "Onay Bekliyor",
  "Sipariş Geçildi",
  "Tedarikçiden Bekleniyor",
  "Kısmi Teslim",
  "Tam Teslim",
];

const statusActions = [
  { status: "Onay Bekliyor", label: "Durumu Güncelle" },
  { status: "Sipariş Geçildi", label: "Sipariş Geçildi" },
  { status: "Tedarikçiden Bekleniyor", label: "Tedarikçiden Bekleniyor" },
  { status: "İptal", label: "İptal Et", danger: true },
];

const editableStatusOptions = [
  "Taslak",
  "Onay Bekliyor",
  "Sipariş Geçildi",
  "Tedarikçiden Bekleniyor",
  "Kısmi Teslim",
  "Tam Teslim",
  "Gecikti",
  "İptal",
];

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function getNowStamp() {
  return new Date().toISOString();
}

function formatMoney(value, currency = "TRY") {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} ${currency}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeItems(items) {
  return (items || []).map((item) => {
    const quantity = Number(item.quantity || 0);
    const deliveredQuantity = Number(item.deliveredQuantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const total = Number(item.total || quantity * unitPrice);

    return {
      productCode: item.productCode || "",
      productName: item.productName || item.product || "",
      unit: item.unit || "adet",
      quantity,
      deliveredQuantity,
      unitPrice,
      total,
      paymentTerm: item.paymentTerm || "",
      status:
        deliveredQuantity >= quantity && quantity > 0
          ? "Tam Teslim"
          : deliveredQuantity > 0
            ? "Kısmi Teslim"
            : "Taslak",
    };
  });
}

function normalizeHistory(order) {
  const savedHistory = Array.isArray(order.status_history)
    ? order.status_history
    : [];
  const rows = [
    {
      type: "created",
      title: "Sipariş oluşturuldu.",
      actor: "Sistem",
      date: order.created_at || order.order_date,
    },
    ...savedHistory,
  ];

  if (
    savedHistory.length === 0 &&
    order.status &&
    order.status !== "Bekliyor"
  ) {
    rows.push({
      type: "status",
      title: `${order.status} durumuna alındı.`,
      actor: "Sistem",
      date: order.updated_at || order.order_date,
    });
  }

  if (order.delivery_date) {
    rows.push({
      type: "delivery",
      title: "Teslim tarihi kaydedildi.",
      actor: "Sistem",
      date: order.delivery_date,
    });
  }

  return rows.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
}

function getStatusClass(status) {
  const classes = {
    Taslak: "bg-slate-100 text-slate-700",
    "Onay Bekliyor": "bg-orange-100 text-orange-700",
    "Sipariş Geçildi": "bg-blue-100 text-blue-700",
    "Tedarikçiden Bekleniyor": "bg-sky-100 text-sky-700",
    "Kısmi Teslim": "bg-amber-100 text-amber-700",
    "Tam Teslim": "bg-green-100 text-green-700",
    "Teslim Edildi": "bg-green-100 text-green-700",
    Gecikti: "bg-red-100 text-red-700",
    İptal: "bg-slate-200 text-slate-700",
  };

  return classes[status] || "bg-slate-100 text-slate-700";
}

function getCurrentStep(status) {
  if (status === "İptal") return -1;
  return Math.max(statusFlow.indexOf(status), 0);
}

function isActionDisabled(currentStatus, actionStatus) {
  if (currentStatus === "İptal") return true;
  if (actionStatus === "İptal") return false;

  const currentIndex = getCurrentStep(currentStatus);
  const actionIndex = statusFlow.indexOf(actionStatus);

  return actionIndex <= currentIndex;
}

function buildStatusHistory(order, entry) {
  const currentHistory = Array.isArray(order.status_history)
    ? order.status_history
    : [];
  return [
    ...currentHistory,
    {
      ...entry,
      id: crypto.randomUUID(),
      date: getNowStamp(),
    },
  ];
}

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id;
  const [order, setOrder] = useState(null);
  const [activeTab, setActiveTab] = useState("items");
  const [message, setMessage] = useState("");
  const [deliveryInputs, setDeliveryInputs] = useState({});
  const [receiptInputs, setReceiptInputs] = useState({});
  const [receipts, setReceipts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    currency: "TRY",
    exchange_rate: 1,
    payment_date: getToday(),
    description: "",
  });
  const [companySettings, setCompanySettings] = useState({ default_currency: "TRY", base_currency: "TRY" });
  const [project, setProject] = useState(null);
  const [projectItems, setProjectItems] = useState([]);
  const [editableStatus, setEditableStatus] = useState("");

  // Detail page reloads when the route id changes; loadOrder reads the active route state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: route-scoped initial load
  useEffect(() => {
    loadOrder();
  }, [id]);

  async function loadOrder() {
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
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error) {
      console.error(error);
      setMessage("Sipariş bulunamadı.");
      return;
    }

    setOrder(data);
    setPaymentForm((prev) => ({
      ...prev,
      currency: data.currency || "TRY",
      exchange_rate: Number(data.exchange_rate || 1),
    }));
    setEditableStatus(data.status === "Teslim Edildi" ? "Tam Teslim" : data.status || "Taslak");
    setDeliveryInputs({});
    setReceiptInputs({});

    const { data: receiptRows } = await supabase
      .from("order_receipts")
      .select("*")
      .eq("order_id", data.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setReceipts(receiptRows || []);

    const { data: paymentRows } = await supabase
      .from("order_payments")
      .select("*")
      .eq("order_id", data.id)
      .eq("user_id", user.id)
      .order("payment_date", { ascending: false });
    setPayments(paymentRows || []);

    const { data: settingsRows } = await supabase
      .from("company_settings")
      .select("*")
      .eq("user_id", user.id)
      .limit(1);
    if (settingsRows?.[0]) setCompanySettings(settingsRows[0]);

    if (data.project_id) {
      const [{ data: projectData }, { data: projectItemRows }] = await Promise.all([
        supabase
          .from("projects")
          .select("*")
          .eq("id", data.project_id)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("project_items")
          .select("*")
          .eq("project_id", data.project_id)
          .eq("user_id", user.id)
          .order("created_at", { ascending: true }),
      ]);

      setProject(projectData || null);
      setProjectItems(projectItemRows || []);
    } else {
      setProject(null);
      setProjectItems([]);
    }
  }

  const items = useMemo(() => normalizeItems(order?.items || []), [order]);
  const historyRows = useMemo(
    () => (order ? normalizeHistory(order) : []),
    [order],
  );
  const totals = useMemo(() => {
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const deliveredQuantity = items.reduce(
      (sum, item) => sum + item.deliveredQuantity,
      0,
    );

    return {
      totalQuantity,
      deliveredQuantity,
      remainingQuantity: Math.max(totalQuantity - deliveredQuantity, 0),
      progress:
        totalQuantity > 0
          ? Math.round((deliveredQuantity / totalQuantity) * 100)
          : 0,
    };
  }, [items]);
  const paymentTotals = useMemo(() => {
    const paidAmount =
      payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) ||
      Number(order?.paid_amount || 0);
    const orderTotal = Number(order?.total_amount || 0);

    return {
      paidAmount,
      remainingPayment: Math.max(orderTotal - paidAmount, 0),
      paymentStatus:
        paidAmount <= 0
          ? "Ödenmedi"
          : paidAmount >= orderTotal && orderTotal > 0
            ? "Ödendi"
            : "Kısmi ödendi",
    };
  }, [order, payments]);

  async function updateOrder(payload, fallbackPayload) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !order) return { error: new Error("Oturum bulunamadı.") };

    const response = await supabase
      .from("orders")
      .update(payload)
      .eq("id", order.id)
      .eq("user_id", user.id);

    if (!response.error || !fallbackPayload) return response;

    const missingHistoryColumn =
      response.error.message?.includes("status_history") ||
      response.error.code === "PGRST204";

    if (!missingHistoryColumn) return response;

    return supabase
      .from("orders")
      .update(fallbackPayload)
      .eq("id", order.id)
      .eq("user_id", user.id);
  }

  async function updateProductFromReceipt(userId, item, addedQuantity, options = {}) {
    const productName = item.productName || item.productCode || "Urun";
    const productCode = String(item.productCode || "").trim().toUpperCase();
    const receiptDate = options.receiptDate || getToday();
    let product = null;

    if (options.projectItem?.product_id) {
      const { data: productById, error: productByIdError } = await supabase
        .from("products")
        .select("*")
        .eq("id", options.projectItem.product_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (productByIdError) console.error("?r?n kart? product_id ile bulunamad?:", productByIdError);
      product = productById || null;
    }

    if (!product && productCode) {
      const { data: productByCode, error: productByCodeError } = await supabase
        .from("products")
        .select("*")
        .eq("user_id", userId)
        .eq("product_code", productCode)
        .limit(1);

      if (productByCodeError) console.error("?r?n kart? ?r?n kodu ile bulunamad?:", productByCodeError);
      product = productByCode?.[0] || null;
    }

    if (!product && productName) {
      const { data: productByName, error: productByNameError } = await supabase
        .from("products")
        .select("*")
        .eq("user_id", userId)
        .ilike("product_name", `%${productName}%`)
        .limit(1);

      if (productByNameError) console.error("?r?n kart? ?r?n ad? ile bulunamad?:", productByNameError);
      product = productByName?.[0] || null;
    }

    if (!product?.id) {
      console.warn("Teslim alma i?in mevcut ?r?n kart? bulunamad?:", {
        product_code: productCode,
        product_name: productName,
        unit: item.unit || "adet",
      });
      return null;
    }

    const updatePayload = {
      product_name: product.product_name || productName,
      unit: item.unit || product.unit || "adet",
      current_stock: Number(product.current_stock || 0) + Number(addedQuantity || 0),
      last_supplier: order.partner_name || order.supplier_name || "",
      last_unit_price: Number(item.unitPrice || 0),
      last_currency: order.currency || "TRY",
      last_purchase_date: receiptDate,
      last_movement_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const updateResult = await supabase
      .from("products")
      .update(updatePayload)
      .eq("id", product.id)
      .eq("user_id", userId);

    if (!updateResult.error) return product.id;

    const missingPurchaseDateColumn =
      updateResult.error.message?.includes("last_purchase_date") ||
      updateResult.error.code === "PGRST204";

    if (!missingPurchaseDateColumn) {
      console.error("?r?n kart? teslim alma ile g?ncellenemedi:", updateResult.error);
      return product.id;
    }

    const { last_purchase_date: _unused, ...fallbackPayload } = updatePayload;
    const fallbackResult = await supabase
      .from("products")
      .update(fallbackPayload)
      .eq("id", product.id)
      .eq("user_id", userId);

    if (fallbackResult.error) {
      console.error("?r?n kart? teslim alma ile g?ncellenemedi:", fallbackResult.error);
    }

    return product.id;
  }
  async function writeStockMovements(userId, previousItems, nextItems) {
    const movements = [];

    for (const item of nextItems) {
      const previousItem = previousItems.find(
        (previous) =>
          (item.productCode && previous.productCode === item.productCode) ||
          previous.productName === item.productName,
      );
      const addedQuantity =
        Number(item.deliveredQuantity || 0) -
        Number(previousItem?.deliveredQuantity || 0);

      if (addedQuantity <= 0 || !item.productName) continue;

      const matchingProjectItem = projectItems.find(
        (projectItem) =>
          (item.productCode && projectItem.product_code === item.productCode) ||
          projectItem.product_name === item.productName,
      );
      const productId = await updateProductFromReceipt(userId, item, addedQuantity, {
        projectItem: matchingProjectItem,
        receiptDate: getToday(),
      });

      movements.push({
        user_id: userId,
        product_id: productId,
        product_code: item.productCode || "",
        product_name: item.productName,
        movement_type: "in",
        quantity: addedQuantity,
        unit: item.unit || "adet",
        supplier_name: order.supplier_name || order.partner_name || "",
        partner_id: order.partner_id || null,
        partner_name: order.partner_name || order.supplier_name || "",
        partner_type: order.partner_type || "Tedarikçi",
        order_id: order.id,
        report_id: order.report_id || null,
        unit_price: Number(item.unitPrice || 0),
        currency: order.currency || "TRY",
        movement_date: getToday(),
        source: "Sipariş teslimatı",
        notes: `${order.order_no || "Sipariş"} teslimatı`,
      });
    }

    if (movements.length > 0) {
      await supabase.from("stock_movements").insert(movements);
    }
  }

  async function updateStatus(nextStatus) {
    if (!order) return;

    const confirmed =
      nextStatus !== "İptal" ||
      window.confirm(
        "Bu sipariş iptal edilsin mi? Bu işlem durum tarihçesine kaydedilir.",
      );

    if (!confirmed) return;

    const nextHistory = buildStatusHistory(order, {
      type: nextStatus === "İptal" ? "cancelled" : "status",
      title: `${nextStatus} durumuna alındı.`,
      actor: "Kullanıcı",
      status: nextStatus,
    });
    const completedItems =
      nextStatus === "Tam Teslim"
        ? items.map((item) => ({ ...item, deliveredQuantity: item.quantity }))
        : items;
    const deliveryDate =
      nextStatus === "Tam Teslim" ? getToday() : order.delivery_date;
    const payload = {
      status: nextStatus,
      delivery_date: deliveryDate,
      items: completedItems,
      status_history: nextHistory,
    };
    const fallbackPayload = {
      status: nextStatus,
      delivery_date: deliveryDate,
      items: completedItems,
    };

    const { error } = await updateOrder(payload, fallbackPayload);

    if (error) {
      setMessage("Durum güncellenemedi.");
      return;
    }

    setMessage(`${nextStatus} durumu kaydedildi.`);
    await loadOrder();
  }

  async function saveDelivery() {
    if (!order) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const nextItems = items.map((item, index) => {
      const rawValue =
        deliveryInputs[index] === undefined
          ? item.deliveredQuantity
          : deliveryInputs[index];
      const deliveredQuantity = Math.min(
        item.quantity,
        Math.max(0, Number(rawValue || 0)),
      );
      return { ...item, deliveredQuantity };
    });

    const totalQuantity = nextItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const deliveredQuantity = nextItems.reduce(
      (sum, item) => sum + item.deliveredQuantity,
      0,
    );
    const calculatedStatus =
      deliveredQuantity >= totalQuantity && totalQuantity > 0
        ? "Tam Teslim"
        : deliveredQuantity > 0
          ? "Kısmi Teslim"
          : "Taslak";
    const nextStatus = editableStatus || calculatedStatus;
    const deliveryChanged = nextItems.some(
      (item, index) =>
        item.deliveredQuantity !== items[index].deliveredQuantity,
    );
    const statusChanged = nextStatus !== order.status;

    const nextHistory = buildStatusHistory(order, {
      type: deliveryChanged ? "delivery-adjustment" : "status",
      title:
        deliveryChanged && statusChanged
          ? "Teslimat adetleri ve durum güncellendi."
          : deliveryChanged
            ? "Teslimat adetleri düzeltildi."
            : `${nextStatus} durumuna alındı.`,
      actor: "Kullanıcı",
      status: nextStatus,
    });
    const deliveryDate =
      nextStatus === "Tam Teslim" ? order.delivery_date || getToday() : null;
    const payload = {
      items: nextItems,
      status: nextStatus,
      delivery_date: deliveryDate,
      status_history: nextHistory,
    };
    const fallbackPayload = {
      items: nextItems,
      status: nextStatus,
      delivery_date: deliveryDate,
    };

    const { error } = await updateOrder(payload, fallbackPayload);

    if (error) {
      setMessage("Teslimat kaydedilemedi.");
      return;
    }

    await writeStockMovements(user.id, items, nextItems);

    setDeliveryInputs({});
    setMessage("Teslimat ve durum bilgisi güncellendi.");
    await loadOrder();
  }

  function updateReceiptInput(index, field, value) {
    setReceiptInputs((prev) => ({
      ...prev,
      [index]: {
        ...(prev[index] || {}),
        [field]: value,
      },
    }));
  }

  function calculateReceiptStatus(receivedQuantity, orderedQuantity, defectiveQuantity) {
    if (Number(defectiveQuantity || 0) > 0) return "Hatalı / arızalı geldi";
    if (Number(receivedQuantity || 0) < Number(orderedQuantity || 0)) return "Eksik geldi";
    if (Number(receivedQuantity || 0) > Number(orderedQuantity || 0)) return "Fazla geldi";
    return "Depoda";
  }

  async function saveReceipt(index) {
    if (!order) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const item = items[index];
    const partner = await findOrCreateBusinessPartner(supabase, user.id, {
      name: order.partner_name || order.supplier_name,
      allowCreate: false,
      partnerType: order.partner_type || "Tedarikçi",
    });
    const input = receiptInputs[index] || {};
    const orderedQuantity = Number(item.quantity || 0);
    const remainingQuantity = Math.max(orderedQuantity - Number(item.deliveredQuantity || 0), 0);
    const receivedQuantity = Number(input.receivedQuantity ?? remainingQuantity);
    const defectiveQuantity = Number(input.defectiveQuantity || 0);
    const acceptedQuantity = Math.max(receivedQuantity - defectiveQuantity, 0);
    const missingQuantity = Math.max(orderedQuantity - receivedQuantity, 0);
    const excessQuantity = Math.max(receivedQuantity - orderedQuantity, 0);
    const receiptStatus = calculateReceiptStatus(receivedQuantity, orderedQuantity, defectiveQuantity);
    const selectedProjectItem =
      projectItems.find((projectItem) => projectItem.id === input.projectItemId) || null;
    const parentItemId =
      selectedProjectItem?.parent_item_id || input.parentItemId || selectedProjectItem?.id || null;

    if (receivedQuantity <= 0 && defectiveQuantity <= 0) {
      setMessage("Teslim alınan miktar girilmelidir.");
      return;
    }

    const receiptPayload = {
      user_id: user.id,
      order_id: order.id,
      project_id: order.project_id || null,
      project_item_id: selectedProjectItem?.id || null,
      parent_item_id: parentItemId,
      order_no: order.order_no || "",
      supplier_name: order.supplier_name || "",
      partner_id: partner?.id || order.partner_id || null,
      partner_name: partner?.name || order.partner_name || order.supplier_name || "",
      partner_type: partner?.partner_type || order.partner_type || "Tedarikçi",
      product_code: item.productCode || "",
      product_name: item.productName,
      unit: item.unit || "adet",
      ordered_quantity: orderedQuantity,
      received_quantity: receivedQuantity,
      accepted_quantity: acceptedQuantity,
      missing_quantity: missingQuantity,
      excess_quantity: excessQuantity,
      defective_quantity: defectiveQuantity,
      receipt_status: receiptStatus,
      received_by: input.receivedBy || "",
      receipt_date: input.receiptDate || getToday(),
      note: input.note || "",
    };

    const { data: receiptData, error: receiptError } = await supabase
      .from("order_receipts")
      .insert(receiptPayload)
      .select("*")
      .single();

    if (receiptError) {
      console.error(receiptError);
      setMessage("Teslim alma kaydedilemedi. Supabase SQL tarafında order_receipts tablosu çalıştırılmalı.");
      return;
    }

    if (acceptedQuantity > 0) {
      const productId = await updateProductFromReceipt(user.id, item, acceptedQuantity, {
        projectItem: selectedProjectItem,
        receiptDate: receiptPayload.receipt_date,
      });
      const { error: movementError } = await supabase.from("stock_movements").insert({
        user_id: user.id,
        product_id: productId,
        product_code: item.productCode || "",
        product_name: item.productName,
        movement_type: "in",
        quantity: acceptedQuantity,
        unit: item.unit || "adet",
        supplier_name: order.supplier_name || "",
        partner_id: partner?.id || order.partner_id || null,
        partner_name: partner?.name || order.partner_name || order.supplier_name || "",
        partner_type: partner?.partner_type || order.partner_type || "Tedarikçi",
        order_id: order.id,
        report_id: order.report_id || null,
        project_id: order.project_id || null,
        project_item_id: selectedProjectItem?.id || null,
        parent_item_id: parentItemId,
        receipt_id: receiptData.id,
        unit_price: Number(item.unitPrice || 0),
        currency: order.currency || "TRY",
        movement_date: receiptPayload.receipt_date,
        source: "Depo teslim alma",
        notes: `${order.order_no || "Sipariş"} - ${receiptStatus}`,
      });

      if (movementError) {
        console.error(movementError);
        setMessage("Teslim kaydı oluştu fakat stok hareketi işlenemedi. SQL şemasındaki yeni stok alanlarını kontrol edin.");
      }
    }

    if (selectedProjectItem) {
      await supabase
        .from("project_items")
        .update({
          status: receiptStatus,
          received_quantity: Number(selectedProjectItem.received_quantity || 0) + acceptedQuantity,
          defective_quantity: Number(selectedProjectItem.defective_quantity || 0) + defectiveQuantity,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedProjectItem.id)
        .eq("user_id", user.id);
    }

    const nextItems = items.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      return {
        ...row,
        deliveredQuantity: Math.min(
          Number(row.quantity || 0),
          Number(row.deliveredQuantity || 0) + acceptedQuantity,
        ),
      };
    });
    const nextDeliveredQuantity = nextItems.reduce(
      (sum, row) => sum + Number(row.deliveredQuantity || 0),
      0,
    );
    const nextTotalQuantity = nextItems.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const nextStatus =
      nextDeliveredQuantity >= nextTotalQuantity && nextTotalQuantity > 0
        ? "Tam Teslim"
        : nextDeliveredQuantity > 0
          ? "Kısmi Teslim"
          : order.status;
    const nextHistory = buildStatusHistory(order, {
      type: "warehouse-receipt",
      title: `${item.productName} teslim alındı: ${receivedQuantity} ${item.unit || "adet"} (${receiptStatus}).`,
      actor: receiptPayload.received_by || "Depo",
      status: receiptStatus,
    });

    await updateOrder(
      {
        items: nextItems,
        status: nextStatus,
        delivery_date: nextStatus === "Tam Teslim" ? getToday() : order.delivery_date,
        receipt_status: receiptStatus,
        received_total: nextDeliveredQuantity,
        defective_total: Number(order.defective_total || 0) + defectiveQuantity,
        status_history: nextHistory,
      },
      {
        items: nextItems,
        status: nextStatus,
        delivery_date: nextStatus === "Tam Teslim" ? getToday() : order.delivery_date,
      },
    );

    setReceiptInputs((prev) => ({ ...prev, [index]: {} }));
    setMessage("Depo teslim alma kaydedildi ve stok girişine işlendi.");
    await loadOrder();
  }

  async function savePayment(event) {
    event.preventDefault();
    if (!order) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const amount = Number(paymentForm.amount || 0);
    if (amount <= 0) {
      setMessage("Ödeme tutarı sıfırdan büyük olmalıdır.");
      return;
    }

    const baseCurrency = getBaseCurrency(companySettings);
    const exchangeRate = Number(paymentForm.exchange_rate || getExchangeRate(paymentForm.currency, companySettings));
    const baseAmount = calculateBaseAmount(amount, paymentForm.currency, companySettings, exchangeRate);
    const { error } = await supabase.from("order_payments").insert({
      user_id: user.id,
      order_id: order.id,
      project_id: order.project_id || null,
      supplier_name: order.supplier_name || "",
      partner_id: order.partner_id || null,
      partner_name: order.partner_name || order.supplier_name || "",
      partner_type: order.partner_type || "Tedarikçi",
      payment_date: paymentForm.payment_date || getToday(),
      amount,
      original_amount: amount,
      currency: paymentForm.currency || order.currency || baseCurrency,
      exchange_rate: exchangeRate,
      exchange_rate_date: paymentForm.payment_date || getToday(),
      base_currency: baseCurrency,
      base_amount: baseAmount,
      description: paymentForm.description || "",
    });

    if (error) {
      console.error(error);
      setMessage("Ödeme kaydedilemedi. Supabase SQL tarafında order_payments tablosu çalıştırılmalı.");
      return;
    }

    const nextPaidAmount = paymentTotals.paidAmount + amount;
    const nextPaymentStatus =
      nextPaidAmount >= Number(order.total_amount || 0) && Number(order.total_amount || 0) > 0
        ? "Ödendi"
        : "Kısmi ödendi";

    await supabase
      .from("orders")
      .update({
        paid_amount: nextPaidAmount,
        paid_amount_base: Number(order.paid_amount_base || 0) + baseAmount,
        remaining_amount: Math.max(Number(order.total_amount || 0) - nextPaidAmount, 0),
        remaining_amount_base: Math.max(Number(order.order_total_base || order.base_amount || 0) - (Number(order.paid_amount_base || 0) + baseAmount), 0),
        payment_status: nextPaymentStatus,
        payment_note: paymentForm.description || order.payment_note || "",
        last_payment_date: paymentForm.payment_date || getToday(),
      })
      .eq("id", order.id)
      .eq("user_id", user.id);

    setPaymentForm({ amount: "", currency: order.currency || "TRY", exchange_rate: Number(order.exchange_rate || 1), payment_date: getToday(), description: "" });
    setMessage("Sipariş ödemesi kaydedildi.");
    await loadOrder();
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-slate-100 p-8">
        <div className="rounded-2xl bg-white p-6 text-sm text-slate-600 shadow-sm">
          {message || "Sipariş yükleniyor..."}
        </div>
      </div>
    );
  }

  const currentStep = getCurrentStep(order.status);

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link
              href="/dashboard/siparisler"
              className="text-sm font-bold text-blue-700"
            >
              Siparişler
            </Link>
            <h1 className="mt-2 text-3xl font-black text-slate-900">
              Sipariş Detayı
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Sipariş No: {order.order_no}
            </p>
          </div>

          <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
            {project && (
              <Link
                href={`/dashboard/projeler/${project.id}`}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Projeye Git
              </Link>
            )}
            <button
              type="button"
              onClick={() => setActiveTab("payment")}
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100"
            >
              Ödeme Ekle
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("receiving")}
              className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100"
            >
              Teslim Al
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("receiving")}
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700 hover:bg-amber-100"
            >
              Kısmi Teslim Al
            </button>
            {statusActions.map((action) => (
              <button
                key={action.status}
                type="button"
                disabled={isActionDisabled(order.status, action.status)}
                onClick={() => updateStatus(action.status)}
                className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                  action.danger
                    ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                    : "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                } disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-900">
            {message}
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4 xl:grid-cols-7">
            {statusFlow.map((status, index) => {
              const active = currentStep >= index && order.status !== "İptal";
              const current = order.status === status;
              return (
                <div key={status} className="flex min-w-0 items-center gap-2">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                      active
                        ? "bg-blue-600 text-white"
                        : "bg-slate-200 text-slate-500"
                    } ${current ? "ring-4 ring-blue-100" : ""}`}
                  >
                    {index + 1}
                  </div>
                  <div className="min-w-0 text-xs font-bold text-slate-700">
                    {status}
                  </div>
                </div>
              );
            })}
          </div>
          {order.status === "İptal" && (
            <div className="mt-4 rounded-xl bg-slate-100 p-3 text-sm font-semibold text-slate-700">
              Bu sipariş iptal edildi.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="text-lg font-bold text-slate-900">Temel Bilgiler</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Info label="İş Ortağı" value={order.partner_name || order.supplier_name} />
              <Info label="Sipariş Tarihi" value={order.order_date || "-"} />
              <Info label="Termin Tarihi" value={order.termin_date || "-"} />
              <Info label="Ödeme Vadesi" value={items[0]?.paymentTerm || "-"} />
              <Info
                label="Durum"
                value={
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(order.status)}`}
                  >
                    {order.status}
                  </span>
                }
              />
              <Info
                label="Toplam Tutar"
                value={formatMoney(order.total_amount, order.currency)}
              />
              <Info
                label="Ödenen Tutar"
                value={formatMoney(paymentTotals.paidAmount, order.currency)}
              />
              <Info
                label="Kalan Ödeme"
                value={formatMoney(paymentTotals.remainingPayment, order.currency)}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Özet Bilgiler</h2>
            <div className="mt-4 space-y-3 text-sm">
              <Info label="Toplam Kalem" value={items.length} />
              <Info label="Toplam Miktar" value={totals.totalQuantity} />
              <Info label="Teslim Edilen" value={totals.deliveredQuantity} />
              <Info label="Kalan" value={totals.remainingQuantity} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 pt-4">
            {[
              ["items", "Ürün Kalemleri"],
              ["delivery", "Teslimatlar"],
              ["receiving", "Depo Teslim Alma"],
              ["payment", "Ödemeler"],
              ["history", "Tarihçe"],
              ["notes", "Notlar"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`border-b-2 px-4 py-3 text-sm font-bold ${
                  activeTab === key
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {activeTab === "items" && (
              <ItemsTable
                items={items}
                currency={order.currency}
                onEditDelivery={() => setActiveTab("delivery")}
              />
            )}
            {activeTab === "delivery" && (
              <DeliveryPanel
                items={items}
                inputs={deliveryInputs}
                disabled={order.status === "İptal"}
                status={editableStatus}
                onStatusChange={setEditableStatus}
                onInputChange={(index, value) =>
                  setDeliveryInputs((prev) => ({ ...prev, [index]: value }))
                }
                onSave={saveDelivery}
                progress={totals.progress}
              />
            )}
            {activeTab === "receiving" && (
              <ReceivingPanel
                items={items}
                order={order}
                project={project}
                projectItems={projectItems}
                receipts={receipts}
                inputs={receiptInputs}
                disabled={order.status === "İptal"}
                onInputChange={updateReceiptInput}
                onSave={saveReceipt}
              />
            )}
            {activeTab === "payment" && (
              <PaymentPanel
                order={order}
                payments={payments}
                totals={paymentTotals}
                form={paymentForm}
                onFormChange={setPaymentForm}
                onSave={savePayment}
              />
            )}
            {activeTab === "history" && <HistoryPanel rows={historyRows} />}
            {activeTab === "notes" && (
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                {order.note || "Not bulunmuyor."}
              </div>
            )}
          </div>
        </div>
      </div>
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

function ItemsTable({ items, currency, onEditDelivery }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-bold text-blue-950">
            Teslim adetlerinde hata varsa buradan düzeltebilirsiniz.
          </div>
          <div className="mt-1 text-sm text-blue-800">
            Düzenleme ekranı teslim edilen adetleri ve sipariş durumunu tekrar
            kaydetmenizi sağlar.
          </div>
        </div>
        <button
          type="button"
          onClick={onEditDelivery}
          className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700"
        >
          Teslimatları Düzenle
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3">Ürün</th>
              <th className="p-3">Miktar</th>
              <th className="p-3">Teslim Edilen</th>
              <th className="p-3">Kalan</th>
              <th className="p-3">Birim Fiyat</th>
              <th className="p-3">Tutar</th>
              <th className="p-3">Durum</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr
                key={`${item.productName}-${index}`}
                className="border-t border-slate-100"
              >
                <td className="p-3 font-semibold">{item.productName || "-"}</td>
                <td className="p-3">{item.quantity}</td>
                <td className="p-3">{item.deliveredQuantity}</td>
                <td className="p-3">
                  {Math.max(item.quantity - item.deliveredQuantity, 0)}
                </td>
                <td className="p-3">{formatMoney(item.unitPrice, currency)}</td>
                <td className="p-3 font-bold">
                  {formatMoney(item.total, currency)}
                </td>
                <td className="p-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(item.status)}`}
                  >
                    {item.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeliveryPanel({
  items,
  inputs,
  disabled,
  status,
  onStatusChange,
  onInputChange,
  onSave,
  progress,
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-blue-100 bg-blue-50 p-4 md:grid-cols-[1fr_260px] md:items-end">
        <div>
          <h3 className="text-base font-bold text-blue-950">
            Teslimat düzeltme
          </h3>
          <p className="mt-1 text-sm text-blue-800">
            Yanlış girilen teslim adetlerini veya sipariş durumunu sonradan
            düzeltebilirsiniz.
          </p>
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-blue-950">
            Sipariş Durumu
          </span>
          <select
            value={status}
            disabled={disabled}
            onChange={(event) => onStatusChange(event.target.value)}
            className="w-full rounded-xl border border-blue-200 bg-white p-3 text-sm font-bold text-slate-800 disabled:bg-slate-100"
          >
            {editableStatusOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3">Ürün</th>
              <th className="p-3">Sipariş Miktarı</th>
              <th className="p-3">Teslim Edilen</th>
              <th className="p-3">Düzeltilmiş Teslim</th>
              <th className="p-3">Kalan</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr
                key={`${item.productName}-${index}`}
                className="border-t border-slate-100"
              >
                <td className="p-3 font-semibold">{item.productName}</td>
                <td className="p-3">{item.quantity}</td>
                <td className="p-3">{item.deliveredQuantity}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max={item.quantity}
                      disabled={disabled}
                      value={
                        inputs[index] === undefined
                          ? item.deliveredQuantity
                          : inputs[index]
                      }
                      onChange={(event) =>
                        onInputChange(index, event.target.value)
                      }
                      className="w-28 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onInputChange(index, item.quantity)}
                      className="whitespace-nowrap rounded border border-green-200 bg-green-50 px-2 py-1 text-xs font-bold text-green-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      Tamamı
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onInputChange(index, 0)}
                      className="whitespace-nowrap rounded border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      Sıfırla
                    </button>
                  </div>
                </td>
                <td className="p-3">
                  {Math.max(
                    item.quantity -
                      Number(
                        inputs[index] === undefined
                          ? item.deliveredQuantity
                          : inputs[index] || 0,
                      ),
                    0,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="mb-2 flex justify-between text-sm text-slate-600">
          <span>Genel Teslimat Durumu</span>
          <span>%{progress}</span>
        </div>
        <div className="h-3 rounded-full bg-slate-100">
          <div
            className="h-3 rounded-full bg-green-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onSave}
        className="rounded-xl bg-green-600 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Düzeltmeleri Kaydet
      </button>
    </div>
  );
}

function ReceivingPanel({
  items,
  order,
  project,
  projectItems,
  receipts,
  inputs,
  disabled,
  onInputChange,
  onSave,
}) {
  const parentItems = projectItems.filter((item) => !item.parent_item_id);
  const itemLabel = (projectItem) => {
    const parent = parentItems.find((item) => item.id === projectItem.parent_item_id);
    return `${parent ? `${parent.product_name} / ` : ""}${projectItem.product_name}`;
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
        <h3 className="text-base font-bold text-emerald-950">
          Depo teslim alma
        </h3>
        <p className="mt-1 text-sm text-emerald-800">
          Gelen miktar stok girişine işlenir; eksik, fazla ve hatalı gelenler
          ayrı teslim kaydı olarak saklanır.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg bg-white p-3">
            <div className="text-xs font-bold text-slate-500">Sipariş No</div>
            <div className="mt-1 font-black text-slate-900">{order.order_no || "-"}</div>
          </div>
          <div className="rounded-lg bg-white p-3">
            <div className="text-xs font-bold text-slate-500">Proje</div>
            <div className="mt-1 font-black text-slate-900">
              {project ? `${project.project_code} - ${project.project_name}` : "Proje bağlantısı yok"}
            </div>
          </div>
          <div className="rounded-lg bg-white p-3">
            <div className="text-xs font-bold text-slate-500">İş Ortağı</div>
            <div className="mt-1 font-black text-slate-900">{order.partner_name || order.supplier_name || "-"}</div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {items.map((item, index) => {
          const input = inputs[index] || {};
          const remaining = Math.max(Number(item.quantity || 0) - Number(item.deliveredQuantity || 0), 0);
          const received = Number(input.receivedQuantity ?? remaining);
          const defective = Number(input.defectiveQuantity || 0);
          const missing = Math.max(Number(item.quantity || 0) - received, 0);
          const excess = Math.max(received - Number(item.quantity || 0), 0);

          return (
            <div key={`${item.productCode}-${item.productName}-${index}`} className="rounded-2xl border border-slate-200 p-4">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_repeat(4,110px)] lg:items-center">
                <div>
                  <div className="font-black text-slate-900">{item.productName}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {item.productCode || "-"} · Sipariş: {item.quantity} {item.unit || "adet"} · Önceki teslim: {item.deliveredQuantity}
                  </div>
                </div>
                <NumberInput
                  label="Gelen"
                  value={input.receivedQuantity ?? remaining}
                  disabled={disabled}
                  onChange={(value) => onInputChange(index, "receivedQuantity", value)}
                />
                <NumberInput
                  label="Eksik"
                  value={missing}
                  disabled
                  onChange={() => {}}
                />
                <NumberInput
                  label="Fazla"
                  value={excess}
                  disabled
                  onChange={() => {}}
                />
                <NumberInput
                  label="Hatalı"
                  value={input.defectiveQuantity || ""}
                  disabled={disabled}
                  onChange={(value) => onInputChange(index, "defectiveQuantity", value)}
                />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-500">Ana ürün / pano</span>
                  <select
                    value={input.parentItemId || ""}
                    disabled={disabled || !project}
                    onChange={(event) => onInputChange(index, "parentItemId", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-100"
                  >
                    <option value="">Seçilmedi</option>
                    {parentItems.map((projectItem) => (
                      <option key={projectItem.id} value={projectItem.id}>
                        {projectItem.product_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-500">Proje malzemesi</span>
                  <select
                    value={input.projectItemId || ""}
                    disabled={disabled || !project}
                    onChange={(event) => onInputChange(index, "projectItemId", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-100"
                  >
                    <option value="">Otomatik eşleşme yok</option>
                    {projectItems.map((projectItem) => (
                      <option key={projectItem.id} value={projectItem.id}>
                        {itemLabel(projectItem)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-500">Teslim alan</span>
                  <input
                    value={input.receivedBy || ""}
                    disabled={disabled}
                    onChange={(event) => onInputChange(index, "receivedBy", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-100"
                    placeholder="Depo sorumlusu"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-500">Teslim tarihi</span>
                  <input
                    type="date"
                    value={input.receiptDate || getToday()}
                    disabled={disabled}
                    onChange={(event) => onInputChange(index, "receiptDate", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-100"
                  />
                </label>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-500">Açıklama</span>
                  <input
                    value={input.note || ""}
                    disabled={disabled}
                    onChange={(event) => onInputChange(index, "note", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-100"
                    placeholder="Eksik, fazla veya hasar notu"
                  />
                </label>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSave(index)}
                  className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                >
                  Teslim Al
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-200 p-4">
        <h3 className="font-black text-slate-900">Teslim alma geçmişi</h3>
        <div className="mt-3 space-y-2">
          {receipts.map((receipt) => (
            <div key={receipt.id} className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 text-sm md:grid-cols-[1fr_auto_auto] md:items-center">
              <div>
                <div className="font-bold text-slate-900">{receipt.product_name}</div>
                <div className="text-xs text-slate-500">
                  {receipt.receipt_date} · {receipt.received_by || "Depo"} · {receipt.note || "-"}
                </div>
              </div>
              <div className="font-bold text-slate-700">
                Gelen: {receipt.received_quantity} / Kabul: {receipt.accepted_quantity}
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(receipt.receipt_status)}`}>
                {receipt.receipt_status}
              </span>
            </div>
          ))}
          {receipts.length === 0 && (
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
              Henüz teslim alma kaydı yok.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NumberInput({ label, value, disabled, onChange }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-500">{label}</span>
      <input
        type="number"
        min="0"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 p-3 text-sm font-bold disabled:bg-slate-100"
      />
    </label>
  );
}

function PaymentPanel({ order, payments, totals, form, onFormChange, onSave }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.2fr]">
      <form onSubmit={onSave} className="rounded-2xl border border-slate-200 p-5">
        <h3 className="text-lg font-black text-slate-900">Ödeme Ekle</h3>
        <div className="mt-4 grid grid-cols-1 gap-4">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">Ödeme tutarı</span>
            <input
              type="number"
              min="0"
              value={form.amount}
              onChange={(event) => onFormChange((prev) => ({ ...prev, amount: event.target.value }))}
              className="w-full rounded-xl border border-slate-300 p-3 text-sm"
              placeholder="0"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">Ödeme tarihi</span>
            <input
              type="date"
              value={form.payment_date}
              onChange={(event) => onFormChange((prev) => ({ ...prev, payment_date: event.target.value }))}
              className="w-full rounded-xl border border-slate-300 p-3 text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-500">Para birimi</span>
              <select
                value={form.currency}
                onChange={(event) => onFormChange((prev) => ({ ...prev, currency: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 p-3 text-sm"
              >
                {currencyOptions.map((currency) => <option key={currency}>{currency}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-500">Kur</span>
              <input
                type="number"
                min="0"
                value={form.exchange_rate}
                onChange={(event) => onFormChange((prev) => ({ ...prev, exchange_rate: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 p-3 text-sm"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">Açıklama</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => onFormChange((prev) => ({ ...prev, description: event.target.value }))}
              className="w-full rounded-xl border border-slate-300 p-3 text-sm"
              placeholder="Dekont, vade veya ödeme notu"
            />
          </label>
          <button
            type="submit"
            className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            Ödemeyi Kaydet
          </button>
        </div>
      </form>

      <div className="rounded-2xl border border-slate-200 p-5">
        <h3 className="text-lg font-black text-slate-900">Ödeme Özeti</h3>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Info label="Sipariş Tutarı" value={formatMoney(order.total_amount, order.currency)} />
          <Info label="Ödenen" value={formatMoney(totals.paidAmount, order.currency)} />
          <Info label="Kalan" value={formatMoney(totals.remainingPayment, order.currency)} />
        </div>
        <div className="mt-5 space-y-2">
          {payments.map((payment) => (
            <div key={payment.id} className="rounded-xl bg-slate-50 p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-slate-900">{payment.payment_date || "-"}</div>
                  <div className="text-xs text-slate-500">{payment.description || "-"}</div>
                </div>
                <div className="font-black text-emerald-700">
                  {formatMoney(payment.amount, order.currency)}
                </div>
              </div>
            </div>
          ))}
          {payments.length === 0 && (
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
              Henüz ödeme kaydı yok.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryPanel({ rows }) {
  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div
          key={`${row.title}-${row.date}-${index}`}
          className="flex gap-4 rounded-xl border border-slate-100 p-4"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-700">
            {index + 1}
          </div>
          <div className="flex-1">
            <div className="font-bold text-slate-900">{row.title}</div>
            <div className="mt-1 text-xs text-slate-500">
              {formatDateTime(row.date)} - {row.actor || "Sistem"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
