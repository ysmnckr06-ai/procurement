// Teslim almada otomatik oluşan belge (irsaliye kaydı / teslim fişi).
// Tedarikçinin irsaliye numarası girildiyse belge "irsaliye" türünde o numarayla,
// girilmediyse "teslim_fisi" türünde sipariş + tarih numarasıyla açılır. Aynı
// irsaliyeyle (veya aynı gün numarasız) yapılan sonraki teslimler aynı belgeye eklenir.

export const GENERATED_RECEIPT_PROVIDER = "corvian-teslim";

const WAYBILL_NOTE = /\[irsaliye:([^\]]+)\]/;

function clean(value) {
  return String(value || "").replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
}

export function receiptDocumentIdentity({ waybillNo, orderNo, receiptDate }) {
  const number = clean(waybillNo);
  if (number) return { documentType: "irsaliye", documentNumber: number };
  const datePart = String(receiptDate || "").replaceAll("-", "");
  return { documentType: "teslim_fisi", documentNumber: `TES-${clean(orderNo) || "SIPARIS"}-${datePart}` };
}

export function withWaybillNote(note, waybillNo) {
  const base = String(note || "").replace(WAYBILL_NOTE, "").trim();
  const number = clean(waybillNo);
  if (!number) return base;
  return [base, `[irsaliye:${number}]`].filter(Boolean).join(" ");
}

export function waybillOfReceipt(receipt) {
  return String(receipt?.note || "").match(WAYBILL_NOTE)?.[1]?.trim() || "";
}

export function visibleReceiptNote(note) {
  return String(note || "").replace(WAYBILL_NOTE, "").trim();
}

export function receiptsForDocument(receipts, { waybillNo, receiptDate }) {
  const number = clean(waybillNo);
  return (receipts || []).filter((receipt) => {
    const receiptWaybill = waybillOfReceipt(receipt);
    if (number) return receiptWaybill === number;
    return !receiptWaybill && String(receipt.receipt_date || "") === String(receiptDate || "");
  });
}

export function isGeneratedReceiptDocument(document) {
  return document?.ocr_provider === GENERATED_RECEIPT_PROVIDER;
}

export function receiptDocumentProjectIds(receipts, fallbackProjectId) {
  const ids = new Set((receipts || []).map((receipt) => receipt.project_id).filter(Boolean).map(String));
  if (ids.size === 0 && fallbackProjectId) ids.add(String(fallbackProjectId));
  return [...ids];
}
