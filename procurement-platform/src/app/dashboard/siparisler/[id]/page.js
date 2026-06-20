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

function createMockOCRResult(document) {
  const documentNumber = document.document_number
    || `MOCK-${String(document.id || "BELGE").slice(0, 8).toUpperCase()}`;
  const documentDate = document.document_date || getToday();
  const supplierName = document.supplier_name || "Örnek Tedarikçi";
  const supplierTaxNumber = document.supplier_tax_number || "0000000000";
  const invoiceTotal = Number(document.invoice_total || 0);
  const currency = document.currency || "TRY";
  const processedAt = new Date().toISOString();

  return {
    document_number: documentNumber,
    document_date: documentDate,
    supplier_name: supplierName,
    supplier_tax_number: supplierTaxNumber,
    invoice_total: invoiceTotal,
    currency,
    ocr_status: "completed",
    ocr_text: [
      `Belge No: ${documentNumber}`,
      `Tarih: ${documentDate}`,
      `Tedarikçi: ${supplierName}`,
      `Vergi No: ${supplierTaxNumber}`,
      `Toplam: ${invoiceTotal} ${currency}`,
    ].join("\n"),
    ocr_result: {
      source: "mock",
      document_number: documentNumber,
      document_date: documentDate,
      supplier_name: supplierName,
      supplier_tax_number: supplierTaxNumber,
      invoice_total: invoiceTotal,
      currency,
    },
    ocr_confidence: 0.92,
    ocr_processed_at: processedAt,
  };
}

function getOCRDocumentItems(document) {
  let ocrResult = document?.ocr_result;
  if (typeof ocrResult === "string") {
    try {
      ocrResult = JSON.parse(ocrResult);
    } catch (error) {
      console.warn("OCR sonucu okunamadı:", error);
      return [];
    }
  }

  return Array.isArray(ocrResult?.items) ? ocrResult.items : [];
}

function readOrderMatchField(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function normalizeMatchCode(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeMatchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9çğıöşü]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function descriptionSimilarity(left, right) {
  const leftTokens = new Set(normalizeMatchText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeMatchText(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  const intersectionSize = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  return unionSize > 0 ? intersectionSize / unionSize : 0;
}

function getOrderItemMatchId(orderItem, index) {
  return orderItem.rowId
    || orderItem.id
    || orderItem.itemId
    || `order-item-${index}`;
}

function matchOrderItem(sourceItem, orderItems = []) {
  const sourceCode = readOrderMatchField(
    sourceItem,
    ["productCode", "product_code", "urunKodu", "code"],
  );
  const sourceName = readOrderMatchField(
    sourceItem,
    ["productName", "product_name", "urunAdi", "urunAciklamasi", "name"],
  );
  const sourceDescription = readOrderMatchField(
    sourceItem,
    ["description", "urunAciklamasi", "productName", "product_name", "name"],
  );

  const candidates = (orderItems || []).map((orderItem, index) => {
    const candidateCode = readOrderMatchField(
      orderItem,
      ["productCode", "product_code", "urunKodu", "code"],
    );
    const candidateName = readOrderMatchField(
      orderItem,
      ["productName", "product_name", "urunAdi", "urunAciklamasi", "name"],
    );
    const candidateDescription = readOrderMatchField(
      orderItem,
      ["description", "urunAciklamasi", "productName", "product_name", "name"],
    );
    const orderItemId = getOrderItemMatchId(orderItem, index);

    if (sourceCode && candidateCode && sourceCode === candidateCode) {
      return { confidence: 100, orderItemId, reason: "product_code_exact" };
    }
    if (
      sourceCode
      && candidateCode
      && normalizeMatchCode(sourceCode) === normalizeMatchCode(candidateCode)
    ) {
      return { confidence: 95, orderItemId, reason: "product_code_normalized" };
    }
    if (
      sourceName
      && candidateName
      && normalizeMatchText(sourceName) === normalizeMatchText(candidateName)
    ) {
      return { confidence: 80, orderItemId, reason: "product_name_match" };
    }
    if (descriptionSimilarity(sourceDescription, candidateDescription) >= 0.6) {
      return { confidence: 60, orderItemId, reason: "description_similarity" };
    }

    return { confidence: 0, orderItemId, reason: "unmatched" };
  });
  const highestConfidence = candidates.reduce(
    (highest, candidate) => Math.max(highest, candidate.confidence),
    0,
  );

  if (highestConfidence === 0) {
    return {
      matched: false,
      confidence: 0,
      orderItemId: null,
      reason: "unmatched",
      manualReviewRequired: false,
    };
  }

  const bestCandidates = candidates.filter(
    (candidate) => candidate.confidence === highestConfidence,
  );
  const selectedCandidate = bestCandidates[0];
  const manualReviewRequired = bestCandidates.length > 1;

  return {
    matched: true,
    confidence: selectedCandidate.confidence,
    orderItemId: selectedCandidate.orderItemId,
    reason: selectedCandidate.reason,
    manualReviewRequired,
    warning: manualReviewRequired ? "multiple_candidates_same_confidence" : null,
    ambiguousOrderItemIds: manualReviewRequired
      ? bestCandidates.map((candidate) => candidate.orderItemId)
      : [],
  };
}

function calculateItemPriceCheck(orderItem, documentItem) {
  if (!orderItem) {
    return {
      orderUnitPrice: null,
      documentUnitPrice: Number(documentItem?.unit_price ?? 0),
      priceDifference: null,
      priceDifferencePercent: null,
      status: "unavailable",
    };
  }

  const orderUnitPrice = Number(orderItem.unitPrice ?? orderItem.unit_price ?? 0);
  const documentUnitPrice = Number(documentItem?.unit_price ?? 0);
  const priceDifference = documentUnitPrice - orderUnitPrice;
  const priceDifferencePercent = orderUnitPrice !== 0
    ? (priceDifference / orderUnitPrice) * 100
    : documentUnitPrice === 0
      ? 0
      : null;
  const absoluteDifferencePercent = Math.abs(priceDifferencePercent ?? Infinity);
  const status = absoluteDifferencePercent <= 3
    ? "exact"
    : absoluteDifferencePercent <= 10
      ? "small"
      : absoluteDifferencePercent < 25
        ? "high"
        : "critical";

  return {
    orderUnitPrice,
    documentUnitPrice,
    priceDifference,
    priceDifferencePercent,
    status,
  };
}

function calculateDeliveryInvoiceConsistency(
  orderItems,
  rawOrderItems,
  receipts,
  documents,
  documentItems,
  orderId,
) {
  const rows = (orderItems || []).map((item, index) => ({
    orderItemId: getOrderItemMatchId(rawOrderItems?.[index] || item, index),
    fallbackOrderItemId: getOrderItemMatchId(item, index),
    productCode: item.productCode || "",
    productName: item.productName || "",
    unit: item.unit || "adet",
    orderedQuantity: Number(item.quantity || 0),
    deliveredQuantity: Number(item.deliveredQuantity || 0),
    receiptQuantity: 0,
    invoicedQuantity: 0,
  }));

  (receipts || []).forEach((receipt) => {
    const match = matchOrderItem(receipt, orderItems);
    if (!match.matched || match.manualReviewRequired) return;
    const row = rows.find((candidate) => candidate.fallbackOrderItemId === match.orderItemId);
    if (!row) return;
    row.receiptQuantity += Number(
      receipt.accepted_quantity ?? receipt.received_quantity ?? 0,
    );
  });

  const invoiceDocumentIds = new Set(
    (documents || [])
      .filter(
        (document) =>
          document.document_type === "fatura"
          && document.approval_status !== "reddedildi",
      )
      .map((document) => document.id),
  );

  (documentItems || []).forEach((documentItem) => {
    if (!invoiceDocumentIds.has(documentItem.document_id)) return;
    if (documentItem.matched_order_id && documentItem.matched_order_id !== orderId) return;

    let row = documentItem.matched_order_item_key
      ? rows.find(
          (candidate) =>
            candidate.orderItemId === documentItem.matched_order_item_key
            || candidate.fallbackOrderItemId === documentItem.matched_order_item_key,
        )
      : null;

    if (!row) {
      const match = matchOrderItem(documentItem, orderItems);
      if (!match.matched || match.manualReviewRequired) return;
      row = rows.find((candidate) => candidate.fallbackOrderItemId === match.orderItemId);
    }

    if (row) row.invoicedQuantity += Number(documentItem.quantity || 0);
  });

  const epsilon = 0.0001;
  rows.forEach((row) => {
    row.deliveredQuantity = Math.max(row.deliveredQuantity, row.receiptQuantity);

    if (row.deliveredQuantity > row.orderedQuantity + epsilon) {
      row.status = "Fazla Teslim";
    } else if (
      row.invoicedQuantity > row.orderedQuantity + epsilon
      || row.invoicedQuantity > row.deliveredQuantity + epsilon
    ) {
      row.status = "Fazla Fatura";
    } else if (row.deliveredQuantity < row.orderedQuantity - epsilon) {
      row.status = "Kısmi Teslim";
    } else if (row.invoicedQuantity < row.orderedQuantity - epsilon) {
      row.status = "Kısmi Fatura";
    } else {
      row.status = "Tam Uyum";
    }
  });

  return {
    rows,
    totalOrdered: rows.reduce((sum, row) => sum + row.orderedQuantity, 0),
    totalDelivered: rows.reduce((sum, row) => sum + row.deliveredQuantity, 0),
    totalInvoiced: rows.reduce((sum, row) => sum + row.invoicedQuantity, 0),
  };
}

function calculateAutomaticReceiptSuggestions(
  orderItems,
  rawOrderItems,
  receipts,
  documentItems,
  orderId,
) {
  const orderRows = (orderItems || []).map((item, index) => ({
    item,
    orderItemId: getOrderItemMatchId(rawOrderItems?.[index] || item, index),
    fallbackOrderItemId: getOrderItemMatchId(item, index),
    receiptQuantity: 0,
  }));

  (receipts || []).forEach((receipt) => {
    const match = matchOrderItem(receipt, orderItems);
    if (!match.matched || match.manualReviewRequired) return;
    const orderRow = orderRows.find(
      (row) => row.fallbackOrderItemId === match.orderItemId,
    );
    if (orderRow) {
      orderRow.receiptQuantity += Number(
        receipt.accepted_quantity ?? receipt.received_quantity ?? 0,
      );
    }
  });

  return (documentItems || [])
    .filter(
      (documentItem) =>
        documentItem.match_status === "matched"
        && documentItem.matched_order_item_key
        && (!documentItem.matched_order_id || documentItem.matched_order_id === orderId),
    )
    .map((documentItem) => {
      const orderRow = orderRows.find(
        (row) =>
          row.orderItemId === documentItem.matched_order_item_key
          || row.fallbackOrderItemId === documentItem.matched_order_item_key,
      );
      if (!orderRow) return null;

      const orderedQuantity = Number(orderRow.item.quantity || 0);
      const deliveredQuantity = Math.max(
        Number(orderRow.item.deliveredQuantity || 0),
        orderRow.receiptQuantity,
      );
      const documentQuantity = Number(documentItem.quantity || 0);
      const remainingQuantity = orderedQuantity - deliveredQuantity;
      const suggestedQuantity = Math.max(
        Math.min(documentQuantity, remainingQuantity),
        0,
      );
      const status = remainingQuantity <= 0
        ? "Teslim Tamamlanmış"
        : documentQuantity > remainingQuantity
          ? "Fazla Teslim"
          : documentQuantity < remainingQuantity
            ? "Kısmi Teslim"
            : "Tam Uygun";

      return {
        id: documentItem.id,
        productCode: orderRow.item.productCode || documentItem.product_code || "",
        productName: orderRow.item.productName || documentItem.product_name || "",
        unit: orderRow.item.unit || documentItem.unit || "adet",
        orderedQuantity,
        deliveredQuantity,
        documentQuantity,
        remainingQuantity,
        suggestedQuantity,
        status,
      };
    })
    .filter(Boolean);
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
      allocations: Array.isArray(item.allocations) ? item.allocations : [],
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
  const API_URL = process.env.NEXT_PUBLIC_API_URL;
  const id = params.id;
  const [order, setOrder] = useState(null);
  const [activeTab, setActiveTab] = useState("items");
  const [message, setMessage] = useState("");
  const [deliveryInputs, setDeliveryInputs] = useState({});
  const [receiptInputs, setReceiptInputs] = useState({});
  const [receipts, setReceipts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [documentItems, setDocumentItems] = useState([]);
  const [documentItemMatchSummary, setDocumentItemMatchSummary] = useState(null);
  const [documentUploadOpen, setDocumentUploadOpen] = useState(false);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [documentItemModalDocument, setDocumentItemModalDocument] = useState(null);
  const [documentItemSaving, setDocumentItemSaving] = useState(false);
  const [ocrDocumentItemsCreatingId, setOcrDocumentItemsCreatingId] = useState(null);
  const [ocrDocumentItemsResults, setOcrDocumentItemsResults] = useState({});
  const [documentOcrProcessingId, setDocumentOcrProcessingId] = useState(null);
  const [documentItemForm, setDocumentItemForm] = useState({
    product_code: "",
    product_name: "",
    quantity: "",
    unit: "adet",
    unit_price: "",
    total: "",
    currency: "TRY",
  });
  const [documentApprovalNotes, setDocumentApprovalNotes] = useState({});
  const [documentApprovalUpdatingId, setDocumentApprovalUpdatingId] = useState(null);
  const [documentForm, setDocumentForm] = useState({
    document_type: "diger",
    document_number: "",
    document_date: "",
    supplier_name: "",
    invoice_total: "",
    currency: "TRY",
    file: null,
  });
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

  async function loadOrderDocuments(
    orderId,
    userId,
    orderItemsForMatching = order?.items || [],
  ) {
    setDocuments([]);
    setDocumentItems([]);
    setDocumentItemMatchSummary(null);

    const { data: documentLinkRows, error: documentLinkError } = await supabase
      .from("document_links")
      .select("document_id")
      .eq("order_id", orderId)
      .eq("user_id", userId);

    if (documentLinkError) {
      console.error("Sipariş belge bağlantıları yüklenemedi:", documentLinkError);
      return;
    }

    const documentIds = Array.from(
      new Set((documentLinkRows || []).map((link) => link.document_id).filter(Boolean)),
    );

    if (documentIds.length === 0) return;

    const { data: documentRows, error: documentError } = await supabase
      .from("documents")
      .select("*")
      .in("id", documentIds)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (documentError) {
      console.error("Sipariş belgeleri yüklenemedi:", documentError);
      return;
    }

    setDocuments(documentRows || []);
    await loadDocumentItems(documentIds, userId, orderItemsForMatching, orderId);
  }

  async function persistDocumentItemMatches(rows, orderItemsForMatching, currentOrderId, userId) {
    const matchRows = (rows || []).map((documentItem) => {
      const match = matchOrderItem(documentItem, orderItemsForMatching);
      const payload = {
        matched_order_item_key:
          match.matched && !match.manualReviewRequired ? match.orderItemId : null,
        match_status: !match.matched
          ? "unmatched"
          : match.manualReviewRequired
            ? "review_required"
            : "matched",
        match_confidence: match.confidence,
        match_reason: match.reason,
        manual_review_required: match.manualReviewRequired,
      };
      const changed =
        String(documentItem.matched_order_item_key || "")
          !== String(payload.matched_order_item_key || "")
        || String(documentItem.match_status || "") !== payload.match_status
        || Number(documentItem.match_confidence || 0) !== payload.match_confidence
        || String(documentItem.match_reason || "") !== payload.match_reason
        || Boolean(documentItem.manual_review_required) !== payload.manual_review_required;

      return { documentItem, payload, changed };
    });
    const changedRows = matchRows.filter((row) => row.changed);
    const updateResults = await Promise.all(
      changedRows.map(async ({ documentItem, payload }) => {
        const { error } = await supabase
          .from("document_items")
          .update(payload)
          .eq("id", documentItem.id)
          .eq("user_id", userId);
        return { id: documentItem.id, payload, error };
      }),
    );
    const successfulUpdates = new Map(
      updateResults
        .filter((result) => !result.error)
        .map((result) => [result.id, result.payload]),
    );
    const failedUpdates = updateResults.filter((result) => result.error);
    failedUpdates.forEach((result) => {
      console.error("Belge kalemi eşleşmesi kaydedilemedi:", result.error);
    });

    setDocumentItemMatchSummary({
      totalCount: matchRows.length,
      updatedCount: successfulUpdates.size,
      failedCount: failedUpdates.length,
      orderId: currentOrderId,
    });

    return matchRows.map(({ documentItem, payload }) => ({
      ...documentItem,
      ...(successfulUpdates.has(documentItem.id) ? payload : {}),
    }));
  }

  async function loadDocumentItems(
    documentIds,
    userId,
    orderItemsForMatching = order?.items || [],
    currentOrderId = order?.id,
  ) {
    if (!documentIds?.length) {
      setDocumentItems([]);
      setDocumentItemMatchSummary({
        totalCount: 0,
        updatedCount: 0,
        failedCount: 0,
        orderId: currentOrderId,
      });
      return;
    }

    const { data, error } = await supabase
      .from("document_items")
      .select("*")
      .in("document_id", documentIds)
      .eq("user_id", userId)
      .order("line_number", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Belge kalemleri yüklenemedi:", error);
      setDocumentItems([]);
      return;
    }

    const matchedRows = await persistDocumentItemMatches(
      data || [],
      orderItemsForMatching,
      currentOrderId,
      userId,
    );
    setDocumentItems(matchedRows);
  }

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
    setDocuments([]);

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

    await loadOrderDocuments(data.id, user.id, data.items || []);

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
    const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const deliveredQuantity = items.reduce(
      (sum, item) => sum + Number(item.deliveredQuantity || 0),
      0,
    );
    const allCompleted = items.length > 0 && items.every(
      (item) => Number(item.deliveredQuantity || 0) >= Number(item.quantity || 0),
    );
    const deliveryStatus = deliveredQuantity <= 0
      ? "Bekliyor"
      : allCompleted
        ? "Tam Teslim"
        : "Kısmen Teslim";

    return {
      totalQuantity,
      deliveredQuantity,
      remainingQuantity: Math.max(totalQuantity - deliveredQuantity, 0),
      progress:
        totalQuantity > 0
          ? Math.min(Math.round((deliveredQuantity / totalQuantity) * 100), 100)
          : 0,
      deliveryStatus,
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

  async function uploadDocument(event) {
    event.preventDefault();
    if (!order || documentUploading) return;

    const file = documentForm.file;
    if (!file) {
      setMessage("Yüklenecek belge dosyasını seçin.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    setDocumentUploading(true);
    setMessage("");

    const safeFileName = String(file.name || "belge")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-");
    const fileId = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const storagePath = `${user.id}/${order.id}/${fileId}-${safeFileName}`;
    const { error: uploadError } = await supabase.storage
      .from("order-documents")
      .upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type || undefined,
        upsert: false,
      });

    if (uploadError) {
      console.error(uploadError);
      setMessage("Belge dosyası yüklenemedi.");
      setDocumentUploading(false);
      return;
    }

    const { data: documentData, error: documentError } = await supabase
      .from("documents")
      .insert({
        user_id: user.id,
        document_type: documentForm.document_type,
        original_file_name: file.name,
        storage_bucket: "order-documents",
        storage_path: storagePath,
        mime_type: file.type || null,
        file_size: file.size || null,
        document_number: documentForm.document_number.trim() || null,
        document_date: documentForm.document_date || null,
        supplier_name: documentForm.supplier_name.trim() || null,
        invoice_total: documentForm.invoice_total === ""
          ? null
          : Number(documentForm.invoice_total),
        currency: documentForm.currency || "TRY",
      })
      .select("*")
      .single();

    if (documentError) {
      console.error(documentError);
      setMessage("Belge bilgileri kaydedilemedi.");
      setDocumentUploading(false);
      return;
    }

    const { error: linkError } = await supabase.from("document_links").insert({
      document_id: documentData.id,
      order_id: order.id,
      user_id: user.id,
    });

    if (linkError) {
      console.error(linkError);
      setMessage("Belge kaydedildi ancak sipariş bağlantısı oluşturulamadı.");
      setDocumentUploading(false);
      return;
    }

    setDocumentForm({
      document_type: "diger",
      document_number: "",
      document_date: "",
      supplier_name: "",
      invoice_total: "",
      currency: "TRY",
      file: null,
    });
    setDocumentUploadOpen(false);
    setDocumentUploading(false);
    setMessage("Belge siparişe yüklendi.");
    await loadOrderDocuments(order.id, user.id);
  }

  async function updateInvoiceApproval(document, approvalStatus) {
    if (!order || document.document_type !== "fatura" || documentApprovalUpdatingId) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    setDocumentApprovalUpdatingId(document.id);
    setMessage("");

    const { error } = await supabase
      .from("documents")
      .update({
        approval_status: approvalStatus,
        approval_note: String(documentApprovalNotes[document.id] || "").trim(),
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", document.id)
      .eq("user_id", user.id)
      .eq("document_type", "fatura");

    if (error) {
      console.error(error);
      setMessage("Fatura onay durumu güncellenemedi.");
      setDocumentApprovalUpdatingId(null);
      return;
    }

    setDocumentApprovalNotes((prev) => {
      const next = { ...prev };
      delete next[document.id];
      return next;
    });
    setDocumentApprovalUpdatingId(null);
    setMessage(
      approvalStatus === "onaylandi"
        ? "Fatura farkı kabul edildi."
        : "Fatura reddedildi.",
    );
    await loadOrderDocuments(order.id, user.id);
  }

  async function analyzeDocumentWithMockOCR(document) {
    if (!order || documentOcrProcessingId) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    setDocumentOcrProcessingId(document.id);
    setMessage("");

    const mockResult = createMockOCRResult(document);
    const { error } = await supabase
      .from("documents")
      .update(mockResult)
      .eq("id", document.id)
      .eq("user_id", user.id);

    if (error) {
      console.error(error);
      setMessage("OCR analizi kaydedilemedi.");
      setDocumentOcrProcessingId(null);
      return;
    }

    setMessage("Mock OCR analizi tamamlandı.");
    await loadOrderDocuments(order.id, user.id);
    setDocumentOcrProcessingId(null);
  }

  async function analyzeDocumentWithBackendOCR(document) {
    if (!order || documentOcrProcessingId) return;
    if (!API_URL) {
      setMessage("OCR backend adresi tanımlı değil.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      router.push("/login");
      return;
    }

    setDocumentOcrProcessingId(document.id);
    setMessage("");

    try {
      const bucketName = document.storage_bucket || "order-documents";
      const { data: fileBlob, error: downloadError } = await supabase.storage
        .from(bucketName)
        .download(document.storage_path);

      if (downloadError || !fileBlob) {
        throw new Error(downloadError?.message || "Belge dosyası indirilemedi.");
      }

      const formData = new FormData();
      formData.append(
        "file",
        fileBlob,
        document.original_file_name || "order-document",
      );
      const response = await fetch(`${API_URL}/order-documents/ocr`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });
      const ocrResult = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(ocrResult.detail || "Backend OCR analizi başarısız.");
      }

      const updatePayload = {
        document_number: ocrResult.document_number || document.document_number || null,
        document_date: ocrResult.document_date || document.document_date || null,
        supplier_name: ocrResult.supplier_name || document.supplier_name || null,
        supplier_tax_number:
          ocrResult.supplier_tax_number || document.supplier_tax_number || null,
        invoice_total:
          ocrResult.invoice_total === null || ocrResult.invoice_total === undefined
            ? document.invoice_total ?? null
            : Number(ocrResult.invoice_total),
        currency: ocrResult.currency || document.currency || "TRY",
        ocr_status: "completed",
        ocr_text: ocrResult.ocr_text || "",
        ocr_result: ocrResult,
        ocr_confidence: ocrResult.ocr_confidence ?? null,
        ocr_processed_at: new Date().toISOString(),
      };
      const { error: updateError } = await supabase
        .from("documents")
        .update(updatePayload)
        .eq("id", document.id)
        .eq("user_id", session.user.id);

      if (updateError) {
        throw new Error(updateError.message || "OCR sonucu kaydedilemedi.");
      }

      setMessage("Backend OCR analizi tamamlandı.");
      await loadOrderDocuments(order.id, session.user.id);
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Backend OCR analizi başarısız.");
    } finally {
      setDocumentOcrProcessingId(null);
    }
  }

  async function createDocumentItemsFromOCR(document) {
    if (ocrDocumentItemsCreatingId) return;

    const ocrItems = getOCRDocumentItems(document);
    if (ocrItems.length === 0) {
      setOcrDocumentItemsResults((prev) => ({
        ...prev,
        [document.id]: { count: 0, message: "OCR sonucunda belge satırı bulunamadı." },
      }));
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    setOcrDocumentItemsCreatingId(document.id);
    setMessage("");

    const { count, error: countError } = await supabase
      .from("document_items")
      .select("id", { count: "exact", head: true })
      .eq("document_id", document.id)
      .eq("user_id", user.id);

    if (countError) {
      console.error(countError);
      setMessage("Belge kalemi kontrolü yapılamadı.");
      setOcrDocumentItemsCreatingId(null);
      return;
    }

    if (Number(count || 0) > 0) {
      setOcrDocumentItemsResults((prev) => ({
        ...prev,
        [document.id]: {
          count: 0,
          message: "Bu belge için daha önce belge kalemi oluşturulmuş.",
        },
      }));
      setOcrDocumentItemsCreatingId(null);
      return;
    }

    const rows = ocrItems.map((item, index) => ({
      user_id: user.id,
      document_id: document.id,
      line_number: index + 1,
      product_code: String(item.product_code || "").trim() || null,
      product_name: String(item.product_name || "").trim() || null,
      quantity: Number(item.quantity || 0),
      unit: String(item.unit || "adet").trim() || "adet",
      unit_price: Number(item.unit_price || 0),
      total: Number(item.total || 0),
      currency: item.currency || document.currency || "TRY",
    }));
    const { error: insertError } = await supabase.from("document_items").insert(rows);

    if (insertError) {
      console.error(insertError);
      setMessage("OCR belge kalemleri oluşturulamadı.");
      setOcrDocumentItemsCreatingId(null);
      return;
    }

    setOcrDocumentItemsResults((prev) => ({
      ...prev,
      [document.id]: {
        count: rows.length,
        message: `${rows.length} belge kalemi oluşturuldu.`,
      },
    }));
    setMessage(`${rows.length} OCR belge kalemi oluşturuldu.`);
    await loadDocumentItems(documents.map((row) => row.id), user.id);
    setOcrDocumentItemsCreatingId(null);
  }

  function openDocumentItemModal(document) {
    setDocumentItemModalDocument(document);
    setDocumentItemForm({
      product_code: "",
      product_name: "",
      quantity: "",
      unit: "adet",
      unit_price: "",
      total: "",
      currency: document.currency || "TRY",
    });
  }

  function closeDocumentItemModal() {
    if (documentItemSaving) return;
    setDocumentItemModalDocument(null);
  }

  async function saveDocumentItem(event) {
    event.preventDefault();
    if (!documentItemModalDocument || documentItemSaving) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    setDocumentItemSaving(true);
    setMessage("");

    const quantity = documentItemForm.quantity === ""
      ? null
      : Number(documentItemForm.quantity);
    const unitPrice = documentItemForm.unit_price === ""
      ? null
      : Number(documentItemForm.unit_price);
    const total = documentItemForm.total === ""
      ? quantity !== null && unitPrice !== null
        ? quantity * unitPrice
        : null
      : Number(documentItemForm.total);
    const currentLineNumbers = documentItems
      .filter((item) => item.document_id === documentItemModalDocument.id)
      .map((item) => Number(item.line_number || 0));
    const lineNumber = Math.max(0, ...currentLineNumbers) + 1;

    const { error } = await supabase.from("document_items").insert({
      user_id: user.id,
      document_id: documentItemModalDocument.id,
      line_number: lineNumber,
      product_code: documentItemForm.product_code.trim() || null,
      product_name: documentItemForm.product_name.trim() || null,
      quantity,
      unit: documentItemForm.unit.trim() || "adet",
      unit_price: unitPrice,
      total,
      currency: documentItemForm.currency || "TRY",
    });

    if (error) {
      console.error(error);
      setMessage("Belge kalemi kaydedilemedi.");
      setDocumentItemSaving(false);
      return;
    }

    setDocumentItemSaving(false);
    setDocumentItemModalDocument(null);
    setMessage("Belge kalemi eklendi.");
    await loadDocumentItems(documents.map((document) => document.id), user.id);
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

        <DeliveryStatusPanel totals={totals} />

        <DeliveryInvoiceConsistencyPanel
          order={order}
          items={items}
          receipts={receipts}
          documents={documents}
          documentItems={documentItems}
        />

        <AutomaticReceiptSuggestionsPanel
          order={order}
          items={items}
          receipts={receipts}
          documentItems={documentItems}
        />

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 pt-4">
            {[
              ["items", "Ürün Kalemleri"],
              ["connections", "Bağlantılar"],
              ["delivery", "Teslimatlar"],
              ["receiving", "Depo Teslim Alma"],
              ["payment", "Ödemeler"],
              ["documents", "Belgeler"],
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
            {activeTab === "connections" && <ConnectionsPanel items={items} />}
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
            {activeTab === "documents" && (
              <DocumentsPanel
                documents={documents}
                documentItems={documentItems}
                orderItems={items}
                rawOrderItems={order.items || []}
                matchSummary={documentItemMatchSummary}
                order={order}
                companySettings={companySettings}
                form={documentForm}
                uploadOpen={documentUploadOpen}
                uploading={documentUploading}
                approvalNotes={documentApprovalNotes}
                approvalUpdatingId={documentApprovalUpdatingId}
                ocrProcessingId={documentOcrProcessingId}
                ocrItemsCreatingId={ocrDocumentItemsCreatingId}
                ocrItemsResults={ocrDocumentItemsResults}
                onToggleUpload={() => setDocumentUploadOpen((prev) => !prev)}
                onFormChange={setDocumentForm}
                onUpload={uploadDocument}
                onApprovalNoteChange={(documentId, value) =>
                  setDocumentApprovalNotes((prev) => ({ ...prev, [documentId]: value }))
                }
                onApproval={updateInvoiceApproval}
                onAnalyzeOCR={analyzeDocumentWithBackendOCR}
                onCreateItemsFromOCR={createDocumentItemsFromOCR}
                onAddDocumentItem={openDocumentItemModal}
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
        {documentItemModalDocument && (
          <DocumentItemModal
            document={documentItemModalDocument}
            form={documentItemForm}
            saving={documentItemSaving}
            onFormChange={setDocumentItemForm}
            onClose={closeDocumentItemModal}
            onSave={saveDocumentItem}
          />
        )}
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

function DeliveryStatusPanel({ totals }) {
  const statusClass = totals.deliveryStatus === "Tam Teslim"
    ? "bg-emerald-100 text-emerald-700"
    : totals.deliveryStatus === "Kısmen Teslim"
      ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-700";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">Teslimat Durumu</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass}`}>
          {totals.deliveryStatus}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Info label="Toplam Sipariş Miktarı" value={totals.totalQuantity} />
        <Info label="Teslim Edilen Miktar" value={totals.deliveredQuantity} />
        <Info label="Kalan Miktar" value={totals.remainingQuantity} />
        <Info label="Tamamlanma Yüzdesi" value={`%${totals.progress}`} />
      </div>
      <div className="mt-4 h-3 rounded-full bg-slate-100">
        <div
          className="h-3 rounded-full bg-emerald-500 transition-all"
          style={{ width: `${totals.progress}%` }}
        />
      </div>
    </div>
  );
}

function DeliveryInvoiceConsistencyPanel({
  order,
  items,
  receipts,
  documents,
  documentItems,
}) {
  const summary = calculateDeliveryInvoiceConsistency(
    items,
    order.items || [],
    receipts,
    documents,
    documentItems,
    order.id,
  );
  const statusClasses = {
    "Tam Uyum": "bg-emerald-100 text-emerald-700",
    "Kısmi Teslim": "bg-amber-100 text-amber-700",
    "Kısmi Fatura": "bg-yellow-100 text-yellow-700",
    "Fazla Fatura": "bg-red-100 text-red-700",
    "Fazla Teslim": "bg-rose-100 text-rose-700",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Teslimat ve Fatura Kontrolü</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Info label="Toplam Sipariş" value={summary.totalOrdered} />
        <Info label="Toplam Teslim" value={summary.totalDelivered} />
        <Info label="Toplam Faturalanan" value={summary.totalInvoiced} />
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-100 text-xs font-bold uppercase text-slate-500">
            <tr>
              <th className="p-3">Sipariş Kalemi</th>
              <th className="p-3 text-right">Sipariş</th>
              <th className="p-3 text-right">Teslim</th>
              <th className="p-3 text-right">Faturalanan</th>
              <th className="p-3">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary.rows.map((row) => (
              <tr key={row.fallbackOrderItemId}>
                <td className="p-3">
                  <div className="font-bold text-slate-900">{row.productName || "-"}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {row.productCode || "-"} · {row.unit}
                  </div>
                </td>
                <td className="p-3 text-right font-semibold text-slate-700">
                  {row.orderedQuantity}
                </td>
                <td className="p-3 text-right font-semibold text-slate-700">
                  {row.deliveredQuantity}
                </td>
                <td className="p-3 text-right font-semibold text-slate-700">
                  {row.invoicedQuantity}
                </td>
                <td className="p-3">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusClasses[row.status]}`}>
                    {row.status}
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

function ReceiptSuggestionTable({ rows, emptyMessage }) {
  const statusClasses = {
    "Tam Uygun": "bg-emerald-100 text-emerald-700",
    "Kısmi Teslim": "bg-amber-100 text-amber-700",
    "Fazla Teslim": "bg-red-100 text-red-700",
    "Teslim Tamamlanmış": "bg-slate-200 text-slate-700",
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs font-bold uppercase text-slate-500">
          <tr>
            <th className="p-3">Ürün</th>
            <th className="p-3 text-right">Sipariş</th>
            <th className="p-3 text-right">Teslim Edilen</th>
            <th className="p-3 text-right">Belgede Gelen</th>
            <th className="p-3 text-right">Kalan</th>
            <th className="p-3 text-right">Önerilen Teslim</th>
            <th className="p-3">Durum</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id} className={row.status === "Fazla Teslim" ? "bg-red-50" : "bg-white"}>
              <td className="p-3">
                <div className="font-bold text-slate-900">{row.productName || "-"}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {row.productCode || "-"} · {row.unit}
                </div>
              </td>
              <td className="p-3 text-right font-semibold text-slate-700">{row.orderedQuantity}</td>
              <td className="p-3 text-right font-semibold text-slate-700">{row.deliveredQuantity}</td>
              <td className="p-3 text-right font-semibold text-slate-700">{row.documentQuantity}</td>
              <td className="p-3 text-right font-semibold text-slate-700">{row.remainingQuantity}</td>
              <td className="p-3 text-right font-black text-blue-700">{row.suggestedQuantity}</td>
              <td className="p-3">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${statusClasses[row.status]}`}>
                  {row.status}
                </span>
                {row.status === "Fazla Teslim" && (
                  <div className="mt-2 text-xs font-bold text-red-700">
                    Belge miktarı kalan sipariş miktarını aşıyor.
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutomaticReceiptSuggestionsPanel({ order, items, receipts, documentItems }) {
  const suggestions = calculateAutomaticReceiptSuggestions(
    items,
    order.items || [],
    receipts,
    documentItems,
    order.id,
  );
  const activeSuggestions = suggestions.filter(
    (suggestion) => suggestion.status !== "Teslim Tamamlanmış",
  );
  const completedSuggestions = suggestions.filter(
    (suggestion) => suggestion.status === "Teslim Tamamlanmış",
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900">Otomatik Teslim Alma Önerileri</h2>
      <p className="mt-1 text-sm text-slate-500">
        Eşleşmiş belge kalemlerinden yalnızca öneri üretilir; teslim veya stok kaydı oluşturulmaz.
      </p>
      <div className="mt-4">
        <ReceiptSuggestionTable
          rows={activeSuggestions}
          emptyMessage="Aktif teslim alma önerisi bulunmuyor."
        />
      </div>
      <div className="mt-6">
        <h3 className="mb-3 text-sm font-bold text-slate-900">Teslimi Tamamlanmış Kalemler</h3>
        <ReceiptSuggestionTable
          rows={completedSuggestions}
          emptyMessage="Teslimi tamamlanmış eşleşmiş belge kalemi bulunmuyor."
        />
      </div>
    </div>
  );
}

function ConnectionsPanel({ items }) {
  return (
    <div className="space-y-4">
      {items.map((item, index) => {
        const allocatedQuantity = item.allocations.reduce(
          (sum, allocation) => sum + Number(allocation.quantity || 0),
          0,
        );
        const openQuantity = Math.max(Number(item.quantity || 0) - allocatedQuantity, 0);
        const isOverAllocated = allocatedQuantity > Number(item.quantity || 0);
        const hasOpenQuantity = allocatedQuantity < Number(item.quantity || 0);

        return (
          <div
            key={`${item.productCode}-${item.productName}-${index}`}
            className="rounded-2xl border border-slate-200 p-4"
          >
            <div className="font-black text-slate-900">{item.productName}</div>
            <div className="mt-1 text-xs text-slate-500">Ürün kodu: {item.productCode || "-"}</div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <div className="text-xs font-bold text-slate-500">Sipariş miktarı</div>
                <div className="mt-1 font-black text-slate-900">
                  {Number(item.quantity || 0)} {item.unit || "adet"}
                </div>
              </div>
              <div className="rounded-xl bg-blue-50 p-3 text-sm">
                <div className="text-xs font-bold text-blue-600">Dağıtılan miktar</div>
                <div className="mt-1 font-black text-blue-900">
                  {allocatedQuantity} {item.unit || "adet"}
                </div>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 text-sm">
                <div className="text-xs font-bold text-amber-600">Açıkta kalan miktar</div>
                <div className="mt-1 font-black text-amber-900">
                  {openQuantity} {item.unit || "adet"}
                </div>
              </div>
            </div>

            {item.allocations.length > 0 ? (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {item.allocations.map((allocation, allocationIndex) => (
                  <div
                    key={`${allocation.type}-${allocation.projectId || "stock"}-${allocationIndex}`}
                    className="rounded-xl border border-slate-200 bg-white p-4 text-sm"
                  >
                    {allocation.type === "stock" ? (
                      <>
                        <div className="font-bold text-emerald-700">Stok için ayrıldı</div>
                        <div className="mt-3 text-xs font-bold text-slate-500">Miktar</div>
                        <div className="mt-1 font-black text-slate-900">
                          {Number(allocation.quantity || 0)} {item.unit || "adet"}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-xs font-bold text-slate-500">Proje kodu</div>
                        <div className="mt-1 font-black text-slate-900">
                          {allocation.projectCode || "-"}
                        </div>
                        <div className="mt-3 text-xs font-bold text-slate-500">Proje adı</div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {allocation.projectName || "-"}
                        </div>
                        <div className="mt-3 text-xs font-bold text-slate-500">Proje kalemi</div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {allocation.projectItemName || "-"}
                        </div>
                        <div className="mt-3 text-xs font-bold text-slate-500">Miktar</div>
                        <div className="mt-1 font-black text-slate-900">
                          {Number(allocation.quantity || 0)} {item.unit || "adet"}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                Bu kalem henüz projeye veya stoğa dağıtılmamış.
              </div>
            )}

            {isOverAllocated && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
                Dağıtım miktarı sipariş miktarını aşıyor.
              </div>
            )}
            {hasOpenQuantity && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-700">
                Bu kalemde açıkta kalan miktar var.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function calculateInvoiceOrderCheck(order, documents, companySettings) {
  const invoices = (documents || []).filter(
    (document) => document.document_type === "fatura",
  );
  const baseCurrency = getBaseCurrency(companySettings);
  const totalsByCurrency = new Map();
  let invoiceBaseTotal = 0;
  let pendingInvoiceBaseTotal = 0;
  let hasMissingInvoiceData = false;
  let hasCurrencyMismatch = false;

  invoices.forEach((invoice) => {
    const hasTotal = invoice.invoice_total !== null
      && invoice.invoice_total !== undefined
      && invoice.invoice_total !== "";
    const invoiceCurrency = String(invoice.currency || "").trim().toUpperCase();

    if (!hasTotal || !invoiceCurrency) {
      hasMissingInvoiceData = true;
      return;
    }

    const invoiceTotal = Number(invoice.invoice_total || 0);
    const invoiceBaseAmount = calculateBaseAmount(
      invoiceTotal,
      invoiceCurrency,
      companySettings,
    );
    if (invoiceCurrency !== String(order.currency || "").toUpperCase()) {
      hasCurrencyMismatch = true;
    }

    const approvalStatus = String(invoice.approval_status || "").trim().toLowerCase();
    if (approvalStatus === "reddedildi") return;
    if (approvalStatus === "bekliyor") {
      pendingInvoiceBaseTotal += invoiceBaseAmount;
      return;
    }
    if (approvalStatus && approvalStatus !== "onaylandi") return;

    totalsByCurrency.set(
      invoiceCurrency,
      Number(totalsByCurrency.get(invoiceCurrency) || 0) + invoiceTotal,
    );
    invoiceBaseTotal += invoiceBaseAmount;
  });

  const orderBaseTotal = Number(
    order.order_total_base
      || order.base_amount
      || calculateBaseAmount(
        order.total_amount,
        order.currency,
        companySettings,
        order.exchange_rate,
      ),
  );
  const difference = invoiceBaseTotal - orderBaseTotal;
  const remainingInvoiceAmount = Math.max(orderBaseTotal - invoiceBaseTotal, 0);
  const excessInvoiceAmount = Math.max(invoiceBaseTotal - orderBaseTotal, 0);
  const differencePercent = orderBaseTotal > 0
    ? (Math.abs(difference) / orderBaseTotal) * 100
    : invoiceBaseTotal === 0
      ? 0
      : 100;
  const billingStatus = invoices.length === 0
    ? "none"
    : excessInvoiceAmount > 0.01
      ? "over"
      : remainingInvoiceAmount > 0.01
        ? "partial"
        : "full";

  return {
    invoices,
    baseCurrency,
    totalsByCurrency: Array.from(totalsByCurrency, ([currency, total]) => ({ currency, total })),
    invoiceBaseTotal,
    pendingInvoiceBaseTotal,
    orderBaseTotal,
    difference,
    differencePercent,
    remainingInvoiceAmount,
    excessInvoiceAmount,
    billingStatus,
    hasMissingInvoiceData,
    hasCurrencyMismatch,
  };
}

function InvoiceCheckPanel({ order, documents, companySettings }) {
  const check = calculateInvoiceOrderCheck(order, documents, companySettings);
  const statusDetails = {
    none: { label: "Fatura yok", className: "bg-slate-200 text-slate-700" },
    partial: { label: "Kısmi faturalandı", className: "bg-amber-100 text-amber-700" },
    full: { label: "Tam faturalandı", className: "bg-emerald-100 text-emerald-700" },
    over: { label: "Fazla faturalandı", className: "bg-red-100 text-red-700" },
  }[check.billingStatus];

  return (
    <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-bold text-blue-950">Fatura Kontrolü</h4>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusDetails.className}`}>
          {statusDetails.label}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <Info
          label="Fatura Toplamı"
          value={
            check.totalsByCurrency.length > 0
              ? check.totalsByCurrency.map((row) => formatMoney(row.total, row.currency)).join(" · ")
              : "-"
          }
        />
        <Info label="Sipariş Toplamı" value={formatMoney(order.total_amount, order.currency)} />
        <Info
          label={`Fatura Toplamı (${check.baseCurrency})`}
          value={formatMoney(check.invoiceBaseTotal, check.baseCurrency)}
        />
        <Info
          label={`Sipariş Toplamı (${check.baseCurrency})`}
          value={formatMoney(check.orderBaseTotal, check.baseCurrency)}
        />
        <Info
          label="Kalan Faturalandırılacak Tutar"
          value={formatMoney(check.remainingInvoiceAmount, check.baseCurrency)}
        />
        <Info
          label="Fazla Fatura Farkı"
          value={formatMoney(check.excessInvoiceAmount, check.baseCurrency)}
        />
        <Info label="Baz Para Net Farkı" value={formatMoney(check.difference, check.baseCurrency)} />
        <Info
          label="Fark Oranı"
          value={`%${check.differencePercent.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`}
        />
        <Info
          label="Onay Bekleyen Faturalar Toplamı"
          value={formatMoney(check.pendingInvoiceBaseTotal, check.baseCurrency)}
        />
      </div>
      {check.billingStatus === "none" && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
          Henüz fatura yüklenmedi.
        </div>
      )}
      {check.hasCurrencyMismatch && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          Fatura ve sipariş para birimi farklı. Kur kontrolü manuel doğrulanmalıdır.
        </div>
      )}
      {check.hasMissingInvoiceData && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          Fatura tutarı/para birimi eksik
        </div>
      )}
    </div>
  );
}

function DocumentItemsPanel({
  document,
  items,
  orderItems,
  rawOrderItems,
  orderCurrency,
  onAdd,
}) {
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-slate-900">Belge Kalemleri</h4>
        <button
          type="button"
          onClick={() => onAdd(document)}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
        >
          Kalem Ekle
        </button>
      </div>
      {items.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-100 font-bold uppercase text-slate-500">
              <tr>
                <th className="p-2">Ürün Kodu</th>
                <th className="p-2">Ürün Adı</th>
                <th className="p-2 text-right">Miktar</th>
                <th className="p-2">Birim</th>
                <th className="p-2 text-right">Birim Fiyat</th>
                <th className="p-2 text-right">Toplam</th>
                <th className="p-2">Para Birimi</th>
                <th className="p-2">Eşleşen Sipariş Kalemi</th>
                <th className="p-2 text-right">Güven</th>
                <th className="p-2">Eşleşme Durumu</th>
                <th className="p-2">Sebep</th>
                <th className="p-2 text-right">Sipariş Fiyatı</th>
                <th className="p-2 text-right">Belge Fiyatı</th>
                <th className="p-2 text-right">Fark %</th>
                <th className="p-2">Fiyat Durumu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const productCode = item.product_code || "";
                const productName = item.product_name || "";
                const quantity = Number(item.quantity ?? 0);
                const unit = item.unit || "adet";
                const unitPrice = Number(item.unit_price ?? 0);
                const total = Number(item.total ?? quantity * unitPrice);
                const currency = item.currency || document.currency || "TRY";
                const previewMatch = matchOrderItem(item, orderItems);
                const persistedMatchIndex = item.matched_order_item_key
                  ? rawOrderItems.findIndex(
                      (orderItem, orderIndex) =>
                        getOrderItemMatchId(orderItem, orderIndex)
                          === item.matched_order_item_key,
                    )
                  : -1;
                const previewMatchIndex = previewMatch.matched
                  ? orderItems.findIndex(
                      (orderItem, orderIndex) =>
                        getOrderItemMatchId(orderItem, orderIndex) === previewMatch.orderItemId,
                    )
                  : -1;
                const matchedOrderItem = persistedMatchIndex >= 0
                  ? orderItems[persistedMatchIndex]
                  : previewMatchIndex >= 0
                    ? orderItems[previewMatchIndex]
                    : null;
                const matchStatus = item.match_status || "unmatched";
                const matchConfidence = Number(item.match_confidence || 0);
                const matchReason = item.match_reason || "unmatched";
                const manualReviewRequired = Boolean(item.manual_review_required);
                const priceCheck = calculateItemPriceCheck(
                  matchStatus === "matched" ? matchedOrderItem : null,
                  item,
                );
                const priceStatusDetails = {
                  exact: { label: "Tam Uyum", className: "bg-emerald-100 text-emerald-700" },
                  small: { label: "Küçük Fark", className: "bg-amber-100 text-amber-700" },
                  high: { label: "Yüksek Fark", className: "bg-orange-100 text-orange-700" },
                  critical: { label: "Kritik Fark", className: "bg-red-100 text-red-700" },
                  unavailable: { label: "Eşleşme Yok", className: "bg-slate-100 text-slate-600" },
                }[priceCheck.status];
                const orderItemCurrency = matchedOrderItem?.currency || orderCurrency || "TRY";

                return (
                  <tr key={item.id}>
                    <td className="p-2 font-bold text-slate-800">{productCode || "-"}</td>
                    <td className="p-2 text-slate-700">{productName || "-"}</td>
                    <td className="p-2 text-right font-semibold text-slate-800">{quantity}</td>
                    <td className="p-2 text-slate-700">{unit}</td>
                    <td className="p-2 text-right text-slate-700">
                      {formatMoney(unitPrice, currency)}
                    </td>
                    <td className="p-2 text-right font-bold text-slate-900">
                      {formatMoney(total, currency)}
                    </td>
                    <td className="p-2 font-semibold text-slate-700">{currency}</td>
                    <td className="min-w-[220px] p-2 text-slate-700">
                      {matchedOrderItem
                        ? `${matchedOrderItem.productCode || "-"} · ${matchedOrderItem.productName || "-"}`
                        : "Eşleşme yok"}
                      {manualReviewRequired && (
                        <div className="mt-1 rounded-lg bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                          Manuel Kontrol Gerekli
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-right font-black text-blue-700">
                      {matchConfidence}
                    </td>
                    <td className="p-2 font-semibold text-slate-700">{matchStatus}</td>
                    <td className="p-2 font-mono text-[11px] text-slate-600">
                      {matchReason}
                    </td>
                    <td className="p-2 text-right font-semibold text-slate-700">
                      {priceCheck.orderUnitPrice === null
                        ? "-"
                        : formatMoney(priceCheck.orderUnitPrice, orderItemCurrency)}
                    </td>
                    <td className="p-2 text-right font-semibold text-slate-700">
                      {formatMoney(priceCheck.documentUnitPrice, currency)}
                    </td>
                    <td className="p-2 text-right font-black text-slate-900">
                      {priceCheck.priceDifferencePercent === null
                        ? "-"
                        : `%${priceCheck.priceDifferencePercent.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`}
                    </td>
                    <td className="p-2">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${priceStatusDetails.className}`}>
                        {priceStatusDetails.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
          Henüz belge kalemi eklenmemiş.
        </div>
      )}
    </div>
  );
}

function DocumentsPanel({
  documents,
  documentItems,
  orderItems,
  rawOrderItems,
  matchSummary,
  order,
  companySettings,
  form,
  uploadOpen,
  uploading,
  approvalNotes,
  approvalUpdatingId,
  ocrProcessingId,
  ocrItemsCreatingId,
  ocrItemsResults,
  onToggleUpload,
  onFormChange,
  onUpload,
  onApprovalNoteChange,
  onApproval,
  onAnalyzeOCR,
  onCreateItemsFromOCR,
  onAddDocumentItem,
}) {
  const sections = [
    { type: "teklif", label: "Teklif Belgeleri" },
    { type: "irsaliye", label: "İrsaliyeler" },
    { type: "fatura", label: "Faturalar" },
    { type: "odeme", label: "Ödeme Belgeleri" },
    { type: "diger", label: "Diğer Belgeler" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-blue-900">
          Bu alanda siparişe bağlı teklif, irsaliye, fatura ve ödeme belgeleri takip edilecek.
        </div>
        <button
          type="button"
          onClick={onToggleUpload}
          className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
        >
          {uploadOpen ? "Formu Kapat" : "Belge Yükle"}
        </button>
      </div>

      {matchSummary && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm font-semibold text-indigo-900">
          Otomatik eşleştirme: {matchSummary.totalCount} kayıt kontrol edildi, {matchSummary.updatedCount} kayıt güncellendi
          {matchSummary.failedCount > 0 ? `, ${matchSummary.failedCount} kayıt güncellenemedi` : ""}.
        </div>
      )}

      {uploadOpen && (
        <form onSubmit={onUpload} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-600">Belge Türü</span>
              <select
                value={form.document_type}
                onChange={(event) => onFormChange((prev) => ({ ...prev, document_type: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
              >
                {sections.map((section) => (
                  <option key={section.type} value={section.type}>{section.label}</option>
                ))}
              </select>
            </label>
            <DocumentInput
              label="Belge Numarası"
              value={form.document_number}
              onChange={(value) => onFormChange((prev) => ({ ...prev, document_number: value }))}
            />
            <DocumentInput
              label="Belge Tarihi"
              type="date"
              value={form.document_date}
              onChange={(value) => onFormChange((prev) => ({ ...prev, document_date: value }))}
            />
            <DocumentInput
              label="Tedarikçi"
              value={form.supplier_name}
              onChange={(value) => onFormChange((prev) => ({ ...prev, supplier_name: value }))}
            />
            <DocumentInput
              label="Belge Tutarı"
              type="number"
              value={form.invoice_total}
              onChange={(value) => onFormChange((prev) => ({ ...prev, invoice_total: value }))}
            />
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-600">Para Birimi</span>
              <select
                value={form.currency}
                onChange={(event) => onFormChange((prev) => ({ ...prev, currency: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
              >
                {currencyOptions.map((currency) => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </label>
            <label className="block md:col-span-2 xl:col-span-3">
              <span className="mb-1 block text-xs font-bold text-slate-600">Dosya</span>
              <input
                type="file"
                required
                onChange={(event) => onFormChange((prev) => ({ ...prev, file: event.target.files?.[0] || null }))}
                className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
              />
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={uploading}
              className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {uploading ? "Yükleniyor..." : "Belgeyi Kaydet"}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {sections.map((section) => {
          const sectionDocuments = documents.filter(
            (document) => document.document_type === section.type,
          );

          return (
            <div key={section.type} className="rounded-2xl border border-slate-200 p-4">
              <h3 className="font-bold text-slate-900">{section.label}</h3>
              {section.type === "fatura" && (
                <InvoiceCheckPanel
                  order={order}
                  documents={documents}
                  companySettings={companySettings}
                />
              )}
              {sectionDocuments.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {sectionDocuments.map((document) => {
                    const approvalStatus = document.approval_status || "bekliyor";
                    const ocrItems = getOCRDocumentItems(document);
                    const currentDocumentItems = documentItems.filter(
                      (item) => item.document_id === document.id,
                    );
                    const approvalClass = approvalStatus === "onaylandi"
                      ? "bg-emerald-100 text-emerald-700"
                      : approvalStatus === "reddedildi"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700";
                    const approvalLabel = approvalStatus === "onaylandi"
                      ? "Onaylandı"
                      : approvalStatus === "reddedildi"
                        ? "Reddedildi"
                        : "Bekliyor";
                    return (
                      <div key={document.id} className="rounded-xl bg-slate-50 p-4 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-bold text-slate-900">
                            {document.original_file_name || "-"}
                          </div>
                          <button
                            type="button"
                            disabled={Boolean(ocrProcessingId)}
                            onClick={() => onAnalyzeOCR(document)}
                            className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {ocrProcessingId === document.id ? "Analiz Ediliyor..." : "OCR Analiz Et"}
                          </button>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Info label="Belge No" value={document.document_number || "-"} />
                          <Info label="Belge Tarihi" value={document.document_date || "-"} />
                          <Info
                            label="Tutar"
                            value={
                              document.invoice_total === null || document.invoice_total === undefined
                                ? "-"
                                : formatMoney(document.invoice_total, document.currency || "TRY")
                            }
                          />
                          <Info
                            label="Doğrulama Durumu"
                            value={document.verification_status || "-"}
                          />
                          {section.type === "fatura" && (
                            <Info
                              label="Onay Durumu"
                              value={
                                <span className={`rounded-full px-3 py-1 text-xs font-bold ${approvalClass}`}>
                                  {approvalLabel}
                                </span>
                              }
                            />
                          )}
                        </div>
                        {(document.ocr_result || document.ocr_status === "completed") && (
                          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
                            <h4 className="font-bold text-violet-950">OCR Sonucu</h4>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                              <Info label="Belge No" value={document.document_number || "-"} />
                              <Info label="Tarih" value={document.document_date || "-"} />
                              <Info label="Tedarikçi" value={document.supplier_name || "-"} />
                              <Info
                                label="Toplam Tutar"
                                value={
                                  document.invoice_total === null || document.invoice_total === undefined
                                    ? "-"
                                    : formatMoney(document.invoice_total, document.currency || "TRY")
                                }
                              />
                              <Info label="Para Birimi" value={document.currency || "-"} />
                              <Info
                                label="OCR Güven Skoru"
                                value={
                                  document.ocr_confidence === null || document.ocr_confidence === undefined
                                    ? "-"
                                    : `%${(Number(document.ocr_confidence) * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`
                                }
                              />
                            </div>
                            {ocrItems.length > 0 && (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={
                                    Boolean(ocrItemsCreatingId)
                                    || currentDocumentItems.length > 0
                                  }
                                  onClick={() => onCreateItemsFromOCR(document)}
                                  className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                >
                                  {ocrItemsCreatingId === document.id
                                    ? "Kalemler Oluşturuluyor..."
                                    : `OCR Kalemlerini Oluştur (${ocrItems.length})`}
                                </button>
                                {currentDocumentItems.length > 0 && (
                                  <span className="text-xs font-semibold text-violet-800">
                                    Bu belge için belge kalemleri mevcut.
                                  </span>
                                )}
                              </div>
                            )}
                            {ocrItemsResults[document.id] && (
                              <div className="mt-3 rounded-lg bg-white p-3 text-xs font-bold text-violet-800">
                                {ocrItemsResults[document.id].message}
                              </div>
                            )}
                          </div>
                        )}
                        <DocumentItemsPanel
                          document={document}
                          items={currentDocumentItems}
                          orderItems={orderItems}
                          rawOrderItems={rawOrderItems}
                          orderCurrency={order.currency}
                          onAdd={onAddDocumentItem}
                        />
                        {section.type === "fatura" && (
                          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                            <label className="block">
                              <span className="mb-1 block text-xs font-bold text-slate-600">Onay Notu</span>
                              <input
                                value={approvalNotes[document.id] || ""}
                                maxLength={250}
                                disabled={Boolean(approvalUpdatingId)}
                                onChange={(event) => onApprovalNoteChange(document.id, event.target.value)}
                                className="w-full rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-100"
                                placeholder="Kısa not (isteğe bağlı)"
                              />
                            </label>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={Boolean(approvalUpdatingId)}
                                onClick={() => onApproval(document, "onaylandi")}
                                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:bg-slate-300"
                              >
                                Farkı Kabul Et
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(approvalUpdatingId)}
                                onClick={() => onApproval(document, "reddedildi")}
                                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:bg-slate-300"
                              >
                                Reddet
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : section.type !== "fatura" ? (
                <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                  Henüz belge yüklenmedi.
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DocumentItemModal({ document, form, saving, onFormChange, onClose, onSave }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-item-modal-title"
    >
      <form
        onSubmit={onSave}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="document-item-modal-title" className="text-xl font-black text-slate-900">
              Belge Kalemi Ekle
            </h2>
            <p className="mt-1 text-sm text-slate-500">{document.original_file_name || "Belge"}</p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 disabled:bg-slate-100"
          >
            Kapat
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <DocumentInput
            label="Ürün Kodu"
            value={form.product_code}
            onChange={(value) => onFormChange((prev) => ({ ...prev, product_code: value }))}
          />
          <DocumentInput
            label="Ürün Adı"
            value={form.product_name}
            onChange={(value) => onFormChange((prev) => ({ ...prev, product_name: value }))}
          />
          <DocumentInput
            label="Miktar"
            type="number"
            value={form.quantity}
            onChange={(value) => onFormChange((prev) => ({ ...prev, quantity: value }))}
          />
          <DocumentInput
            label="Birim"
            value={form.unit}
            onChange={(value) => onFormChange((prev) => ({ ...prev, unit: value }))}
          />
          <DocumentInput
            label="Birim Fiyat"
            type="number"
            value={form.unit_price}
            onChange={(value) => onFormChange((prev) => ({ ...prev, unit_price: value }))}
          />
          <DocumentInput
            label="Toplam"
            type="number"
            value={form.total}
            onChange={(value) => onFormChange((prev) => ({ ...prev, total: value }))}
          />
          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-bold text-slate-600">Para Birimi</span>
            <select
              value={form.currency}
              onChange={(event) => onFormChange((prev) => ({ ...prev, currency: event.target.value }))}
              className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
            >
              {currencyOptions.map((currency) => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 disabled:bg-slate-100"
          >
            İptal
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </div>
      </form>
    </div>
  );
}

function DocumentInput({ label, type = "text", value, onChange }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "0.01" : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
      />
    </label>
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
          const orderedQuantity = Number(item.quantity || 0);
          const deliveredQuantity = Number(item.deliveredQuantity || 0);
          const remainingQuantity = orderedQuantity - deliveredQuantity;
          const remainingToReceive = Math.max(remainingQuantity, 0);
          const isOverDelivered = deliveredQuantity > orderedQuantity;
          const itemStatus = deliveredQuantity <= 0
            ? "Bekliyor"
            : deliveredQuantity >= orderedQuantity
              ? "Tam Teslim"
              : "Kısmen Teslim";
          const rowClass = isOverDelivered
            ? "border-red-300 bg-red-50"
            : remainingQuantity <= 0
              ? "border-emerald-300 bg-emerald-50"
              : "border-amber-300 bg-amber-50";
          const received = Number(input.receivedQuantity ?? remainingToReceive);
          const defective = Number(input.defectiveQuantity || 0);
          const missing = Math.max(orderedQuantity - received, 0);
          const excess = Math.max(received - orderedQuantity, 0);

          return (
            <div key={`${item.productCode}-${item.productName}-${index}`} className={`rounded-2xl border p-4 ${rowClass}`}>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_repeat(4,110px)] lg:items-center">
                <div>
                  <div className="font-black text-slate-900">{item.productName}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.productCode || "-"}</div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg bg-white p-2">
                      <div className="font-bold text-slate-500">Sipariş</div>
                      <div className="mt-1 font-black text-slate-900">{orderedQuantity}</div>
                    </div>
                    <div className="rounded-lg bg-white p-2">
                      <div className="font-bold text-slate-500">Teslim</div>
                      <div className="mt-1 font-black text-slate-900">{deliveredQuantity}</div>
                    </div>
                    <div className="rounded-lg bg-white p-2">
                      <div className="font-bold text-slate-500">Kalan</div>
                      <div className="mt-1 font-black text-slate-900">{remainingQuantity}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs font-bold text-slate-700">{itemStatus}</div>
                  {isOverDelivered && (
                    <div className="mt-2 rounded-lg bg-red-100 p-2 text-xs font-bold text-red-700">
                      Teslim edilen miktar sipariş miktarını aşıyor
                    </div>
                  )}
                </div>
                <NumberInput
                  label="Gelen"
                  value={input.receivedQuantity ?? remainingToReceive}
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
