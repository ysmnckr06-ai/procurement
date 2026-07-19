"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createDocumentSignedUrl, downloadDocumentFile, isPdfDocument } from "@/lib/documentAccess";
import { supabase } from "@/lib/supabase";
import { calculateBaseAmount, currencyOptions, getBaseCurrency, getExchangeRate } from "@/lib/currency";
import { findOrCreateBusinessPartner } from "@/lib/businessPartners";
import { matchProduct } from "@/lib/productMatching";
import { CORVIAN_PRODUCT_NAME, fetchCompanyBranding } from "@/lib/companyBranding";

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

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function getNowStamp() {
  return new Date().toISOString();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
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

async function fileSha256(file) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  documents = [],
) {
  const eligibleDocumentIds = new Set(
    (documents || [])
      .filter((document) => ["irsaliye", "depo_giris"].includes(document.document_type) && document.approval_status !== "reddedildi")
      .map((document) => document.id),
  );
  const processedDocumentItemIds = new Set(
    (receipts || [])
      .map((receipt) => {
        if (receipt.document_item_id) return String(receipt.document_item_id);
        const marker = String(receipt.note || "").match(/\[document_item_id:([^\]]+)\]/);
        return marker?.[1] || null;
      })
      .filter(Boolean),
  );
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

  const suggestionRemainingByOrderItem = new Map();

  return (documentItems || [])
    .filter(
      (documentItem) =>
        eligibleDocumentIds.has(documentItem.document_id)
        &&
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
      const baseRemainingQuantity = Math.max(orderedQuantity - deliveredQuantity, 0);
      const remainingQuantity = suggestionRemainingByOrderItem.has(orderRow.orderItemId)
        ? suggestionRemainingByOrderItem.get(orderRow.orderItemId)
        : baseRemainingQuantity;
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
      const matchConfidence = Number(documentItem.match_confidence || 0);
      const alreadyProcessed = processedDocumentItemIds.has(String(documentItem.id));
      const projectAllocations = (orderRow.item.allocations || []).filter(
        (allocation) => allocation.type === "project" && allocation.projectItemId,
      );
      const projectAllocation = projectAllocations.length === 1 ? projectAllocations[0] : null;
      const eligible = documentItem.match_status === "matched"
        && documentItem.manual_review_required === false
        && matchConfidence >= 80
        && !alreadyProcessed
        && remainingQuantity > 0
        && suggestedQuantity > 0
        && projectAllocations.length <= 1;
      if (eligible) {
        suggestionRemainingByOrderItem.set(
          orderRow.orderItemId,
          Math.max(remainingQuantity - suggestedQuantity, 0),
        );
      }

      return {
        id: documentItem.id,
        documentItemId: documentItem.id,
        orderItemId: orderRow.orderItemId,
        fallbackOrderItemId: orderRow.fallbackOrderItemId,
        productCode: orderRow.item.productCode || documentItem.product_code || "",
        productName: orderRow.item.productName || documentItem.product_name || "",
        unit: orderRow.item.unit || documentItem.unit || "adet",
        orderedQuantity,
        deliveredQuantity,
        documentQuantity,
        remainingQuantity,
        suggestedQuantity,
        matchConfidence,
        manualReviewRequired: documentItem.manual_review_required,
        alreadyProcessed,
        eligible,
        status,
        projectAllocation,
        allocationReviewRequired: projectAllocations.length > 1,
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
      rowId: item.rowId || item.id || "",
      productId: item.productId || item.product_id || null,
      productCode: item.productCode || "",
      productName: item.productName || item.product || "",
      unit: item.unit || "adet",
      quantity,
      deliveredQuantity,
      unitPrice,
      discount: Number(item.discount || 0),
      netUnitPrice: Number(item.netUnitPrice || unitPrice),
      total,
      currency: item.currency || "TRY",
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

function applyReceiptQuantitiesToItems(items, receipts) {
  const receiptQuantityByItemId = new Map();

  (receipts || []).forEach((receipt) => {
    const match = matchOrderItem(receipt, items);
    if (!match.matched || match.manualReviewRequired) return;
    const current = receiptQuantityByItemId.get(match.orderItemId) || 0;
    receiptQuantityByItemId.set(
      match.orderItemId,
      current + Number(receipt.accepted_quantity ?? receipt.received_quantity ?? 0),
    );
  });

  return (items || []).map((item, index) => {
    const itemId = getOrderItemMatchId(item, index);
    const deliveredQuantity = Math.max(
      Number(item.deliveredQuantity || 0),
      Number(receiptQuantityByItemId.get(itemId) || 0),
    );
    const quantity = Number(item.quantity || 0);

    return {
      ...item,
      deliveredQuantity,
      status:
        deliveredQuantity >= quantity && quantity > 0
          ? "Tam Teslim"
          : deliveredQuantity > 0
            ? "Kısmi Teslim"
            : item.status,
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
  const [receiptInputs, setReceiptInputs] = useState({});
  const receiptSavingRef = useRef(new Set());
  const [receipts, setReceipts] = useState([]);
  const [automaticReceiptApplying, setAutomaticReceiptApplying] = useState(false);
  const [automaticReceiptResult, setAutomaticReceiptResult] = useState(null);
  const [receiptProductOverrides, setReceiptProductOverrides] = useState({});
  const [receiptProductSuggestion, setReceiptProductSuggestion] = useState(null);
  const [payments, setPayments] = useState([]);
  const [orderAuditRows, setOrderAuditRows] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [documentItems, setDocumentItems] = useState([]);
  const [documentItemMatchSummary, setDocumentItemMatchSummary] = useState(null);
  const [documentUploadOpen, setDocumentUploadOpen] = useState(false);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [documentPreview, setDocumentPreview] = useState(null);
  const [documentAccessLoadingId, setDocumentAccessLoadingId] = useState(null);
  const [documentAccessError, setDocumentAccessError] = useState("");
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
    document_type: "fatura",
    document_number: "",
    document_date: "",
    supplier_name: "",
    supplier_tax_number: "",
    document_uuid: "",
    document_profile: "",
    invoice_total: "",
    tax_exclusive_amount: "",
    tax_amount: "",
    payable_amount: "",
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
    setDocumentPreview(null);
    setDocumentAccessError("");

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

  async function previewDocument(document) {
    setDocumentAccessError("");
    setDocumentAccessLoadingId(document.id);

    try {
      const signedUrl = await createDocumentSignedUrl(supabase, document);
      setDocumentPreview({
        document,
        url: signedUrl,
        fileName: document.original_file_name || "Belge",
        isPdf: isPdfDocument(document),
      });
    } catch (error) {
      console.error(error);
      setDocumentAccessError(error.message || "Belge önizleme bağlantısı oluşturulamadı.");
    } finally {
      setDocumentAccessLoadingId(null);
    }
  }

  async function openDocumentInNewTab(document) {
    setDocumentAccessError("");
    setDocumentAccessLoadingId(document.id);

    try {
      const signedUrl = await createDocumentSignedUrl(supabase, document);
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error(error);
      setDocumentAccessError(error.message || "Belge yeni sekmede açılamadı.");
    } finally {
      setDocumentAccessLoadingId(null);
    }
  }

  async function downloadDocument(document) {
    setDocumentAccessError("");
    setDocumentAccessLoadingId(document.id);

    try {
      await downloadDocumentFile(supabase, document);
    } catch (error) {
      console.error(error);
      setDocumentAccessError(error.message || "Belge indirilemedi.");
    } finally {
      setDocumentAccessLoadingId(null);
    }
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
    setReceiptInputs({});
    setDocuments([]);
    setOrderAuditRows([]);

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

    const { data: auditRows, error: auditError } = await supabase
      .from("order_audit_log")
      .select("*")
      .eq("order_id", data.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (auditError) {
      console.error("Sipariş denetim kaydı yüklenemedi:", auditError);
    }
    setOrderAuditRows(auditRows || []);

    await loadOrderDocuments(data.id, user.id, data.items || []);

    const { data: settingsRows } = await supabase
      .from("company_settings")
      .select("*")
      .eq("user_id", user.id)
      .limit(1);
    if (settingsRows?.[0]) setCompanySettings(settingsRows[0]);

    const allocationProjectIds = Array.from(new Set(
      (Array.isArray(data.items) ? data.items : [])
        .flatMap((item) => Array.isArray(item.allocations) ? item.allocations : [])
        .map((allocation) => allocation.projectId)
        .filter(Boolean),
    ));
    const linkedProjectIds = Array.from(new Set([data.project_id, ...allocationProjectIds].filter(Boolean)));

    if (linkedProjectIds.length > 0) {
      const [{ data: projectRows }, { data: projectItemRows }] = await Promise.all([
        supabase
          .from("projects")
          .select("*")
          .eq("user_id", user.id)
          .in("id", linkedProjectIds),
        supabase
          .from("project_items")
          .select("*")
          .eq("user_id", user.id)
          .in("project_id", linkedProjectIds)
          .order("created_at", { ascending: true }),
      ]);

      const projectMap = new Map((projectRows || []).map((row) => [row.id, row]));
      setProject(linkedProjectIds.length === 1 ? projectMap.get(linkedProjectIds[0]) || null : null);
      setProjectItems((projectItemRows || []).map((row) => ({
        ...row,
        project_code: projectMap.get(row.project_id)?.project_code || "",
        project_name: projectMap.get(row.project_id)?.project_name || "",
      })));
    } else {
      setProject(null);
      setProjectItems([]);
    }
  }

  const rawItems = useMemo(() => normalizeItems(order?.items || []), [order]);
  const items = useMemo(
    () => applyReceiptQuantitiesToItems(rawItems, receipts),
    [rawItems, receipts],
  );
  const historyRows = useMemo(
    () => {
      if (!order) return [];
      const databaseAuditRows = orderAuditRows.map((row) => {
        const actionLabels = {
          insert: "Sipariş kaydı veritabanında oluşturuldu.",
          update: "Sipariş kaydı veritabanında güncellendi.",
          delete: "Sipariş kaydı silindi.",
        };
        return {
          type: `database-${row.action}`,
          title: actionLabels[row.action] || "Sipariş kaydı değiştirildi.",
          actor: row.actor_email || "Sistem",
          date: row.created_at,
        };
      });
      return [...normalizeHistory(order), ...databaseAuditRows]
        .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    },
    [order, orderAuditRows],
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

  async function resolveReceiptProduct(userId, item, projectItem = null) {
    const productName = item.productName || item.productCode || "Ürün";
    const productCode = String(item.productCode || "").trim().toUpperCase();
    const receiptProductKey = String(item.id || item.orderItemId || productCode || productName);

    const { data: tenantProducts, error } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", userId)
      .is("archived_at", null)
      .limit(5000);
    if (error) {
      setMessage("Ürün kartları kontrol edilemedi; teslim alma güvenli şekilde durduruldu.");
      return null;
    }

    const overriddenProduct = receiptProductOverrides[receiptProductKey]
      ? (tenantProducts || []).find((product) => product.id === receiptProductOverrides[receiptProductKey])
      : null;
    if (overriddenProduct) return overriddenProduct;

    const result = matchProduct(tenantProducts || [], {
      product_id: projectItem?.product_id,
      product_code: productCode,
      product_name: productName,
      unit: item.unit || "adet",
      brand: item.brand || "",
    });
    if (result.type === "exact") return result.match?.product || null;

    setReceiptProductSuggestion({ key: receiptProductKey, item, result });
    setMessage(
      result.type === "new"
        ? `${productName} için ürün kartı bulunamadı. Teslim almadan önce stok kartını oluşturun.`
        : `${productName} için benzer veya çakışan ürün kartı bulundu. Mevcut kartı seçip işlemi tekrar deneyin.`,
    );
    return null;
  }

  async function createReceiptProductCard() {
    if (!receiptProductSuggestion?.item) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const item = receiptProductSuggestion.item;
    const productName = String(item.productName || item.productCode || "").trim();
    const productCode = String(item.productCode || "").trim().toUpperCase()
      || `STK-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Date.now()}`;
    const { data: product, error } = await supabase
      .from("products")
      .insert({
        user_id: user.id,
        product_code: productCode,
        normalized_product_code: productCode,
        product_name: productName,
        brand: item.brand || "",
        unit: item.unit || "adet",
        current_stock: 0,
        reserved_stock: 0,
        min_stock: 0,
        critical_stock: 0,
        source: "Sipariş teslim alma kullanıcı onayı",
        notes: `${order.order_no || "Sipariş"} teslim alma öncesi oluşturuldu.`,
      })
      .select("*")
      .single();

    if (error || !product) {
      setMessage(error?.message || "Yeni ürün kartı oluşturulamadı.");
      return;
    }

    setReceiptProductOverrides((current) => ({ ...current, [receiptProductSuggestion.key]: product.id }));
    setReceiptProductSuggestion(null);
    setMessage("Yeni ürün kartı oluşturuldu. Teslim alma işlemini tekrar çalıştırın.");
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

  function getProjectItemRequiredQuantity(projectItem, fallbackQuantity) {
    return Number(
      projectItem?.estimated_quantity
        ?? projectItem?.quantity
        ?? projectItem?.required_quantity
        ?? fallbackQuantity
        ?? 0,
    );
  }

  async function saveReceipt(index) {
    if (receiptSavingRef.current.has(index)) return;
    receiptSavingRef.current.add(index);
    try {
      await saveReceiptUnlocked(index);
    } finally {
      receiptSavingRef.current.delete(index);
    }
  }

  async function saveReceiptUnlocked(index) {
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
      selectedProjectItem?.parent_item_id || input.parentItemId || null;

    if (!Number.isFinite(receivedQuantity) || !Number.isFinite(defectiveQuantity)) {
      setMessage("Teslim miktarı geçerli bir sayı olmalıdır.");
      return;
    }

    if (receivedQuantity <= 0 || acceptedQuantity <= 0) {
      setMessage("Teslim alınan miktar 0'dan büyük olmalıdır.");
      return;
    }

    if (receivedQuantity > remainingQuantity) {
      setMessage(`Teslim miktarı kalan miktarı aşamaz. Kalan: ${remainingQuantity} ${item.unit || "adet"}.`);
      return;
    }

    const resolvedProduct = await resolveReceiptProduct(user.id, item, selectedProjectItem);
    if (!resolvedProduct?.id) return;

    const receiptPayload = {
      user_id: user.id,
      order_id: order.id,
      project_id: selectedProjectItem?.project_id || order.project_id || null,
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

    const nextItems = items.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      const deliveredQuantity = Math.min(
        Number(row.quantity || 0),
        Number(row.deliveredQuantity || 0) + acceptedQuantity,
      );
      return {
        ...row,
        deliveredQuantity,
        status:
          deliveredQuantity >= Number(row.quantity || 0) && Number(row.quantity || 0) > 0
            ? "Tam Teslim"
            : deliveredQuantity > 0
              ? "Kısmi Teslim"
              : row.status,
      };
    });
    const nextItemDeliveredQuantity = Number(nextItems[index]?.deliveredQuantity || 0);
    const nextItemReceiptStatus = calculateReceiptStatus(
      nextItemDeliveredQuantity,
      orderedQuantity,
      defectiveQuantity,
    );
    const nextProjectReceivedQuantity = selectedProjectItem?.id
      ? Number(selectedProjectItem.received_quantity || 0) + acceptedQuantity
      : 0;
    const nextProjectDefectiveQuantity = selectedProjectItem?.id
      ? Number(selectedProjectItem.defective_quantity || 0) + defectiveQuantity
      : defectiveQuantity;
    const nextProjectReceiptStatus = selectedProjectItem?.id
      ? calculateReceiptStatus(
        nextProjectReceivedQuantity,
        getProjectItemRequiredQuantity(selectedProjectItem, orderedQuantity),
        nextProjectDefectiveQuantity,
      )
      : receiptStatus;
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

    const { error: receiptError } = await supabase.rpc("record_order_stock_receipt", {
      p_order_id: order.id,
      p_product_id: resolvedProduct?.id || null,
      p_project_id: selectedProjectItem?.project_id || order.project_id || null,
      p_project_item_id: selectedProjectItem?.id || null,
      p_parent_item_id: parentItemId,
      p_document_item_id: null,
      p_order_no: receiptPayload.order_no,
      p_supplier_name: receiptPayload.supplier_name,
      // Some demo databases still have legacy text partner ids while the receipt RPC
      // expects uuid. Keep the read-only partner label, but avoid a text=uuid failure.
      p_partner_id: null,
      p_partner_name: receiptPayload.partner_name,
      p_partner_type: receiptPayload.partner_type,
      p_product_code: resolvedProduct?.product_code || item.productCode || "",
      p_product_name: resolvedProduct?.product_name || item.productName,
      p_unit: item.unit || resolvedProduct?.unit || "adet",
      p_ordered_quantity: orderedQuantity,
      p_received_quantity: receivedQuantity,
      p_accepted_quantity: acceptedQuantity,
      p_missing_quantity: missingQuantity,
      p_excess_quantity: excessQuantity,
      p_defective_quantity: defectiveQuantity,
      p_receipt_status: receiptStatus,
      p_received_by: receiptPayload.received_by,
      p_receipt_date: receiptPayload.receipt_date,
      p_note: receiptPayload.note,
      p_unit_price: Number(item.unitPrice || 0),
      p_currency: order.currency || "TRY",
      p_report_id: order.report_id || null,
      p_order_items: nextItems,
      p_order_status: nextStatus,
      p_delivery_date: nextStatus === "Tam Teslim" ? getToday() : order.delivery_date,
      p_status_history: nextHistory,
      p_order_receipt_status: nextStatus === "Tam Teslim" ? "Depoda" : nextItemReceiptStatus,
      p_received_total: nextDeliveredQuantity,
      p_defective_total: Number(order.defective_total || 0) + defectiveQuantity,
    });

    if (receiptError) {
      console.error(receiptError);
      const legacyTypeMismatch = String(receiptError.message || "").includes("operator does not exist: text = uuid");
      if (legacyTypeMismatch) {
        const { data: currentProduct, error: productReadError } = await supabase
          .from("products")
          .select("current_stock")
          .eq("id", resolvedProduct.id)
          .eq("user_id", user.id)
          .single();

        if (productReadError) {
          console.error(productReadError);
          setMessage("Teslim alma işlemi tamamlanamadı; ürün stoku okunamadı.");
          return;
        }

        const { data: insertedReceipt, error: fallbackReceiptError } = await supabase
          .from("order_receipts")
          .insert({
            ...receiptPayload,
            partner_id: null,
          })
          .select("id")
          .single();

        if (fallbackReceiptError) {
          console.error(fallbackReceiptError);
          setMessage(fallbackReceiptError.message || "Teslim alma kaydı oluşturulamadı.");
          return;
        }

        const fallbackUpdates = [];
        if (acceptedQuantity > 0) {
          fallbackUpdates.push(
            supabase
              .from("products")
              .update({
                current_stock: Number(currentProduct?.current_stock || 0) + acceptedQuantity,
                last_supplier: receiptPayload.partner_name || receiptPayload.supplier_name || "",
                last_unit_price: Number(item.unitPrice || 0),
                last_currency: order.currency || "TRY",
                last_purchase_date: receiptPayload.receipt_date,
                last_movement_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", resolvedProduct.id)
              .eq("user_id", user.id),
            supabase
              .from("stock_movements")
              .insert({
                user_id: user.id,
                product_id: resolvedProduct.id,
                product_code: resolvedProduct?.product_code || item.productCode || "",
                product_name: resolvedProduct?.product_name || item.productName,
                movement_type: "in",
                quantity: acceptedQuantity,
                unit: item.unit || resolvedProduct?.unit || "adet",
                supplier_name: receiptPayload.supplier_name,
                partner_id: null,
                partner_name: receiptPayload.partner_name,
                partner_type: receiptPayload.partner_type,
                order_id: order.id,
                report_id: order.report_id || null,
                project_id: selectedProjectItem?.project_id || order.project_id || null,
                project_item_id: selectedProjectItem?.id || null,
                parent_item_id: parentItemId,
                receipt_id: insertedReceipt?.id || null,
                unit_price: Number(item.unitPrice || 0),
                currency: order.currency || "TRY",
                movement_date: receiptPayload.receipt_date,
                source: "Depo teslim alma",
                notes: [receiptPayload.order_no, receiptStatus].filter(Boolean).join(" - "),
              }),
          );
        }

        if (selectedProjectItem?.id) {
          fallbackUpdates.push(
            supabase
              .from("project_items")
              .update({
                received_quantity: nextProjectReceivedQuantity,
                defective_quantity: nextProjectDefectiveQuantity,
                status: nextProjectReceiptStatus,
                updated_at: new Date().toISOString(),
              })
              .eq("id", selectedProjectItem.id)
              .eq("user_id", user.id),
          );
        }

        fallbackUpdates.push(
          supabase
            .from("orders")
            .update({
              items: nextItems,
              status: nextStatus,
              delivery_date: nextStatus === "Tam Teslim" ? getToday() : order.delivery_date,
              status_history: nextHistory,
              receipt_status: nextStatus === "Tam Teslim" ? "Depoda" : nextItemReceiptStatus,
              received_total: nextDeliveredQuantity,
              defective_total: Number(order.defective_total || 0) + defectiveQuantity,
            })
            .eq("id", order.id)
            .eq("user_id", user.id),
        );

        const fallbackResults = await Promise.all(fallbackUpdates);
        const fallbackError = fallbackResults.find((result) => result.error)?.error;
        if (fallbackError) {
          console.error(fallbackError);
          setMessage(fallbackError.message || "Teslim alma kaydı oluştu ancak bağlı güncellemeler tamamlanamadı.");
          return;
        }

        setReceiptInputs((prev) => ({ ...prev, [index]: {} }));
        setMessage("Depo teslim alma kaydedildi ve stok girişine işlendi.");
        await loadOrder();
        return;
      }
      setMessage(receiptError.message || "Teslim alma işlemi atomik olarak tamamlanamadı; hiçbir kayıt değiştirilmedi.");
      return;
    }

    setReceiptInputs((prev) => ({ ...prev, [index]: {} }));
    setMessage("Depo teslim alma kaydedildi ve stok girişine işlendi.");
    await loadOrder();
  }

  async function applyAutomaticReceiptSuggestions() {
    if (!order || automaticReceiptApplying) return;

    const initialSuggestions = calculateAutomaticReceiptSuggestions(
      items,
      order.items || [],
      receipts,
      documentItems,
      order.id,
      documents,
    );
    const initialCandidates = initialSuggestions.filter((suggestion) => suggestion.eligible);

    if (initialCandidates.length === 0) {
      setMessage("Otomatik teslim almaya uygun, güvenilir bir belge kalemi bulunmuyor.");
      return;
    }

    const initialTotal = initialCandidates.reduce(
      (sum, suggestion) => sum + Number(suggestion.suggestedQuantity || 0),
      0,
    );
    const approved = window.confirm(
      `${initialCandidates.length} belge kalemi için toplam ${initialTotal} birim teslim alma kaydı oluşturulsun mu?`,
    );
    if (!approved) return;

    setAutomaticReceiptApplying(true);
    setAutomaticReceiptResult(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setAutomaticReceiptApplying(false);
      router.push("/login");
      return;
    }

    const { data: latestReceiptRows, error: latestReceiptError } = await supabase
      .from("order_receipts")
      .select("*")
      .eq("order_id", order.id)
      .eq("user_id", user.id);

    if (latestReceiptError) {
      setAutomaticReceiptApplying(false);
      setMessage("Mevcut teslim kayıtları doğrulanamadığı için otomatik teslim alma durduruldu.");
      return;
    }

    const latestSuggestions = calculateAutomaticReceiptSuggestions(
      items,
      order.items || [],
      latestReceiptRows || [],
      documentItems,
      order.id,
      documents,
    );
    const candidates = latestSuggestions.filter((suggestion) => suggestion.eligible);
    const resolvedProducts = new Map();

    for (const candidate of candidates) {
      const product = await resolveReceiptProduct(user.id, {
        id: `document-${candidate.documentItemId}`,
        productCode: candidate.productCode || "",
        productName: candidate.productName || "",
        unit: candidate.unit || "adet",
        brand: candidate.brand || "",
      });
      if (!product?.id) {
        setAutomaticReceiptApplying(false);
        setMessage("Otomatik teslim alma durduruldu: tüm belge kalemleri için ürün kartı kesinleşmelidir.");
        return;
      }
      resolvedProducts.set(candidate.documentItemId, product);
    }

    const remainingByOrderItem = new Map();
    const deliveredByOrderItem = new Map();
    let processedCount = 0;
    let processedQuantity = 0;
    let skippedCount = Math.max(documentItems.length - candidates.length, 0);
    let errorCount = 0;

    for (const candidate of candidates) {
      const orderItemKey = candidate.orderItemId || candidate.fallbackOrderItemId;
      const availableQuantity = remainingByOrderItem.has(orderItemKey)
        ? remainingByOrderItem.get(orderItemKey)
        : Math.max(Number(candidate.remainingQuantity || 0), 0);
      const acceptedQuantity = Math.min(
        Number(candidate.suggestedQuantity || 0),
        availableQuantity,
      );

      if (
        candidate.matchConfidence < 80
        || candidate.manualReviewRequired
        || candidate.alreadyProcessed
        || acceptedQuantity <= 0
      ) {
        skippedCount += 1;
        continue;
      }

      const remainingAfterReceipt = Math.max(availableQuantity - acceptedQuantity, 0);
      const receiptStatus = remainingAfterReceipt <= 0 ? "Depoda" : "Eksik geldi";
      const referenceNote = `[document_item_id:${candidate.documentItemId}] Otomatik teslim alma; kullanıcı onayı ile oluşturuldu.`;
      const resolvedProduct = resolvedProducts.get(candidate.documentItemId);
      const { error: receiptError } = await supabase.rpc("record_order_stock_receipt", {
        p_order_id: order.id,
        p_product_id: resolvedProduct.id,
        p_project_id: candidate.projectAllocation?.projectId || order.project_id || null,
        p_project_item_id: candidate.projectAllocation?.projectItemId || null,
        p_parent_item_id: candidate.projectAllocation?.parentItemId || null,
        p_document_item_id: candidate.documentItemId,
        p_order_no: order.order_no || "",
        p_supplier_name: order.supplier_name || "",
        p_partner_id: isUuid(order.partner_id) ? order.partner_id : null,
        p_partner_name: order.partner_name || order.supplier_name || "",
        p_partner_type: order.partner_type || "Tedarikçi",
        p_product_code: resolvedProduct.product_code || candidate.productCode || "",
        p_product_name: resolvedProduct.product_name || candidate.productName || "",
        p_unit: candidate.unit || resolvedProduct.unit || "adet",
        p_ordered_quantity: Number(candidate.orderedQuantity || 0),
        p_received_quantity: acceptedQuantity,
        p_accepted_quantity: acceptedQuantity,
        p_missing_quantity: remainingAfterReceipt,
        p_excess_quantity: 0,
        p_defective_quantity: 0,
        p_receipt_status: receiptStatus,
        p_received_by: user.email || "Kullanıcı",
        p_receipt_date: getToday(),
        p_note: referenceNote,
        p_unit_price: Number(candidate.unitPrice || 0),
        p_currency: order.currency || "TRY",
        p_report_id: order.report_id || null,
      });

      if (receiptError?.code === "23505") {
        skippedCount += 1;
        continue;
      }

      if (receiptError) {
        console.error("Otomatik teslim alma kaydedilemedi:", receiptError);
        errorCount += 1;
        continue;
      }

      remainingByOrderItem.set(orderItemKey, remainingAfterReceipt);
      deliveredByOrderItem.set(
        orderItemKey,
        Number(candidate.orderedQuantity || 0) - remainingAfterReceipt,
      );
      processedCount += 1;
      processedQuantity += acceptedQuantity;
    }

    if (processedCount > 0) {
      const nextItems = (order.items || []).map((item, index) => {
        const rawKey = getOrderItemMatchId(item, index);
        const normalizedKey = getOrderItemMatchId(items[index], index);
        const matchingKey = deliveredByOrderItem.has(rawKey)
          ? rawKey
          : deliveredByOrderItem.has(normalizedKey)
            ? normalizedKey
            : null;
        if (!matchingKey) return item;
        const deliveredQuantity = Math.min(
          Number(item.quantity || 0),
          Number(deliveredByOrderItem.get(matchingKey) || 0),
        );
        const orderedQuantity = Number(item.quantity || 0);
        return {
          ...item,
          deliveredQuantity,
          status: deliveredQuantity >= orderedQuantity && orderedQuantity > 0
            ? "Tam Teslim"
            : deliveredQuantity > 0
              ? "Kısmi Teslim"
              : item.status,
        };
      });
      const totalOrdered = nextItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const totalDelivered = nextItems.reduce(
        (sum, item) => sum + Number(item.deliveredQuantity || 0),
        0,
      );
      const nextStatus = totalOrdered > 0 && totalDelivered >= totalOrdered
        ? "Tam Teslim"
        : totalDelivered > 0
          ? "Kısmi Teslim"
          : order.status;
      const nextHistory = buildStatusHistory(order, {
        type: "automatic-document-receipt",
        title: `${processedCount} belge kaleminden toplam ${processedQuantity} birim teslim alındı.`,
        actor: user.email || "Kullanıcı",
        status: nextStatus,
      });
      const { error: orderUpdateError } = await updateOrder(
        {
          items: nextItems,
          status: nextStatus,
          receipt_status: nextStatus,
          delivery_date: nextStatus === "Tam Teslim" ? getToday() : order.delivery_date,
          received_total: totalDelivered,
          status_history: nextHistory,
        },
        {
          items: nextItems,
          status: nextStatus,
          receipt_status: nextStatus,
          delivery_date: nextStatus === "Tam Teslim" ? getToday() : order.delivery_date,
        },
      );
      if (orderUpdateError) {
        console.error("Otomatik teslim sonrası sipariş özeti güncellenemedi:", orderUpdateError);
        errorCount += 1;
      }
    }

    setAutomaticReceiptResult({
      processedCount,
      processedQuantity,
      skippedCount,
      errorCount,
    });
    setAutomaticReceiptApplying(false);
    setMessage(
      processedCount > 0
        ? `${processedCount} otomatik teslim kaydı oluşturuldu.`
        : "Uygulanabilir teslim kaydı oluşturulamadı.",
    );
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

    let contentSha256 = "";
    try {
      contentSha256 = await fileSha256(file);
    } catch (hashError) {
      console.error(hashError);
      setMessage("Belge güvenlik özeti hesaplanamadı; yükleme durduruldu.");
      setDocumentUploading(false);
      return;
    }

    const { data: existingDocument, error: existingDocumentError } = await supabase
      .from("documents")
      .select("*")
      .eq("user_id", user.id)
      .eq("content_sha256", contentSha256)
      .maybeSingle();
    if (existingDocumentError) {
      setMessage("Belge mükerrer kontrolü yapılamadı. 014 document hash migrationı uygulanmalıdır.");
      setDocumentUploading(false);
      return;
    }
    if (existingDocument) {
      const { data: existingLink } = await supabase
        .from("document_links")
        .select("id")
        .eq("user_id", user.id)
        .eq("document_id", existingDocument.id)
        .eq("order_id", order.id)
        .maybeSingle();
      if (existingLink) {
        setMessage("Bu belge bu siparişe daha önce yüklenmiş. Mükerrer belge oluşturulmadı.");
        setDocumentUploading(false);
        return;
      }
      const { error: reuseLinkError } = await supabase.from("document_links").insert({
        document_id: existingDocument.id,
        order_id: order.id,
        user_id: user.id,
      });
      if (reuseLinkError) {
        setMessage("Belge daha önce yüklenmiş ancak bu siparişe güvenli biçimde bağlanamadı.");
        setDocumentUploading(false);
        return;
      }
      setMessage("Mevcut belge yeniden yüklenmeden bu siparişe bağlandı.");
      setDocumentUploading(false);
      await loadOrderDocuments(order.id, user.id);
      return;
    }

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
        content_sha256: contentSha256,
        document_number: documentForm.document_number.trim() || null,
        document_date: documentForm.document_date || null,
        supplier_name: documentForm.supplier_name.trim() || null,
        supplier_tax_number: documentForm.supplier_tax_number.replace(/\D/g, "") || null,
        document_uuid: documentForm.document_uuid.trim() || null,
        document_profile: documentForm.document_profile || null,
        invoice_total: documentForm.invoice_total === ""
          ? null
          : Number(documentForm.invoice_total),
        tax_exclusive_amount: documentForm.tax_exclusive_amount === "" ? null : Number(documentForm.tax_exclusive_amount),
        tax_amount: documentForm.tax_amount === "" ? null : Number(documentForm.tax_amount),
        payable_amount: documentForm.payable_amount === "" ? null : Number(documentForm.payable_amount),
        currency: documentForm.currency || "TRY",
      })
      .select("*")
      .single();

    if (documentError) {
      console.error(documentError);
      await supabase.storage.from("order-documents").remove([storagePath]);
      setMessage(
        documentError.code === "23505"
          ? "Bu belge eşzamanlı başka bir işlemde yüklenmiş. Mükerrer belge engellendi; sayfayı yenileyip tekrar bağlayın."
          : "Belge bilgileri kaydedilemedi.",
      );
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
      document_type: "fatura",
      document_number: "",
      document_date: "",
      supplier_name: "",
      supplier_tax_number: "",
      document_uuid: "",
      document_profile: "",
      invoice_total: "",
      tax_exclusive_amount: "",
      tax_amount: "",
      payable_amount: "",
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

  async function exportOrderExcel() {
    if (!order) return;
    const { companyName } = await fetchCompanyBranding(supabase);
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [companyName], [CORVIAN_PRODUCT_NAME],
      [`Sipariş No: ${order.order_no || "-"}`, `Tedarikçi: ${order.partner_name || order.supplier_name || "-"}`],
      [`Sipariş Tarihi: ${order.order_date || "-"}`, `Para Birimi: ${order.currency || "TRY"}`], [],
    ]);
    XLSX.utils.sheet_add_json(sheet, items.map((item, index) => ({
      "Sıra": index + 1, "Ürün Kodu": item.productCode || "-", "Ürün Açıklaması": item.productName,
      "Birim": item.unit, "Miktar": item.quantity, "Birim Fiyat": item.unitPrice,
      "İskonto (%)": item.discount || 0, "Net Birim Fiyat": item.netUnitPrice || item.unitPrice,
      "Toplam": item.total, "Para Birimi": item.currency || order.currency || "TRY",
      "Proje Dağılımı": (item.allocations || []).map((allocation) => `${allocation.projectCode || allocation.projectId || "Stok"}: ${allocation.quantity}`).join(" | "),
    })), { origin: "A6" });
    XLSX.utils.book_append_sheet(workbook, sheet, "Sipariş");
    XLSX.writeFile(workbook, `${String(order.order_no || "siparis").replace(/[^a-zA-Z0-9_-]/g, "-")}.xlsx`);
  }

  const pdfFontName = "DejaVuSans";

  function bufferToBinaryString(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return binary;
  }

  async function loadTurkishPdfFont(doc) {
    const response = await fetch("/fonts/DejaVuSans.ttf");

    if (!response.ok) {
      return "helvetica";
    }

    const fontBinary = bufferToBinaryString(await response.arrayBuffer());
    doc.addFileToVFS("DejaVuSans.ttf", fontBinary);
    doc.addFont("DejaVuSans.ttf", pdfFontName, "normal");
    doc.addFont("DejaVuSans.ttf", pdfFontName, "bold");
    doc.setFont(pdfFontName, "normal");
    return pdfFontName;
  }

  async function exportOrderPdf() {
    if (!order) return;
    const { companyName } = await fetchCompanyBranding(supabase);
    const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pdfFont = await loadTurkishPdfFont(doc);
    doc.setFontSize(16); doc.text(companyName, 40, 34);
    doc.setFontSize(9); doc.setTextColor(90); doc.text(`${CORVIAN_PRODUCT_NAME} · Sipariş Formu`, 40, 49);
    doc.setTextColor(20); doc.text(`Sipariş No: ${order.order_no || "-"}`, 40, 68);
    doc.text(`Tedarikçi: ${order.partner_name || order.supplier_name || "-"}`, 220, 68);
    doc.text(`Tarih: ${order.order_date || "-"}`, 500, 68);
    doc.text(`Para Birimi: ${order.currency || "TRY"}`, 650, 68);
    autoTable(doc, {
      startY: 82,
      head: [["Kod", "Ürün", "Birim", "Miktar", "Birim fiyat", "İskonto", "Net fiyat", "Toplam", "Proje dağılımı"]],
      body: items.map((item) => [item.productCode || "-", item.productName, item.unit, item.quantity,
        formatMoney(item.unitPrice, item.currency || order.currency), `%${item.discount || 0}`,
        formatMoney(item.netUnitPrice || item.unitPrice, item.currency || order.currency), formatMoney(item.total, item.currency || order.currency),
        (item.allocations || []).map((allocation) => `${allocation.projectCode || allocation.projectId || "Stok"}: ${allocation.quantity}`).join(" | ")]),
      styles: { font: pdfFont, fontSize: 7, cellPadding: 4 }, headStyles: { fillColor: [15, 23, 42], fontStyle: "bold" },
    });
    doc.setFontSize(11);
    doc.text(`Genel Toplam: ${formatMoney(order.total_amount, order.currency || "TRY")}`, 600, (doc.lastAutoTable?.finalY || 100) + 24);
    doc.save(`${String(order.order_no || "siparis").replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`);
  }

  function orderOutputFileName(suffix) {
    return `${String(order?.order_no || "siparis").replace(/[^a-zA-Z0-9_-]/g, "-")}-${suffix}.pdf`;
  }

  async function createOrderDocumentPdf({ title, subtitle, fileSuffix, documentNo, columns, rows, totalLabel, totalValue }) {
    if (!order) return;
    const { companyName, taxNo } = await fetchCompanyBranding(supabase);
    const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pdfFont = await loadTurkishPdfFont(doc);
    const supplierName = order.partner_name || order.supplier_name || "-";

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 842, 74, "F");
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, 8, 595, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont(pdfFont, "bold");
    doc.text(CORVIAN_PRODUCT_NAME, 40, 30);
    doc.setFontSize(9);
    doc.setFont(pdfFont, "normal");
    doc.text("Satın alma ve teslimat yönetimi", 40, 47);

    doc.setFontSize(18);
    doc.setFont(pdfFont, "bold");
    doc.text(title, 802, 30, { align: "right" });
    doc.setFontSize(9);
    doc.setFont(pdfFont, "normal");
    doc.text(subtitle, 802, 48, { align: "right" });

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(12);
    doc.setFont(pdfFont, "bold");
    doc.text(companyName, 40, 96);
    doc.setFont(pdfFont, "normal");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text(taxNo ? `Vergi No: ${taxNo}` : "Şirket bilgisi: Ayarlar sayfasından tamamlanabilir", 40, 111);

    const infoRows = [
      [`Belge No: ${documentNo || "-"}`, `Sipariş No: ${order.order_no || "-"}`],
      [`İş Ortağı: ${supplierName}`, `Sipariş Tarihi: ${order.order_date || "-"}`],
      [`Para Birimi: ${order.currency || "TRY"}`, `Oluşturma: ${new Date().toLocaleString("tr-TR")}`],
    ];

    autoTable(doc, {
      startY: 86,
      margin: { left: 360, right: 40 },
      body: infoRows,
      theme: "plain",
      styles: { font: pdfFont, fontSize: 8, cellPadding: 3, textColor: [51, 65, 85] },
      columnStyles: {
        0: { fontStyle: "bold" },
        1: { halign: "right" },
      },
    });

    autoTable(doc, {
      startY: 138,
      head: [columns],
      body: rows,
      margin: { left: 40, right: 40 },
      styles: {
        font: pdfFont,
        fontSize: 8,
        cellPadding: 5,
        lineColor: [226, 232, 240],
        lineWidth: 0.4,
        overflow: "linebreak",
        valign: "middle",
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      bodyStyles: { textColor: [30, 41, 59] },
    });

    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.setFont(pdfFont, "bold");
    doc.text(`${totalLabel}: ${totalValue}`, 802, (doc.lastAutoTable?.finalY || 138) + 24, { align: "right" });
    doc.setDrawColor(226, 232, 240);
    doc.line(40, 552, 802, 552);
    doc.setFontSize(8);
    doc.setFont(pdfFont, "normal");
    doc.setTextColor(100);
    doc.text(`${companyName} | ${CORVIAN_PRODUCT_NAME}`, 40, 570);
    doc.text("Bu çıktı Corvian ERP tarafından oluşturulmuştur.", 802, 570, { align: "right" });
    doc.save(orderOutputFileName(fileSuffix));
  }

  async function exportInvoicePdf() {
    await createOrderDocumentPdf({
      title: "Fatura PDF",
      subtitle: "Sipariş kalemleri ve tutar özeti",
      fileSuffix: "fatura",
      documentNo: `FAT-${order.order_no || order.id || ""}`,
      columns: ["Kod", "Ürün", "Birim", "Miktar", "Birim fiyat", "İskonto", "Net fiyat", "Toplam"],
      rows: items.map((item) => [
        item.productCode || "-",
        item.productName || "-",
        item.unit || "adet",
        item.quantity || 0,
        formatMoney(item.unitPrice, item.currency || order.currency),
        `%${item.discount || 0}`,
        formatMoney(item.netUnitPrice || item.unitPrice, item.currency || order.currency),
        formatMoney(item.total, item.currency || order.currency),
      ]),
      totalLabel: "Genel Toplam",
      totalValue: formatMoney(order.total_amount, order.currency || "TRY"),
    });
  }

  async function exportDeliveryNotePdf() {
    await createOrderDocumentPdf({
      title: "İrsaliye PDF",
      subtitle: "Teslim edilen ve kalan miktar özeti",
      fileSuffix: "irsaliye",
      documentNo: `IRS-${order.order_no || order.id || ""}`,
      columns: ["Kod", "Ürün", "Birim", "Sipariş", "Teslim", "Kalan", "Durum"],
      rows: items.map((item) => {
        const ordered = Number(item.quantity || 0);
        const delivered = Number(item.deliveredQuantity || 0);
        return [
          item.productCode || "-",
          item.productName || "-",
          item.unit || "adet",
          ordered,
          delivered,
          Math.max(ordered - delivered, 0),
          item.status || "-",
        ];
      }),
      totalLabel: "Teslim Durumu",
      totalValue: `${totals.deliveredQuantity} / ${totals.totalQuantity} (${totals.deliveryStatus})`,
    });
  }

  async function exportReceiptSlipPdf() {
    const receiptRows = receipts.length
      ? receipts.map((receipt) => [
          receipt.receipt_date || "-",
          receipt.product_code || "-",
          receipt.product_name || "-",
          receipt.unit || "adet",
          Number(receipt.accepted_quantity || receipt.received_quantity || 0),
          receipt.receipt_status || "-",
          receipt.received_by || "-",
        ])
      : items.map((item) => [
          "-",
          item.productCode || "-",
          item.productName || "-",
          item.unit || "adet",
          Number(item.deliveredQuantity || 0),
          Number(item.deliveredQuantity || 0) > 0 ? "Teslim kaydı özetinden" : "Teslim bekliyor",
          "-",
        ]);

    await createOrderDocumentPdf({
      title: "Teslim Fişi PDF",
      subtitle: "Depo teslim alma kayıtları",
      fileSuffix: "teslim-fisi",
      documentNo: `TES-${order.order_no || order.id || ""}`,
      columns: ["Tarih", "Kod", "Ürün", "Birim", "Teslim", "Durum", "Teslim Alan"],
      rows: receiptRows,
      totalLabel: "Toplam Teslim",
      totalValue: `${totals.deliveredQuantity} ${items[0]?.unit || "adet"}`,
    });
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
            {order.report_id && <p className="mt-2 inline-flex rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">🔒 Mukayese kaynaklı ticari alanlar kilitli · teslimat, belge ve ödeme işlemleri açıktır</p>}
          </div>

        </div>

        {message && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-900">
            {message}
          </div>
        )}

        {receiptProductSuggestion && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-black text-amber-900">Ürün kartı eşleşme kontrolü</div>
            <div className="mt-1 text-xs font-semibold text-amber-800">
              {receiptProductSuggestion.item.productName || receiptProductSuggestion.item.productCode || "Sipariş kalemi"}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(receiptProductSuggestion.result.suggestions || []).map((suggestion) => (
                <button
                  key={suggestion.product.id}
                  type="button"
                  onClick={() => {
                    setReceiptProductOverrides((current) => ({ ...current, [receiptProductSuggestion.key]: suggestion.product.id }));
                    setReceiptProductSuggestion(null);
                    setMessage("Mevcut ürün kartı seçildi. Teslim alma işlemini tekrar çalıştırın.");
                  }}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-900"
                >
                  %{Math.round((suggestion.score || 0) * 100)} · {suggestion.product.product_code || "Kodsuz"} · {suggestion.product.product_name} — Mevcut kartı kullan
                </button>
              ))}
              <button
                type="button"
                onClick={createReceiptProductCard}
                className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-black text-white"
              >
                Yeni ürün kartı oluştur
              </button>
            </div>
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
                onExportOrderPdf={exportOrderPdf}
                onExportExcel={exportOrderExcel}
                onReceive={() => setActiveTab("receiving")}
              />
            )}
            {activeTab === "connections" && <ConnectionsPanel items={items} order={order} />}
            {activeTab === "delivery" && (
              <DeliveryHistoryPanel
                items={items}
                receipts={receipts}
                totals={totals}
              />
            )}
            {activeTab === "receiving" && (
              <div className="space-y-6">
                <AutomaticReceiptSuggestionsPanel
                  order={order}
                  items={items}
                  receipts={receipts}
                  documentItems={documentItems}
                  documents={documents}
                  applying={automaticReceiptApplying}
                  result={automaticReceiptResult}
                  onApply={applyAutomaticReceiptSuggestions}
                />
                <ReceivingPanel
                  items={items}
                  order={order}
                  project={project}
                  projectItems={projectItems}
                  inputs={receiptInputs}
                  disabled={order.status === "İptal"}
                  onInputChange={updateReceiptInput}
                  onSave={saveReceipt}
                />
              </div>
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
              <div className="space-y-6">
                <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <button type="button" onClick={exportInvoicePdf} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white">Fatura PDF</button>
                  <button type="button" onClick={exportDeliveryNotePdf} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">İrsaliye PDF</button>
                  <button type="button" onClick={exportReceiptSlipPdf} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white">Teslim Fişi PDF</button>
                </div>
                <DeliveryInvoiceConsistencyPanel
                  order={order}
                  items={items}
                  receipts={receipts}
                  documents={documents}
                  documentItems={documentItems}
                />
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
                  preview={documentPreview}
                  accessLoadingId={documentAccessLoadingId}
                  accessError={documentAccessError}
                  onStartUpload={(documentType) => {
                    setDocumentForm((prev) => ({
                      ...prev,
                      document_type: documentType,
                      supplier_name: prev.supplier_name || order.partner_name || order.supplier_name || "",
                      currency: order.currency || prev.currency || "TRY",
                    }));
                    setDocumentUploadOpen(true);
                  }}
                  onToggleUpload={() => setDocumentUploadOpen((prev) => !prev)}
                  onFormChange={setDocumentForm}
                  onUpload={uploadDocument}
                  onPreviewDocument={previewDocument}
                  onOpenDocument={openDocumentInNewTab}
                  onDownloadDocument={downloadDocument}
                  onApprovalNoteChange={(documentId, value) =>
                    setDocumentApprovalNotes((prev) => ({ ...prev, [documentId]: value }))
                  }
                  onApproval={updateInvoiceApproval}
                  onAnalyzeOCR={analyzeDocumentWithBackendOCR}
                  onCreateItemsFromOCR={createDocumentItemsFromOCR}
                  onAddDocumentItem={openDocumentItemModal}
                />
              </div>
            )}
            {activeTab === "history" && (
              <HistoryPanel
                rows={historyRows}
                status={order.status}
                actions={statusActions.map((action) => ({
                  ...action,
                  disabled: isActionDisabled(order.status, action.status),
                }))}
                onStatusChange={updateStatus}
              />
            )}
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
            <th className="p-3 text-right">Güven</th>
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
              <td className="p-3 text-right font-black text-slate-700">%{row.matchConfidence}</td>
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

function AutomaticReceiptSuggestionsPanel({
  order,
  items,
  receipts,
  documentItems,
  documents,
  applying,
  result,
  onApply,
}) {
  const suggestions = calculateAutomaticReceiptSuggestions(
    items,
    order.items || [],
    receipts,
    documentItems,
    order.id,
    documents,
  );
  const activeSuggestions = suggestions.filter(
    (suggestion) => suggestion.eligible && suggestion.status !== "Teslim Tamamlanmış",
  );
  const completedSuggestions = suggestions.filter(
    (suggestion) => suggestion.status === "Teslim Tamamlanmış",
  );
  const allocationBlockedSuggestions = suggestions.filter(
    (suggestion) => suggestion.allocationReviewRequired,
  );
  const totalSuggestedQuantity = activeSuggestions.reduce(
    (sum, suggestion) => sum + Number(suggestion.suggestedQuantity || 0),
    0,
  );
  const skippedCount = Math.max(documentItems.length - activeSuggestions.length, 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Otomatik Teslim Alma Önerileri</h2>
          <p className="mt-1 text-sm text-slate-500">
            İrsaliye OCR kalemleri sipariş satırlarıyla eşleşir; yalnızca güveni en az %80 olan, manuel kontrol gerektirmeyen eşleşmeler kullanıcı onayıyla stok girişine işlenir.
          </p>
        </div>
        <button
          type="button"
          disabled={applying || activeSuggestions.length === 0}
          onClick={onApply}
          className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {applying ? "Teslim Alınıyor..." : "Otomatik Teslim Al"}
        </button>
      </div>
      {allocationBlockedSuggestions.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">
          Bu kalem birden fazla proje dağılımına sahip olduğu için otomatik depo girişi yapılamaz. Lütfen manuel proje kalemi seçin.
          <div className="mt-2 text-xs font-semibold">
            {Array.from(new Set(allocationBlockedSuggestions.map((suggestion) => suggestion.productName))).join(" · ")}
          </div>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Info label="İşlenecek Kayıt" value={activeSuggestions.length} />
        <Info label="Toplam Teslim Miktarı" value={totalSuggestedQuantity} />
        <Info label="Atlanan Kayıt" value={result?.skippedCount ?? skippedCount} />
        <Info label="Hata Sayısı" value={result?.errorCount ?? 0} />
      </div>
      {result && (
        <div className={`mt-4 rounded-xl border p-3 text-sm font-bold ${
          result.errorCount > 0
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-emerald-200 bg-emerald-50 text-emerald-800"
        }`}>
          {result.processedCount} kayıt işlendi, toplam {result.processedQuantity} teslim miktarı kaydedildi.
        </div>
      )}
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

function ConnectionsPanel({ items, order }) {
  const groupedConnections = new Map();

  items.forEach((item) => {
    (item.allocations || []).forEach((allocation) => {
      const isStock = allocation.type === "stock";
      const key = isStock
        ? "stock"
        : [
            allocation.projectId || allocation.projectCode || "project",
            allocation.parentItemId || allocation.parentItemName || "main-product",
          ].join("::");
      const current = groupedConnections.get(key) || {
        type: isStock ? "stock" : "project",
        projectId: allocation.projectId || "",
        projectCode: allocation.projectCode || "-",
        projectName: allocation.projectName || "-",
        mainProduct: allocation.parentItemName || allocation.projectItemName || "Ana ürün belirtilmemiş",
        itemKeys: new Set(),
        quantities: new Map(),
      };
      current.itemKeys.add(`${item.productCode || ""}::${item.productName || ""}`);
      const unit = item.unit || "adet";
      current.quantities.set(
        unit,
        Number(current.quantities.get(unit) || 0) + Number(allocation.quantity || 0),
      );
      groupedConnections.set(key, current);
    });
  });

  const rows = Array.from(groupedConnections.values());
  const formatQuantities = (quantities) => Array.from(quantities.entries())
    .map(([unit, quantity]) => `${quantity.toLocaleString("tr-TR")} ${unit}`)
    .join(" · ");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
        Ürünler tek tek tekrarlanmaz; aynı proje ve ana ürüne ait dağıtımlar tek satırda toplanır.
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">Sıra</th>
                <th className="p-3">İş ortağı</th>
                <th className="p-3">Proje</th>
                <th className="p-3">Ana ürün / pano</th>
                <th className="p-3">Sipariş kalemi</th>
                <th className="p-3">Ayrılan miktar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.type}-${row.projectId}-${row.mainProduct}-${index}`} className="border-t border-slate-100">
                  <td className="p-3 font-bold text-slate-500">{index + 1}</td>
                  <td className="p-3 font-bold text-slate-900">{order.partner_name || order.supplier_name || "-"}</td>
                  <td className="p-3">
                    {row.type === "stock" ? (
                      <span className="font-bold text-emerald-700">Depo stoğu</span>
                    ) : (
                      <div>
                        <div className="font-bold text-slate-900">{row.projectCode}</div>
                        <div className="text-xs text-slate-500">{row.projectName}</div>
                      </div>
                    )}
                  </td>
                  <td className="p-3 font-semibold text-slate-800">{row.type === "stock" ? "Stok" : row.mainProduct}</td>
                  <td className="p-3">{row.itemKeys.size} kalem</td>
                  <td className="p-3 font-black text-blue-700">{formatQuantities(row.quantities)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
          Bu siparişte proje veya stok dağıtımı bulunmuyor.
        </div>
      )}
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
  const pendingDifference = check.pendingInvoiceBaseTotal - check.orderBaseTotal;
  const pendingDifferencePercent = check.orderBaseTotal > 0
    ? (Math.abs(pendingDifference) / check.orderBaseTotal) * 100
    : check.pendingInvoiceBaseTotal === 0
      ? 0
      : 100;
  const hasPendingReview = check.pendingInvoiceBaseTotal > 0;
  const hasApprovedDifference = Math.abs(check.difference) > 0.01;
  const reviewClass = hasPendingReview || hasApprovedDifference
    ? pendingDifference > 0 || check.difference > 0.01
      ? "border-red-300 bg-red-50 text-red-800"
      : "border-amber-300 bg-amber-50 text-amber-800"
    : "border-emerald-200 bg-emerald-50 text-emerald-800";
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
      {check.billingStatus !== "none" && (
        <div className={`mt-3 rounded-xl border p-4 text-sm font-semibold ${reviewClass}`}>
          <div className="font-black">Fatura-sipariş tutar kontrolü</div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
            <div>Sipariş: {formatMoney(check.orderBaseTotal, check.baseCurrency)}</div>
            <div>
              Fatura: {formatMoney(
                hasPendingReview ? check.pendingInvoiceBaseTotal : check.invoiceBaseTotal,
                check.baseCurrency,
              )}
            </div>
            <div>
              Fark: {formatMoney(
                hasPendingReview ? pendingDifference : check.difference,
                check.baseCurrency,
              )}
            </div>
            <div>
              Fark oranı: %
              {(hasPendingReview ? pendingDifferencePercent : check.differencePercent)
                .toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
            </div>
          </div>
          {(hasPendingReview || hasApprovedDifference) && (
            <div className="mt-2">
              Fatura farkı manuel incelenmeden otomatik kabul edilmez.
            </div>
          )}
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
  preview,
  accessLoadingId,
  accessError,
  onStartUpload,
  onToggleUpload,
  onFormChange,
  onUpload,
  onPreviewDocument,
  onOpenDocument,
  onDownloadDocument,
  onApprovalNoteChange,
  onApproval,
  onAnalyzeOCR,
  onCreateItemsFromOCR,
  onAddDocumentItem,
}) {
  const sections = [
    { type: "teklif", label: "Kaynak Teklif", description: "Siparişin oluşturulduğu tedarikçi teklifi" },
    { type: "fatura", label: "Faturalar", description: "Tedarikçi faturalarını yükleyin ve tutarı kontrol edin" },
    { type: "irsaliye", label: "İrsaliyeler", description: "Sevk ve irsaliye belgelerini yükleyin" },
    { type: "depo_giris", label: "Teslim Fişleri", description: "Teslim alma veya depo giriş fişlerini yükleyin" },
    { type: "siparis_formu", label: "Sipariş Formu" },
    { type: "diger", label: "Diğer Belgeler" },
  ];
  const uploadTypes = sections.filter((section) => ["fatura", "irsaliye", "depo_giris"].includes(section.type));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-blue-900">
          Kaynak teklif sipariş oluştuğunda otomatik gelir. Fatura, irsaliye ve teslim fişini aşağıdaki ilgili kutudan yükleyin.
        </div>
        {uploadOpen && (
          <button
            type="button"
            onClick={onToggleUpload}
            className="shrink-0 rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
          >
            Formu Kapat
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {uploadTypes.map((section) => {
          const count = documents.filter((document) => document.document_type === section.type).length;
          return (
            <button
              key={section.type}
              type="button"
              onClick={() => onStartUpload(section.type)}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-black text-slate-900">{section.label}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{count} belge</span>
              </div>
              <div className="mt-2 text-sm text-slate-500">{section.description}</div>
              <div className="mt-3 text-sm font-bold text-blue-700">+ Yükle</div>
            </button>
          );
        })}
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
            {(["fatura", "irsaliye"].includes(form.document_type)) && (
              <>
                <DocumentInput
                  label="Tedarikçi VKN / TCKN"
                  value={form.supplier_tax_number}
                  onChange={(value) => onFormChange((prev) => ({ ...prev, supplier_tax_number: value }))}
                />
                <DocumentInput
                  label="UBL Belge UUID"
                  value={form.document_uuid}
                  onChange={(value) => onFormChange((prev) => ({ ...prev, document_uuid: value }))}
                />
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-slate-600">UBL-TR Profili</span>
                  <select
                    value={form.document_profile}
                    onChange={(event) => onFormChange((prev) => ({ ...prev, document_profile: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
                  >
                    <option value="">Seçiniz</option>
                    {form.document_type === "irsaliye" ? (
                      <option value="TEMELIRSALIYE">TEMELİRSALİYE</option>
                    ) : (
                      <>
                        <option value="TEMELFATURA">TEMELFATURA</option>
                        <option value="TICARIFATURA">TİCARİFATURA</option>
                        <option value="EARSIVFATURA">E-ARŞİVFATURA</option>
                      </>
                    )}
                  </select>
                </label>
              </>
            )}
            <DocumentInput
              label="Belge Tutarı"
              type="number"
              value={form.invoice_total}
              onChange={(value) => onFormChange((prev) => ({ ...prev, invoice_total: value }))}
            />
            {form.document_type === "fatura" && (
              <>
                <DocumentInput
                  label="KDV Hariç Tutar"
                  type="number"
                  value={form.tax_exclusive_amount}
                  onChange={(value) => onFormChange((prev) => ({ ...prev, tax_exclusive_amount: value }))}
                />
                <DocumentInput
                  label="Vergi Toplamı"
                  type="number"
                  value={form.tax_amount}
                  onChange={(value) => onFormChange((prev) => ({ ...prev, tax_amount: value }))}
                />
                <DocumentInput
                  label="Ödenecek Tutar"
                  type="number"
                  value={form.payable_amount}
                  onChange={(value) => onFormChange((prev) => ({ ...prev, payable_amount: value }))}
                />
              </>
            )}
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
                          <div className="flex flex-wrap gap-2">
                            {isPdfDocument(document) && (
                              <button type="button" disabled={accessLoadingId === document.id} onClick={() => onPreviewDocument(document)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">Önizle</button>
                            )}
                            <button type="button" disabled={accessLoadingId === document.id} onClick={() => onOpenDocument(document)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700">Aç</button>
                            <button type="button" disabled={accessLoadingId === document.id} onClick={() => onDownloadDocument(document)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">İndir</button>
                            {["fatura", "irsaliye", "depo_giris"].includes(section.type) && (
                              <button
                                type="button"
                                disabled={Boolean(ocrProcessingId)}
                                onClick={() => onAnalyzeOCR(document)}
                                className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                              >
                                {ocrProcessingId === document.id ? "Analiz Ediliyor..." : "OCR Analiz Et"}
                              </button>
                            )}
                          </div>
                        </div>
                        {preview?.documentId === document.id && preview.url && (
                          <iframe title={document.original_file_name || "Belge önizleme"} src={preview.url} className="mt-3 h-80 w-full rounded-xl border border-slate-200 bg-white" />
                        )}
                        {accessError && <div className="mt-3 text-xs font-bold text-red-600">{accessError}</div>}
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
                          {(["fatura", "irsaliye"].includes(section.type)) && (
                            <>
                              <Info label="UBL-TR Profili" value={document.document_profile || "Eksik"} />
                              <Info label="UBL UUID" value={document.document_uuid || "Eksik"} />
                              <Info
                                label="E-Belge Kontrolü"
                                value={document.gib_status === "validated" ? "Yerel doğrulama başarılı" : "İnceleme gerekli"}
                              />
                            </>
                          )}
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
                        {Array.isArray(document.validation_errors) && document.validation_errors.length > 0 && (
                          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                            UBL-TR kayıt kontrolü: {document.validation_errors.join(" · ")}
                          </div>
                        )}
                        {["fatura", "irsaliye", "depo_giris"].includes(section.type) && (document.ocr_result || document.ocr_status === "completed") && (
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
                        {["fatura", "irsaliye", "depo_giris"].includes(section.type) && (
                          <DocumentItemsPanel
                            document={document}
                            items={currentDocumentItems}
                            orderItems={orderItems}
                            rawOrderItems={rawOrderItems}
                            orderCurrency={order.currency}
                            onAdd={onAddDocumentItem}
                          />
                        )}
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

function ItemsTable({ items, currency, onExportOrderPdf, onExportExcel, onReceive }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-bold text-blue-950">Sipariş kalemleri ve çıktıları</div>
          <div className="mt-1 text-sm text-blue-800">
            Ürün ve fiyatları inceleyebilir, sipariş formunu PDF veya Excel olarak alabilirsiniz.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onExportOrderPdf} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">Sipariş PDF</button>
          <button type="button" onClick={onExportExcel} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white">Excel İndir</button>
          <button type="button" onClick={onReceive} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">Depo Teslim Alma</button>
        </div>
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

function DeliveryHistoryPanel({ items, receipts, totals }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Info label="Toplam sipariş" value={totals.totalQuantity} />
        <Info label="Teslim alınan" value={totals.deliveredQuantity} />
        <Info label="Kalan" value={totals.remainingQuantity} />
      </div>
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
        Her teslim hareketi tarih, teslim alan kişi ve kalan miktarla birlikte burada izlenir. Yeni giriş için “Depo Teslim Alma” sekmesini kullanın.
      </div>
      {receipts.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">Tarih</th>
                <th className="p-3">Ürün</th>
                <th className="p-3">Gelen / kabul</th>
                <th className="p-3">Hatalı</th>
                <th className="p-3">Teslim alan</th>
                <th className="p-3">Güncel kalan</th>
                <th className="p-3">Durum</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((receipt) => {
                const match = matchOrderItem(receipt, items);
                const matched = items.find(
                  (item, itemIndex) => getOrderItemMatchId(item, itemIndex) === match.orderItemId,
                );
                const remaining = matched
                  ? Math.max(Number(matched.quantity || 0) - Number(matched.deliveredQuantity || 0), 0)
                  : "-";
                return (
                  <tr key={receipt.id} className="border-t border-slate-100">
                    <td className="p-3 font-semibold">{receipt.receipt_date || "-"}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-900">{receipt.product_name || matched?.productName || "-"}</div>
                      <div className="text-xs text-slate-500">{receipt.product_code || matched?.productCode || "-"}</div>
                    </td>
                    <td className="p-3 font-bold">{Number(receipt.received_quantity || 0)} / {Number(receipt.accepted_quantity || 0)}</td>
                    <td className="p-3">{Number(receipt.defective_quantity || 0)}</td>
                    <td className="p-3">{receipt.received_by || "Depo"}</td>
                    <td className="p-3 font-black text-amber-700">{remaining}</td>
                    <td className="p-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(receipt.receipt_status)}`}>{receipt.receipt_status || "Kaydedildi"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Henüz teslim alma kaydı yok.</div>
      )}
    </div>
  );
}

function ReceivingPanel({
  items,
  order,
  project,
  projectItems,
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
                    disabled={disabled || projectItems.length === 0}
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
                    disabled={disabled || projectItems.length === 0}
                    onChange={(event) => onInputChange(index, "projectItemId", event.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-100"
                  >
                    <option value="">Otomatik eşleşme yok</option>
                    {projectItems.map((projectItem) => (
                      <option key={projectItem.id} value={projectItem.id}>
                        {projectItem.project_code ? `${projectItem.project_code} · ` : ""}{itemLabel(projectItem)}
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

function HistoryPanel({ rows, status, actions, onStatusChange }) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-black text-slate-900">Sipariş durumu: {status}</div>
            <div className="mt-1 text-sm text-slate-500">Siparişin iş akışı işlemlerini buradan yönetin.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action.status}
                type="button"
                disabled={action.disabled}
                onClick={() => onStatusChange(action.status)}
                className={`rounded-xl px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 ${action.danger ? "bg-red-600" : "bg-blue-600"}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
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
