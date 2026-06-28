#!/usr/bin/env node

/*
 * Corvian E2E demo scenario generator.
 *
 * Safety defaults:
 * - Requires --confirm.
 * - Requires an explicit tenant user id.
 * - Runs only on demo tenants unless --allow-test-tenant is passed.
 * - Never deletes records and never updates existing business records.
 * - Every created user-visible record is tagged with E2E-DEMO-SENARYO.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TAG = "E2E-DEMO-SENARYO";
const BUCKET = "order-documents";

const supplierNames = [
  `${TAG} Alfa Elektrik`,
  `${TAG} Nova Teknik`,
  `${TAG} Delta Pano`,
  `${TAG} Orion Endustri`,
  `${TAG} Vektor Malzeme`,
];

const defaultItems = [
  { code: "E2E-PNL-001", name: `${TAG} Ana Dagitim Panosu`, unit: "adet", qty: 2, price: 98500, initialStock: 0 },
  { code: "E2E-CBL-035", name: `${TAG} 3x35 NYY Kablo`, unit: "metre", qty: 260, price: 420, initialStock: 80 },
  { code: "E2E-SWT-250", name: `${TAG} 250A Kompakt Salter`, unit: "adet", qty: 8, price: 12200, initialStock: 2 },
  { code: "E2E-SNS-024", name: `${TAG} Endustriyel Sensor 24V`, unit: "adet", qty: 18, price: 1450, initialStock: 4 },
  { code: "E2E-TRM-010", name: `${TAG} Klemens Seti`, unit: "set", qty: 30, price: 780, initialStock: 30 },
];

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function loadLocalEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "../.env.local"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) continue;
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      value = value.replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function supabaseHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "gecersiz-url";
  }
}

function publicUserInfo(user) {
  return {
    id: user.id,
    email: user.email || "",
    created_at: user.created_at || "",
  };
}

async function listVisibleAuthUsers(supabase, perPage = 5) {
  const result = await supabase.auth.admin.listUsers({ page: 1, perPage });
  if (result.error) {
    throw new Error(`auth.users listelenemedi. Service role key dogru projeye ait mi? ${result.error.message}`);
  }
  return (result.data?.users || []).map(publicUserInfo);
}

async function printDebugUsers(supabase, perPage = 5) {
  const users = await listVisibleAuthUsers(supabase, perPage);
  console.log(`[E2E DEBUG] Bagli projede gorunen ilk ${users.length} auth kullanicisi:`);
  console.log(JSON.stringify(users, null, 2));
  return users;
}

async function tableColumnExists(supabaseUrl, serviceRoleKey, tableName, columnName) {
  const url = new URL(`/rest/v1/${tableName}`, supabaseUrl);
  url.searchParams.set("select", columnName);
  url.searchParams.set("limit", "0");

  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
    },
  });

  if (response.ok) return true;

  const body = await response.text();
  if (/column|schema cache|could not find/i.test(body) && body.includes(columnName)) {
    return false;
  }

  throw new Error(`${tableName}.${columnName} kolon kontrolu yapilamadi: HTTP ${response.status} ${body}`);
}

async function detectTableColumns(supabaseUrl, serviceRoleKey, tableName, candidateColumns) {
  const uniqueCandidates = Array.from(new Set(candidateColumns.filter(Boolean)));
  const entries = [];

  for (const columnName of uniqueCandidates) {
    const exists = await tableColumnExists(supabaseUrl, serviceRoleKey, tableName, columnName);
    entries.push([columnName, exists]);
  }

  const existingColumns = new Set(entries.filter(([, exists]) => exists).map(([columnName]) => columnName));
  const missingColumns = entries.filter(([, exists]) => !exists).map(([columnName]) => columnName);

  console.log(`[E2E DEBUG] ${tableName} mevcut kolonlar: ${Array.from(existingColumns).join(", ") || "-"}`);
  if (missingColumns.length > 0) {
    console.log(`[E2E DEBUG] ${tableName} atlanacak opsiyonel kolonlar: ${missingColumns.join(", ")}`);
  }

  return existingColumns;
}

function prunePayloadForColumns(tableName, payload, existingColumns, requiredColumns = []) {
  const missingRequired = requiredColumns.filter((columnName) => !existingColumns.has(columnName));
  if (missingRequired.length > 0) {
    throw new Error(
      `${tableName} tablosunda zorunlu kolon eksik: ${missingRequired.join(", ")}. Canli schema migration durumunu kontrol edin.`,
    );
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([columnName]) => existingColumns.has(columnName)),
  );
}

function required(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function money(value) {
  return Number(value || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function today(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function safeFileName(value) {
  return String(value || "belge")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value, Object.keys(value || {}).sort()))
    .digest("hex")
    .slice(0, 16);
}

function ensureNoError(result, message) {
  if (result.error) {
    throw new Error(`${message}: ${result.error.message}`);
  }
  return result.data;
}

async function insertOne(supabase, table, payload, select = "*") {
  const result = await supabase.from(table).insert(payload).select(select).single();
  return ensureNoError(result, `${table} kaydi olusturulamadi`);
}

async function insertMany(supabase, table, payloads, select = "*") {
  const result = await supabase.from(table).insert(payloads).select(select);
  return ensureNoError(result, `${table} kayitlari olusturulamadi`) || [];
}

async function maybeInsertOne(supabase, table, payload, select = "*") {
  const result = await supabase.from(table).insert(payload).select(select).single();
  if (result.error) {
    console.warn(`[UYARI] ${table} kaydi atlandi: ${result.error.message}`);
    return null;
  }
  return result.data;
}

async function findOneByEquals(supabase, table, filters, select = "*") {
  let query = supabase.from(table).select(select);
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    throw new Error(`${table} mevcut kayit sorgusu icin en az bir filtre gerekli.`);
  }
  for (const [column, value] of entries) {
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }
  const result = await query.limit(1).maybeSingle();
  return ensureNoError(result, `${table} mevcut kayit sorgulanamadi`);
}

async function getOrCreateOne(supabase, table, filters, payload, select = "*") {
  const existing = await findOneByEquals(supabase, table, filters, select);
  if (existing) {
    console.log(`[E2E DEBUG] ${table} mevcut kayit kullanildi: ${existing.id || JSON.stringify(filters)}`);
    return existing;
  }
  return insertOne(supabase, table, payload, select);
}

async function insertSchemaAware(supabase, supabaseUrl, serviceRoleKey, table, payload, requiredColumns = ["user_id"], select = "*") {
  const columns = await detectTableColumns(supabaseUrl, serviceRoleKey, table, Object.keys(payload));
  const prunedPayload = prunePayloadForColumns(table, payload, columns, requiredColumns);
  return insertOne(supabase, table, withoutNullValues(prunedPayload), select);
}

async function updateSchemaAware(supabase, supabaseUrl, serviceRoleKey, table, matchFilters, payload) {
  const columns = await detectTableColumns(supabaseUrl, serviceRoleKey, table, Object.keys(payload));
  const prunedPayload = prunePayloadForColumns(table, payload, columns, []);
  const cleanPayload = withoutNullValues(prunedPayload);
  if (Object.keys(cleanPayload).length === 0) return null;

  let query = supabase.from(table).update(cleanPayload);
  for (const [column, value] of Object.entries(matchFilters)) {
    query = query.eq(column, value);
  }
  const result = await query;
  return ensureNoError(result, `${table} kaydi guncellenemedi`);
}

function addExistingFilter(filters, columns, payload, columnName, value = payload[columnName]) {
  if (columns.has(columnName) && value !== undefined && value !== null) {
    filters[columnName] = value;
  }
}

function buildIdentityFilters(columns, payload, preferredColumns, fallbackColumns = []) {
  const filters = {};
  for (const columnName of preferredColumns) {
    addExistingFilter(filters, columns, payload, columnName);
  }

  const hasSpecificFilter = preferredColumns
    .filter((columnName) => columnName !== "user_id")
    .some((columnName) => Object.prototype.hasOwnProperty.call(filters, columnName));

  if (hasSpecificFilter) return filters;

  for (const columnName of fallbackColumns) {
    addExistingFilter(filters, columns, payload, columnName);
  }

  return filters;
}

function buildOfferIdentityFilters(columns, payload, entry) {
  const filters = {};

  addExistingFilter(filters, columns, payload, "user_id");
  addExistingFilter(filters, columns, payload, "request_id");
  addExistingFilter(filters, columns, payload, "project_id");

  if (columns.has("supplier_name")) {
    filters.supplier_name = entry.supplier.name;
    return filters;
  }
  if (columns.has("partner_id")) {
    filters.partner_id = entry.supplier.id;
    return filters;
  }
  if (columns.has("original_file_name")) {
    filters.original_file_name = payload.original_file_name;
    return filters;
  }
  if (columns.has("file_name")) {
    filters.file_name = payload.file_name;
    return filters;
  }

  const fingerprint = stableHash({
    tag: TAG,
    request_id: payload.request_id,
    project_id: payload.project_id,
    supplier_id: entry.supplier.id,
    supplier_name: entry.supplier.name,
    currency: payload.currency,
    total_amount: payload.total_amount,
  });

  addExistingFilter(filters, columns, payload, "currency");
  addExistingFilter(filters, columns, payload, "total_amount");
  addExistingFilter(filters, columns, payload, "supplier_offer_amount");

  if (columns.has("status")) {
    filters.status = payload.status;
  }

  console.log(`[E2E DEBUG] offers ayirt edici kolon yok; mevcut stabil kolonlarla fingerprint kullanildi: ${fingerprint}`);
  return filters;
}

function pickReportPayloadColumns(columns, payload, analysisPayload) {
  const nextPayload = { ...payload };
  for (const columnName of ["data", "report_data", "result", "analysis", "items"]) {
    delete nextPayload[columnName];
  }

  const preferredAnalysisColumns = ["report_data", "result", "analysis", "items", "data"];
  const selectedColumn = preferredAnalysisColumns.find((columnName) => columns.has(columnName));
  if (selectedColumn) {
    nextPayload[selectedColumn] = analysisPayload;
  }

  return nextPayload;
}

function pickFlexibleDataColumn(columns, payload, dataPayload, candidateColumns) {
  const nextPayload = { ...payload };
  for (const columnName of candidateColumns) {
    delete nextPayload[columnName];
  }

  const selectedColumn = candidateColumns.find((columnName) => columns.has(columnName));
  if (selectedColumn) {
    nextPayload[selectedColumn] = dataPayload;
  }

  return nextPayload;
}

function withoutNullValues(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null),
  );
}

function buildDocumentIdentityFilters(columns, payload) {
  const preferredColumns = ["user_id", "document_number", "content_sha256", "storage_path", "original_file_name"];
  const fallbackColumns = ["document_type", "mime_type", "file_size", "invoice_total", "currency"];
  const filters = buildIdentityFilters(columns, payload, preferredColumns, fallbackColumns);
  const hasSpecificFilter = Object.keys(filters).some((columnName) => columnName !== "user_id");
  return hasSpecificFilter ? filters : null;
}

function buildDocumentLinkPayloads(columns, { tenantUserId, documentId, orderId = null, projectId = null }) {
  const common = {};
  addExistingFilter(common, columns, { user_id: tenantUserId }, "user_id");
  addExistingFilter(common, columns, { document_id: documentId }, "document_id");

  const payloads = [];
  const pushPayload = (payload) => {
    const pruned = withoutNullValues(prunePayloadForColumns("document_links", { ...common, ...payload }, columns, []));
    const signature = JSON.stringify(pruned, Object.keys(pruned).sort());
    if (!payloads.some((item) => JSON.stringify(item, Object.keys(item).sort()) === signature)) {
      payloads.push(pruned);
    }
  };

  if (columns.has("entity_type") && columns.has("entity_id")) {
    if (orderId) pushPayload({ entity_type: "order", entity_id: orderId });
    if (projectId) pushPayload({ entity_type: "project", entity_id: projectId });
  }

  if (columns.has("linked_type") && columns.has("linked_id")) {
    if (orderId) pushPayload({ linked_type: "order", linked_id: orderId });
    if (projectId) pushPayload({ linked_type: "project", linked_id: projectId });
  }

  if (columns.has("target_type") && columns.has("target_id")) {
    if (orderId) pushPayload({ target_type: "order", target_id: orderId });
    if (projectId) pushPayload({ target_type: "project", target_id: projectId });
  }

  if (columns.has("order_id") && orderId) {
    pushPayload({ order_id: orderId });
  }
  if (columns.has("project_id") && projectId) {
    pushPayload({ project_id: projectId });
  }

  return payloads.filter((payload) => Object.keys(payload).some((columnName) => !["user_id", "document_id"].includes(columnName)));
}

async function ensureDocumentLink(supabase, { supabaseUrl, serviceRoleKey, tenantUserId, documentId, orderId = null, projectId = null }) {
  const candidateColumns = [
    "id",
    "user_id",
    "document_id",
    "order_id",
    "project_id",
    "entity_type",
    "entity_id",
    "linked_type",
    "linked_id",
    "target_type",
    "target_id",
  ];
  const linkColumns = await detectTableColumns(supabaseUrl, serviceRoleKey, "document_links", candidateColumns);
  const payloads = buildDocumentLinkPayloads(linkColumns, { tenantUserId, documentId, orderId, projectId });
  if (payloads.length === 0) {
    throw new Error("document_links icin canli schema'da desteklenen link kolon kombinasyonu bulunamadi.");
  }

  const linkedRows = [];
  const linkErrors = [];
  for (const payload of payloads) {
    const existing = await findOneByEquals(supabase, "document_links", payload, "id");
    if (existing) {
      linkedRows.push(existing);
      continue;
    }

    const result = await supabase.from("document_links").insert(payload).select("id").single();
    if (result.error) {
      linkErrors.push(`${JSON.stringify(payload)} -> ${result.error.message}`);
      if (result.error.code === "23514") {
        console.warn(`[UYARI] document_links payload check constraint nedeniyle atlandi: ${result.error.message}`);
        continue;
      }
      throw new Error(`document_links kaydi olusturulamadi: ${result.error.message}`);
    }
    linkedRows.push(result.data);
  }

  if (linkedRows.length === 0) {
    throw new Error(`document_links icin hicbir payload check constraint'i gecemedi: ${linkErrors.join(" | ")}`);
  }

  return linkedRows;
}

async function generatePdfBuffer(title, lines, rows = []) {
  const { jsPDF } = await import("jspdf");
  const autoTableModule = await import("jspdf-autotable");
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(title, 40, 48);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  let y = 78;
  for (const line of lines) {
    doc.text(String(line), 40, y);
    y += 16;
  }

  if (rows.length > 0) {
    autoTable(doc, {
      startY: y + 10,
      head: [["Kod", "Aciklama", "Miktar", "Birim", "Birim Fiyat", "Toplam"]],
      body: rows.map((row) => [
        row.product_code,
        row.product_name,
        String(row.quantity),
        row.unit,
        money(row.unit_price),
        money(row.total),
      ]),
      styles: { font: "helvetica", fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
    });
  }

  return Buffer.from(doc.output("arraybuffer"));
}

async function uploadDocument({
  supabase,
  supabaseUrl,
  serviceRoleKey,
  tenantUserId,
  project,
  order,
  type,
  fileName,
  title,
  lines,
  rows,
  documentNumber,
  invoiceTotal = null,
  supplierName = "",
}) {
  const buffer = await generatePdfBuffer(title, lines, rows);
  const contentSha256 = sha256(buffer);
  const documentData = {
    source: "e2e-demo-scenario",
    summary: `${TAG} demo belgesi otomatik olusturuldu.`,
    document_number: documentNumber,
    document_type: type,
    supplier_name: supplierName || null,
    invoice_total: invoiceTotal,
    rows,
  };
  const rawDocumentPayload = {
    user_id: tenantUserId,
    document_type: type,
    original_file_name: fileName,
    storage_bucket: BUCKET,
    storage_path: null,
    mime_type: "application/pdf",
    file_size: buffer.length,
    content_sha256: contentSha256,
    document_number: documentNumber,
    document_date: today(),
    supplier_name: supplierName || null,
    invoice_total: invoiceTotal,
    currency: "TRY",
    ocr_status: "completed",
    ocr_summary: `${TAG} demo belgesi otomatik olusturuldu.`,
    ocr_result: documentData,
    ocr_data: documentData,
    extracted_data: documentData,
    metadata: documentData,
    analysis: documentData,
    data: documentData,
  };
  const documentCandidateColumns = Object.keys(rawDocumentPayload);
  const documentColumns = await detectTableColumns(supabaseUrl, serviceRoleKey, "documents", documentCandidateColumns);
  const existingDocumentPayload = prunePayloadForColumns(
    "documents",
    pickFlexibleDataColumn(
      documentColumns,
      rawDocumentPayload,
      documentData,
      ["ocr_result", "ocr_data", "extracted_data", "metadata", "analysis", "data"],
    ),
    documentColumns,
    ["user_id"],
  );
  const existingDocumentFilters = buildDocumentIdentityFilters(documentColumns, existingDocumentPayload);
  if (existingDocumentFilters) {
    const existingDocument = await findOneByEquals(supabase, "documents", existingDocumentFilters);
    if (existingDocument) {
      await ensureDocumentLink(supabase, {
        supabaseUrl,
        serviceRoleKey,
        tenantUserId,
        documentId: existingDocument.id,
        orderId: order?.id || null,
        projectId: project.id,
      });
      console.log(`[E2E DEBUG] documents mevcut belge kullanildi: ${existingDocument.id}`);
      return existingDocument;
    }
  } else {
    console.log("[E2E DEBUG] documents icin ayirt edici kolon yok; mevcut belge lookup atlandi.");
  }

  const storagePath = `${tenantUserId}/${order?.id || project.id}/${crypto.randomUUID()}-${safeFileName(fileName)}`;

  const upload = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    cacheControl: "3600",
    contentType: "application/pdf",
    upsert: false,
  });
  if (upload.error) throw new Error(`PDF storage upload basarisiz: ${upload.error.message}`);

  try {
    const documentPayload = prunePayloadForColumns(
      "documents",
      {
        ...existingDocumentPayload,
        storage_path: storagePath,
      },
      documentColumns,
      ["user_id"],
    );
    const document = await insertOne(supabase, "documents", documentPayload);

    await ensureDocumentLink(supabase, {
      supabaseUrl,
      serviceRoleKey,
      tenantUserId,
      documentId: document.id,
      orderId: order?.id || null,
      projectId: project.id,
    });

    return { ...document, storage_path: storagePath };
  } catch (error) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw error;
  }
}

function makeOfferGroups(items, suppliers) {
  return items.map((item, itemIndex) => {
    const purchaseQuantity = Number(item.purchase_quantity || item.quantity || item.qty || 1);
    const offers = suppliers.map((supplier, supplierIndex) => {
      const multiplier = 0.92 + supplierIndex * 0.045 + itemIndex * 0.008;
      const unitPrice = Math.round(Number(item.estimated_unit_price || item.price || 1000) * multiplier);
      const discount = supplierIndex === 0 ? 3 : supplierIndex === 1 ? 1.5 : 0;
      const netUnitPrice = unitPrice * (1 - discount / 100);
      const total = netUnitPrice * purchaseQuantity;
      return {
        firmaAdi: supplier.name,
        supplier_id: supplier.id,
        birimFiyat: unitPrice,
        iskonto: discount,
        netBirimFiyat: netUnitPrice,
        netToplam: total,
        paraBirimi: "TRY",
        kur: 1,
        netToplamTRY: total,
        vade: `${30 + supplierIndex * 15} gun`,
        termin: `${7 + supplierIndex * 2} gun`,
        terminDays: 7 + supplierIndex * 2,
        vadeDays: 30 + supplierIndex * 15,
        firmaAdedi: purchaseQuantity,
      };
    });

    const bestOffer = offers.reduce((best, offer) => (offer.netToplamTRY < best.netToplamTRY ? offer : best), offers[0]);
    return {
      urunKodu: item.product_code,
      normalizedProductCode: item.normalized_product_code || item.product_code,
      urunAciklamasi: item.product_name,
      birim: item.unit || "adet",
      talepEdilenAdet: purchaseQuantity,
      purchaseQuantity,
      productId: item.product_id || null,
      allocations: item.allocations || [],
      offers,
      bestOffer,
      recommended_firm: bestOffer.firmaAdi,
      reason: "Toplam maliyet, vade ve termin dengesi en iyi teklif.",
    };
  });
}

function bestOrderItems(report, suppliers) {
  return (report.analysis || []).map((group, index) => {
    const offer = group.bestOffer || group.offers?.[0] || {};
    const supplier = suppliers.find((item) => item.name === offer.firmaAdi) || suppliers[0];
    const quantity = Number(group.purchaseQuantity || group.talepEdilenAdet || offer.firmaAdedi || 1);
    return {
      rowId: `e2e-${index + 1}`,
      productId: group.productId || null,
      productCode: group.urunKodu || "",
      productName: group.urunAciklamasi || "",
      unit: group.birim || "adet",
      quantity,
      deliveredQuantity: 0,
      unitPrice: Number(offer.birimFiyat || 0),
      discount: Number(offer.iskonto || 0),
      netUnitPrice: Number(offer.netBirimFiyat || offer.birimFiyat || 0),
      total: Number(offer.netToplam || 0),
      currency: offer.paraBirimi || "TRY",
      paymentTerm: offer.vade || "",
      deliveryTerm: offer.termin || "",
      allocations: group.allocations || [],
      sourceReportId: report.id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      projectItemId: group.allocations?.[0]?.projectItemId || null,
      parentItemId: group.allocations?.[0]?.parentItemId || null,
    };
  });
}

function assertE2EOrder(order) {
  const haystack = [
    order?.order_no,
    order?.product_name,
    order?.note,
    order?.supplier_name,
    order?.partner_name,
  ].filter(Boolean).join(" ");

  if (!haystack.includes(TAG) && !String(order?.order_no || "").startsWith("SIP-E2E-")) {
    throw new Error("Script teslim fallback yalnizca E2E-DEMO-SENARYO etiketli siparislerde calisir.");
  }
}

function receiptStatusFor(receivedQuantity, orderedQuantity) {
  const received = Number(receivedQuantity || 0);
  const ordered = Number(orderedQuantity || 0);
  if (ordered > 0 && received >= ordered) return "Tam Teslim";
  if (received > 0) return "Kısmi Teslim";
  return "Bekliyor";
}

async function recordE2EDemoReceiptFallback({
  supabase,
  supabaseUrl,
  serviceRoleKey,
  tenantUserId,
  order,
  project,
  comparisonReport,
  bestSupplier,
  item,
  quantity,
}) {
  assertE2EOrder(order);

  const acceptedQuantity = Number(quantity || 0);
  const orderedQuantity = Number(item.quantity || 0);
  if (acceptedQuantity <= 0 || orderedQuantity <= 0) {
    throw new Error("E2E teslim fallback miktarlari 0'dan buyuk olmalidir.");
  }

  const duplicateFilters = {
    user_id: tenantUserId,
    order_id: order.id,
    product_code: item.productCode || "",
    project_item_id: item.projectItemId || null,
    accepted_quantity: acceptedQuantity,
    received_quantity: acceptedQuantity,
    receipt_date: today(2),
    note: `${TAG} irsaliye bazli demo teslim`,
  };
  let duplicateQuery = supabase.from("order_receipts").select("id");
  for (const [column, value] of Object.entries(duplicateFilters)) {
    duplicateQuery = value === null ? duplicateQuery.is(column, null) : duplicateQuery.eq(column, value);
  }
  const duplicateResult = await duplicateQuery.limit(1).maybeSingle();
  const duplicate = ensureNoError(duplicateResult, "E2E teslim duplicate kontrolu yapilamadi");
  if (duplicate) return duplicate;

  const receiptStatus = receiptStatusFor(acceptedQuantity, orderedQuantity);
  const receiptPayload = {
    user_id: tenantUserId,
    order_id: order.id,
    project_id: project.id,
    project_item_id: item.projectItemId,
    parent_item_id: item.parentItemId,
    document_item_id: null,
    order_no: order.order_no,
    supplier_name: bestSupplier.name,
    partner_id: null,
    partner_name: bestSupplier.name,
    partner_type: "Tedarikci",
    product_code: item.productCode || "",
    product_name: item.productName || "",
    unit: item.unit || "adet",
    ordered_quantity: orderedQuantity,
    received_quantity: acceptedQuantity,
    accepted_quantity: acceptedQuantity,
    missing_quantity: Math.max(orderedQuantity - acceptedQuantity, 0),
    excess_quantity: 0,
    defective_quantity: 0,
    receipt_status: "Depoda",
    received_by: `${TAG} Depo Sorumlusu`,
    receipt_date: today(2),
    note: `${TAG} irsaliye bazli demo teslim`,
  };
  const insertedReceipt = await insertSchemaAware(
    supabase,
    supabaseUrl,
    serviceRoleKey,
    "order_receipts",
    receiptPayload,
    ["user_id"],
  );

  if (item.productId) {
    const productResult = await supabase
      .from("products")
      .select("current_stock")
      .eq("id", item.productId)
      .eq("user_id", tenantUserId)
      .maybeSingle();
    const currentProduct = ensureNoError(productResult, "E2E urun stoku okunamadi");
    await updateSchemaAware(
      supabase,
      supabaseUrl,
      serviceRoleKey,
      "products",
      { id: item.productId, user_id: tenantUserId },
      {
        current_stock: Number(currentProduct?.current_stock || 0) + acceptedQuantity,
        last_supplier: bestSupplier.name,
        last_unit_price: Number(item.unitPrice || item.netUnitPrice || 0),
        last_currency: item.currency || "TRY",
        last_purchase_date: today(2),
        last_movement_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    );

    await insertSchemaAware(
      supabase,
      supabaseUrl,
      serviceRoleKey,
      "stock_movements",
      {
        user_id: tenantUserId,
        product_id: item.productId,
        product_code: item.productCode || "",
        product_name: item.productName || "",
        movement_type: "in",
        quantity: acceptedQuantity,
        unit: item.unit || "adet",
        supplier_name: bestSupplier.name,
        partner_id: null,
        partner_name: bestSupplier.name,
        partner_type: "Tedarikci",
        order_id: order.id,
        report_id: comparisonReport.id,
        project_id: project.id,
        project_item_id: item.projectItemId,
        parent_item_id: item.parentItemId,
        receipt_id: insertedReceipt.id,
        unit_price: Number(item.unitPrice || item.netUnitPrice || 0),
        currency: item.currency || "TRY",
        movement_date: today(2),
        source: "Depo teslim alma",
        notes: `${order.order_no} - ${receiptStatus}`,
      },
      ["user_id"],
    );
  }

  if (item.projectItemId) {
    const projectItemResult = await supabase
      .from("project_items")
      .select("received_quantity, defective_quantity")
      .eq("id", item.projectItemId)
      .eq("user_id", tenantUserId)
      .maybeSingle();
    const projectItem = ensureNoError(projectItemResult, "E2E proje kalemi okunamadi");
    await updateSchemaAware(
      supabase,
      supabaseUrl,
      serviceRoleKey,
      "project_items",
      { id: item.projectItemId, user_id: tenantUserId },
      {
        received_quantity: Number(projectItem?.received_quantity || 0) + acceptedQuantity,
        defective_quantity: Number(projectItem?.defective_quantity || 0),
        status: receiptStatus,
        updated_at: new Date().toISOString(),
      },
    );
  }

  return insertedReceipt;
}

async function main() {
  loadLocalEnv();

  const args = parseArgs(process.argv);
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tenantUserId = args["tenant-user-id"] || process.env.E2E_DEMO_TENANT_USER_ID;
  const projectId = args["project-id"] || process.env.E2E_DEMO_PROJECT_ID;
  const projectCode = args["project-code"] || process.env.E2E_DEMO_PROJECT_CODE;

  required(supabaseUrl, "SUPABASE_URL veya NEXT_PUBLIC_SUPABASE_URL gerekli.");
  required(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY gerekli. Frontend env icine koymayin.");

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`[E2E DEBUG] Baglanilan Supabase host: ${supabaseHost(supabaseUrl)}`);

  if (args["debug-users"]) {
    await printDebugUsers(supabase, Number(args["debug-users-count"] || 5));
    if (!args.confirm) {
      console.log("[E2E DEBUG] --debug-users modu veri olusturmadan tamamlandi.");
      return;
    }
  }

  required(tenantUserId, "--tenant-user-id veya E2E_DEMO_TENANT_USER_ID gerekli.");
  if (!args.confirm) {
    throw new Error("Guvenlik nedeniyle --confirm olmadan kayit olusturulmaz.");
  }
  if (!projectId && !projectCode && !args["create-project"]) {
    throw new Error("--project-id, --project-code veya --create-project gerekli.");
  }

  const userResult = await supabase.auth.admin.getUserById(tenantUserId);
  if (userResult.error || !userResult.data?.user) {
    let visibleUsers = [];
    try {
      visibleUsers = await listVisibleAuthUsers(supabase, 10);
    } catch (listError) {
      throw new Error(
        `Tenant kullanicisi auth.users icinde bulunamadi: ${tenantUserId}. Ayrica auth.users listelenemedi: ${listError.message}`,
      );
    }
    console.error("[E2E DEBUG] Bu service role ile gorunen kullanicilar:");
    console.error(JSON.stringify(visibleUsers, null, 2));
    throw new Error(
      `Tenant kullanicisi auth.users icinde bulunamadi: ${tenantUserId}. ` +
        `Bagli host: ${supabaseHost(supabaseUrl)}. Supabase URL/service role key ayni projeye ait mi kontrol edin.`,
    );
  }

  const { data: license } = await supabase
    .from("user_licenses")
    .select("plan_type, license_status")
    .eq("user_id", tenantUserId)
    .maybeSingle();

  const isDemoTenant = license?.plan_type === "demo";
  if (!isDemoTenant && !args["allow-test-tenant"]) {
    throw new Error("Tenant demo gorunmuyor. Guvenli test tenant ise --allow-test-tenant ile acik onay verin.");
  }

  const scenarioSeed = safeFileName(projectId || projectCode || "default-demo").slice(0, 32) || "default-demo";
  const runCode = `${TAG}-${scenarioSeed}`;
  const report = {
    runCode,
    tenantUserId,
    created: {
      suppliers: [],
      products: [],
      projectItems: [],
      requests: [],
      offers: [],
      reports: [],
      orders: [],
      documents: [],
      receipts: [],
      stockMovements: [],
      finances: [],
      supportTickets: [],
    },
    urls: {},
  };

  let project = null;
  if (projectId) {
    const result = await supabase.from("projects").select("*").eq("id", projectId).eq("user_id", tenantUserId).maybeSingle();
    project = ensureNoError(result, "Proje sorgulanamadi");
  } else if (projectCode) {
    const result = await supabase.from("projects").select("*").eq("project_code", projectCode).eq("user_id", tenantUserId).maybeSingle();
    project = ensureNoError(result, "Proje sorgulanamadi");
  }

  if (!project && args["create-project"]) {
    const demoProjectName = `${TAG} Akilli Fabrika Modernizasyonu`;
    const existingProject = await findOneByEquals(
      supabase,
      "projects",
      {
        user_id: tenantUserId,
        project_name: demoProjectName,
      },
    );
    if (existingProject) {
      project = existingProject;
      console.log(`[E2E DEBUG] projects mevcut demo proje kullanildi: ${project.id}`);
    } else {
      project = await insertOne(supabase, "projects", {
      user_id: tenantUserId,
      project_code: `${runCode}-PRJ`,
      project_name: demoProjectName,
      customer_name: `${TAG} Demo Musteri A.S.`,
      description: `${TAG} tarafindan olusturulan uctan uca demo proje.`,
      contract_amount: 1250000,
      contract_currency: "TRY",
      contract_exchange_rate: 1,
      contract_base_amount: 1250000,
      estimated_budget: 860000,
      estimated_budget_currency: "TRY",
      estimated_budget_exchange_rate: 1,
      estimated_budget_base_amount: 860000,
      start_date: today(-8),
      planned_end_date: today(45),
      project_owner: `${TAG} Demo Proje Yoneticisi`,
      status: "Aktif",
      });
    }
  }
  if (!project) throw new Error("Secilen proje bulunamadi.");
  report.project = { id: project.id, code: project.project_code, name: project.project_name };

  let projectItemsResult = await supabase
    .from("project_items")
    .select("*")
    .eq("user_id", tenantUserId)
    .eq("project_id", project.id)
    .order("created_at", { ascending: true })
    .limit(50);
  let projectItems = ensureNoError(projectItemsResult, "Proje kalemleri okunamadi") || [];

  if (projectItems.length === 0) {
    projectItems = await insertMany(
      supabase,
      "project_items",
      defaultItems.map((item) => ({
        user_id: tenantUserId,
        project_id: project.id,
        product_code: item.code,
        product_name: item.name,
        unit: item.unit,
        estimated_quantity: item.qty,
        estimated_unit_price: item.price,
        estimated_total: item.qty * item.price,
        estimated_total_base: item.qty * item.price,
        currency: "TRY",
        exchange_rate: 1,
        status: "Bekliyor",
        source_type: "e2e_demo",
        note: `${TAG} demo proje kalemi`,
      })),
    );
    report.created.projectItems = projectItems.map((item) => ({ id: item.id, code: item.product_code, name: item.product_name }));
  }

  const selectedItems = projectItems.slice(0, Math.max(4, Math.min(projectItems.length, 6)));

  const products = [];
  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index];
    const code = item.product_code || defaultItems[index]?.code || `E2E-PRD-${index + 1}`;
    const existing = await supabase
      .from("products")
      .select("*")
      .eq("user_id", tenantUserId)
      .eq("product_code", code)
      .maybeSingle();
    ensureNoError(existing, "Stok karti sorgulanamadi");

    if (existing.data) {
      products.push(existing.data);
      continue;
    }

    const qty = Number(item.estimated_quantity || defaultItems[index]?.qty || 1);
    const initialStock = index % 2 === 0 ? Math.floor(qty / 4) : Math.min(qty, Math.floor(qty * 0.8));
    const product = await insertOne(supabase, "products", {
      user_id: tenantUserId,
      product_code: code,
      product_name: item.product_name || defaultItems[index]?.name || `${TAG} Demo Urun`,
      brand: `${TAG} Marka`,
      unit: item.unit || "adet",
      category: `${TAG} Demo`,
      current_stock: initialStock,
      min_stock: 1,
      critical_stock: Math.max(1, Math.floor(qty / 5)),
      last_supplier: supplierNames[index % supplierNames.length],
      last_unit_price: Number(item.estimated_unit_price || defaultItems[index]?.price || 1000),
      manual_unit_price: Number(item.estimated_unit_price || defaultItems[index]?.price || 1000),
      last_currency: "TRY",
      source: "e2e-demo-scenario",
      notes: `${TAG} demo stok karti`,
    });
    products.push(product);
    report.created.products.push({ id: product.id, code: product.product_code, name: product.product_name });
  }

  const purchaseItems = selectedItems.map((item, index) => {
    const product = products[index];
    const estimatedQty = Number(item.estimated_quantity || defaultItems[index]?.qty || 1);
    const currentStock = Number(product.current_stock || 0);
    const purchaseQuantity = Math.max(1, estimatedQty - currentStock);
    return {
      product_id: product.id,
      product_code: product.product_code,
      normalized_product_code: product.normalized_product_code || product.product_code,
      product_name: product.product_name,
      brand: product.brand || "",
      unit: product.unit || item.unit || "adet",
      quantity: purchaseQuantity,
      talepEdilenAdet: purchaseQuantity,
      current_stock: currentStock,
      reserved_stock: Number(product.reserved_stock || 0),
      stock_coverable_quantity: Math.min(currentStock, estimatedQty),
      purchase_quantity: purchaseQuantity,
      estimated_unit_price: Number(item.estimated_unit_price || product.last_unit_price || 1000),
      allocations: [
        {
          projectId: project.id,
          projectCode: project.project_code,
          projectName: project.project_name,
          projectItemId: item.id,
          parentItemId: item.parent_item_id || null,
          requestedQuantity: estimatedQty,
          purchaseQuantity,
        },
      ],
    };
  });

  const requestName = `${TAG} ${project.project_code || project.project_name} Talep Listesi`;
  const request = await getOrCreateOne(supabase, "requests", {
    user_id: tenantUserId,
    project_id: project.id,
    ad: requestName,
  }, {
    user_id: tenantUserId,
    project_id: project.id,
    ad: requestName,
    durum: "Teklif Bekliyor",
    totalitems: purchaseItems.length,
    items: purchaseItems,
  });
  report.created.requests.push({ id: request.id, name: request.ad });

  const suppliers = [];
  for (const [index, name] of supplierNames.entries()) {
    const supplier = await getOrCreateOne(supabase, "suppliers", {
      user_id: tenantUserId,
      name,
    }, {
      user_id: tenantUserId,
      name,
      category: "Tedarikci",
      partner_type: "Tedarikçi",
      status: "Aktif",
      tax_no: `E2E${String(index + 1).padStart(7, "0")}`,
      contact_name: `${TAG} Yetkili ${index + 1}`,
      email: `demo${index + 1}@corvian-e2e.invalid`,
      phone: `+90 212 000 00 ${String(index + 1).padStart(2, "0")}`,
      score: 92 - index * 4,
      notes: `${TAG} demo tedarikci`,
    });
    suppliers.push(supplier);
  }
  report.created.suppliers = suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }));

  const offerGroups = makeOfferGroups(purchaseItems, suppliers);
  const rawOfferPayloads = suppliers.map((supplier, index) => {
    const supplierItems = offerGroups.map((group) => {
      const offer = group.offers[index];
      return {
        product_code: group.urunKodu,
        product_name: group.urunAciklamasi,
        quantity: group.purchaseQuantity,
        unit: group.birim,
        unit_price: offer.birimFiyat,
        discount: offer.iskonto,
        net_unit_price: offer.netBirimFiyat,
        total: offer.netToplam,
        currency: "TRY",
      };
    });
    const total = supplierItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const analysisPayload = { source: "e2e-demo-scenario", items: supplierItems };
    return {
      payload: {
        user_id: tenantUserId,
        project_id: project.id,
        request_id: request.id,
        supplier_name: supplier.name,
        partner_id: supplier.id,
        file_name: `${TAG} ${supplier.name} Teklif`,
        original_file_name: `${safeFileName(supplier.name)}-teklif.pdf`,
        status: "Analiz Edildi",
        currency: "TRY",
        exchange_rate: 1,
        total_amount: total,
        supplier_offer_amount: total,
        items: supplierItems,
        analysis: analysisPayload,
        data: analysisPayload,
        result: analysisPayload,
        report_data: analysisPayload,
      },
      supplier,
      total,
      supplierItems,
    };
  });
  const offerCandidateColumns = rawOfferPayloads.flatMap((entry) => Object.keys(entry.payload));
  const offerColumns = await detectTableColumns(supabaseUrl, serviceRoleKey, "offers", offerCandidateColumns);
  const offers = [];
  for (const entry of rawOfferPayloads) {
    const payload = prunePayloadForColumns("offers", entry.payload, offerColumns, ["user_id"]);
    const filters = buildOfferIdentityFilters(offerColumns, payload, entry);

    const offer = await getOrCreateOne(supabase, "offers", filters, payload);
    offers.push(offer);
  }
  report.created.offers = offers.map((offer, index) => ({
    id: offer.id,
    supplier: offer.supplier_name || rawOfferPayloads[index]?.supplier?.name,
    total: offer.total_amount || rawOfferPayloads[index]?.total,
  }));

  const comparisonReportName = `${TAG} Mukayese Raporu - ${project.project_code || project.project_name}`;
  const reportAnalysisPayload = offerGroups;
  const rawReportPayload = {
    user_id: tenantUserId,
    project_id: project.id,
    request_id: request.id,
    ad: comparisonReportName,
    durum: "Hazır",
    status: "Hazır",
    analysis: reportAnalysisPayload,
    data: reportAnalysisPayload,
    report_data: reportAnalysisPayload,
    result: reportAnalysisPayload,
    items: reportAnalysisPayload,
    onerilenFirma: offerGroups[0]?.bestOffer?.firmaAdi || suppliers[0].name,
    recommended_firm: offerGroups[0]?.bestOffer?.firmaAdi || suppliers[0].name,
    currency: "TRY",
    exchange_rate: 1,
    base_currency: "TRY",
    supplier_offer_amount: offerGroups.reduce((sum, group) => sum + Number(group.bestOffer?.netToplam || 0), 0),
    base_amount: offerGroups.reduce((sum, group) => sum + Number(group.bestOffer?.netToplamTRY || 0), 0),
  };
  const reportCandidateColumns = Object.keys(rawReportPayload);
  const reportColumns = await detectTableColumns(supabaseUrl, serviceRoleKey, "reports", reportCandidateColumns);
  const reportPayload = prunePayloadForColumns(
    "reports",
    pickReportPayloadColumns(reportColumns, rawReportPayload, reportAnalysisPayload),
    reportColumns,
    ["user_id"],
  );
  const reportFilters = buildIdentityFilters(
    reportColumns,
    reportPayload,
    ["user_id", "request_id", "project_id", "ad"],
    ["status", "durum", "currency", "supplier_offer_amount", "base_amount"],
  );
  const comparisonReport = await getOrCreateOne(supabase, "reports", reportFilters, reportPayload);
  report.created.reports.push({ id: comparisonReport.id, name: comparisonReport.ad || comparisonReportName });

  const comparisonAnalysis = Array.isArray(comparisonReport.analysis)
    ? comparisonReport.analysis
    : Array.isArray(comparisonReport.data)
      ? comparisonReport.data
      : Array.isArray(comparisonReport.report_data)
        ? comparisonReport.report_data
        : Array.isArray(comparisonReport.result)
          ? comparisonReport.result
          : Array.isArray(comparisonReport.items)
            ? comparisonReport.items
            : offerGroups;
  const orderItems = bestOrderItems({ ...comparisonReport, analysis: comparisonAnalysis }, suppliers);
  const bestSupplier = suppliers.find((supplier) => supplier.name === orderItems[0]?.supplierName) || suppliers[0];
  const orderTotal = orderItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const orderNo = `SIP-E2E-${safeFileName(project.project_code || project.id).slice(0, 24).toUpperCase()}`;
  const order = await getOrCreateOne(supabase, "orders", {
    user_id: tenantUserId,
    order_no: orderNo,
  }, {
    user_id: tenantUserId,
    order_no: orderNo,
    supplier_name: bestSupplier.name,
    partner_id: bestSupplier.id,
    partner_name: bestSupplier.name,
    partner_type: "Tedarikçi",
    product_name: `${TAG} ${orderItems.length} kalem demo siparis`,
    quantity: orderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    order_date: today(),
    termin_date: today(14),
    status: "Taslak",
    receipt_status: "Bekliyor",
    project_id: project.id,
    report_id: comparisonReport.id,
    items: orderItems,
    total_amount: orderTotal,
    original_amount: orderTotal,
    order_total: orderTotal,
    currency: "TRY",
    exchange_rate: 1,
    exchange_rate_date: today(),
    base_currency: "TRY",
    base_amount: orderTotal,
    order_total_base: orderTotal,
    remaining_amount: orderTotal,
    remaining_amount_base: orderTotal,
    note: `${TAG} mukayese raporundan olusturulan demo siparis`,
  });
  report.created.orders.push({ id: order.id, order_no: order.order_no, total: orderTotal });

  const invoiceRows = orderItems.map((item) => ({
    product_code: item.productCode,
    product_name: item.productName,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.netUnitPrice,
    total: item.total,
  }));

  for (const [index, offer] of offers.entries()) {
    const rawOffer = rawOfferPayloads[index];
    const supplierName = offer.supplier_name || rawOffer?.supplier?.name || `${TAG} Demo Tedarikci`;
    const offerItems = Array.isArray(offer.items) ? offer.items : rawOffer?.supplierItems || [];
    const offerTotal = Number(offer.total_amount || rawOffer?.total || 0);
    const offerDocument = await uploadDocument({
      supabase,
      supabaseUrl,
      serviceRoleKey,
      tenantUserId,
      project,
      order,
      type: "teklif",
      fileName: `${safeFileName(supplierName)}-teklif.pdf`,
      title: `${TAG} Tedarikci Teklifi`,
      lines: [`Tedarikci: ${supplierName}`, `Talep: ${request.ad}`, `Tarih: ${today()}`],
      rows: offerItems.map((item) => ({
        product_code: item.product_code,
        product_name: item.product_name,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.net_unit_price,
        total: item.total,
      })),
      documentNumber: `TEK-${safeFileName(project.project_code || project.id)}-${index + 1}`,
      supplierName,
      invoiceTotal: offerTotal,
    });
    report.created.documents.push({ id: offerDocument.id, file: offerDocument.original_file_name, type: "teklif" });
  }

  const comparisonDocument = await uploadDocument({
    supabase,
    supabaseUrl,
    serviceRoleKey,
    tenantUserId,
    project,
    order,
    type: "diger",
    fileName: `${safeFileName(project.project_code || project.id)}-mukayese-raporu.pdf`,
    title: `${TAG} Mukayese Raporu`,
    lines: [`Proje: ${project.project_code || project.project_name}`, `Talep: ${request.ad}`, `Onerilen firma: ${bestSupplier.name}`],
    rows: invoiceRows,
    documentNumber: `MUK-${safeFileName(project.project_code || project.id)}`,
    supplierName: bestSupplier.name,
    invoiceTotal: orderTotal,
  });
  report.created.documents.push({ id: comparisonDocument.id, file: comparisonDocument.original_file_name, type: "mukayese" });

  const deliveryDocument = await uploadDocument({
    supabase,
    supabaseUrl,
    serviceRoleKey,
    tenantUserId,
    project,
    order,
    type: "irsaliye",
    fileName: `${safeFileName(order.order_no)}-irsaliye.pdf`,
    title: `${TAG} Irsaliye`,
    lines: [`Irsaliye No: IRS-${safeFileName(order.order_no)}`, `Siparis No: ${order.order_no}`, `Tedarikci: ${bestSupplier.name}`, `Teslim tarihi: ${today(2)}`],
    rows: invoiceRows,
    documentNumber: `IRS-${safeFileName(order.order_no)}`,
    supplierName: bestSupplier.name,
  });
  report.created.documents.push({ id: deliveryDocument.id, file: deliveryDocument.original_file_name, type: "irsaliye" });

  const invoiceDocument = await uploadDocument({
    supabase,
    supabaseUrl,
    serviceRoleKey,
    tenantUserId,
    project,
    order,
    type: "fatura",
    fileName: `${safeFileName(order.order_no)}-fatura.pdf`,
    title: `${TAG} Fatura`,
    lines: [`Fatura No: FAT-${safeFileName(order.order_no)}`, `Siparis No: ${order.order_no}`, `Ara toplam: ${money(orderTotal)} TRY`, `KDV: ${money(orderTotal * 0.2)} TRY`, `Genel toplam: ${money(orderTotal * 1.2)} TRY`],
    rows: invoiceRows,
    documentNumber: `FAT-${safeFileName(order.order_no)}`,
    supplierName: bestSupplier.name,
    invoiceTotal: orderTotal,
  });
  report.created.documents.push({ id: invoiceDocument.id, file: invoiceDocument.original_file_name, type: "fatura" });

  const receiptRows = orderItems.map((item, index) => ({
    item,
    quantity: index === 0 ? Math.max(1, Math.floor(Number(item.quantity || 1) / 2)) : Number(item.quantity || 1),
  }));

  const existingReceipts = await supabase
    .from("order_receipts")
    .select("id")
    .eq("user_id", tenantUserId)
    .eq("order_id", order.id)
    .limit(1);
  const hasExistingReceipt = (ensureNoError(existingReceipts, "Mevcut teslim kayitlari sorgulanamadi") || []).length > 0;

  if (hasExistingReceipt) {
    console.log(`[E2E DEBUG] order_receipts mevcut teslimler kullanildi, RPC tekrar cagrilmadi: ${order.id}`);
  } else {
    for (const { item, quantity } of receiptRows) {
      const receiptResult = await supabase.rpc("record_order_stock_receipt", {
        p_order_id: order.id,
        p_product_id: item.productId,
        p_project_id: project.id,
        p_project_item_id: item.projectItemId,
        p_parent_item_id: item.parentItemId,
        p_partner_id: bestSupplier.id,
        p_report_id: comparisonReport.id,
        p_order_no: order.order_no,
        p_supplier_name: bestSupplier.name,
        p_product_code: item.productCode,
        p_product_name: item.productName,
        p_unit: item.unit,
        p_ordered_quantity: item.quantity,
        p_received_quantity: quantity,
        p_accepted_quantity: quantity,
        p_defective_quantity: 0,
        p_received_by: `${TAG} Depo Sorumlusu`,
        p_receipt_date: today(2),
        p_note: `${TAG} irsaliye bazli demo teslim`,
      });
      if (receiptResult.error) {
        const authRequired = String(receiptResult.error.message || "").includes("Oturum gerekli");
        if (!authRequired) {
          throw new Error(`Teslim alma RPC basarisiz: ${receiptResult.error.message}`);
        }

        console.warn("[UYARI] Teslim alma RPC service role oturumu kabul etmedi; yalnizca E2E siparis icin schema-aware fallback kullaniliyor.");
        await recordE2EDemoReceiptFallback({
          supabase,
          supabaseUrl,
          serviceRoleKey,
          tenantUserId,
          order,
          project,
          comparisonReport,
          bestSupplier,
          item,
          quantity,
        });
      }
    }

    const deliveredByRowId = new Map(receiptRows.map(({ item, quantity }) => [item.rowId, Number(quantity || 0)]));
    const nextItems = orderItems.map((item) => {
      const deliveredQuantity = Number(item.deliveredQuantity || 0) + Number(deliveredByRowId.get(item.rowId) || 0);
      return {
        ...item,
        deliveredQuantity,
        status: receiptStatusFor(deliveredQuantity, item.quantity),
      };
    });
    const nextDeliveredQuantity = nextItems.reduce((sum, row) => sum + Number(row.deliveredQuantity || 0), 0);
    const nextTotalQuantity = nextItems.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const nextOrderStatus = receiptStatusFor(nextDeliveredQuantity, nextTotalQuantity);

    await updateSchemaAware(
      supabase,
      supabaseUrl,
      serviceRoleKey,
      "orders",
      { id: order.id, user_id: tenantUserId },
      {
        items: nextItems,
        status: nextOrderStatus,
        receipt_status: nextOrderStatus === "Tam Teslim" ? "Depoda" : "Kısmi Teslim",
        received_total: nextDeliveredQuantity,
        defective_total: 0,
        delivery_date: nextOrderStatus === "Tam Teslim" ? today(2) : order.delivery_date,
        updated_at: new Date().toISOString(),
      },
    );
  }

  const refreshedOrder = await supabase.from("orders").select("*").eq("id", order.id).maybeSingle();
  const receipts = await supabase.from("order_receipts").select("*").eq("user_id", tenantUserId).eq("order_id", order.id);
  const movements = await supabase.from("stock_movements").select("*").eq("user_id", tenantUserId).eq("order_id", order.id);
  report.created.receipts = ensureNoError(receipts, "Teslim kayitlari okunamadi").map((row) => ({ id: row.id, product: row.product_name, quantity: row.received_quantity }));
  report.created.stockMovements = ensureNoError(movements, "Stok hareketleri okunamadi").map((row) => ({ id: row.id, product: row.product_name, quantity: row.quantity }));
  if (!refreshedOrder.error && refreshedOrder.data) {
    report.created.orders[0].status = refreshedOrder.data.status;
    report.created.orders[0].receipt_status = refreshedOrder.data.receipt_status;
  }

  const orderPayment = await getOrCreateOne(supabase, "order_payments", {
    user_id: tenantUserId,
    order_id: order.id,
    description: `${TAG} siparis avans odemesi`,
  }, {
    user_id: tenantUserId,
    order_id: order.id,
    project_id: project.id,
    partner_id: bestSupplier.id,
    supplier_name: bestSupplier.name,
    payment_date: today(7),
    amount: Math.round(orderTotal * 0.35),
    original_amount: Math.round(orderTotal * 0.35),
    currency: "TRY",
    exchange_rate: 1,
    base_currency: "TRY",
    base_amount: Math.round(orderTotal * 0.35),
    description: `${TAG} siparis avans odemesi`,
  });
  if (orderPayment) report.created.finances.push({ table: "order_payments", id: orderPayment.id, amount: orderPayment.amount });

  const projectExpense = await getOrCreateOne(supabase, "project_expenses", {
    user_id: tenantUserId,
    project_id: project.id,
    description: `${TAG} demo nakliye ve saha gideri`,
  }, {
    user_id: tenantUserId,
    project_id: project.id,
    expense_type: `${TAG} Lojistik`,
    expense_date: today(3),
    amount: 18500,
    original_amount: 18500,
    currency: "TRY",
    exchange_rate: 1,
    base_currency: "TRY",
    base_amount: 18500,
    description: `${TAG} demo nakliye ve saha gideri`,
  });
  if (projectExpense) report.created.finances.push({ table: "project_expenses", id: projectExpense.id, amount: projectExpense.amount });

  const projectPayment = await getOrCreateOne(supabase, "project_payments", {
    user_id: tenantUserId,
    project_id: project.id,
    description: `${TAG} demo musteri tahsilati`,
  }, {
    user_id: tenantUserId,
    project_id: project.id,
    payment_date: today(10),
    amount: 320000,
    original_amount: 320000,
    currency: "TRY",
    exchange_rate: 1,
    base_currency: "TRY",
    base_amount: 320000,
    payment_type: `${TAG} Musteri Tahsilati`,
    description: `${TAG} demo musteri tahsilati`,
  });
  if (projectPayment) report.created.finances.push({ table: "project_payments", id: projectPayment.id, amount: projectPayment.amount });

  const supportSubject = `${TAG} Siparis belge kontrolu`;
  const supportTicket = await getOrCreateOne(supabase, "support_tickets", {
    tenant_id: tenantUserId,
    subject: supportSubject,
  }, {
    tenant_id: tenantUserId,
    created_by: tenantUserId,
    customer_email: userResult.data.user.email,
    customer_name: userResult.data.user.user_metadata?.full_name || `${TAG} Demo Kullanici`,
    company_name: userResult.data.user.user_metadata?.company_name || `${TAG} Demo Firma`,
    subject: supportSubject,
    category: "Kullanım Desteği",
    priority: "Orta",
    status: "Yanıtlandı",
    last_message_at: new Date().toISOString(),
    last_admin_reply_at: new Date().toISOString(),
    last_customer_reply_at: new Date().toISOString(),
    unread_for_admin: 0,
    unread_for_customer: 1,
  });
  if (supportTicket) {
    const existingMessages = await supabase
      .from("support_messages")
      .select("id")
      .eq("ticket_id", supportTicket.id)
      .limit(1);
    const hasSupportMessages = (ensureNoError(existingMessages, "Destek mesajlari sorgulanamadi") || []).length > 0;
    if (!hasSupportMessages) {
      await maybeInsertOne(supabase, "support_messages", {
        ticket_id: supportTicket.id,
        sender_id: tenantUserId,
        sender_role: "customer",
        message: "Bu sipariste fatura ve irsaliye belgelerinin arsivde gorunup gorunmedigini kontrol eder misiniz?",
        attachments: null,
      });
      await maybeInsertOne(supabase, "support_messages", {
        ticket_id: supportTicket.id,
        sender_id: tenantUserId,
        sender_role: "admin",
        message: "Kontrol edildi, belgeler siparis detayinda basariyla goruntuleniyor.",
        attachments: null,
      });
    }
    report.created.supportTickets.push({ id: supportTicket.id, subject: supportTicket.subject });
  }

  report.urls = {
    project: `/dashboard/projeler/${project.id}`,
    request: `/dashboard/talepler?createdRequestId=${request.id}`,
    offers: `/dashboard/teklifler?requestId=${request.id}&projectId=${project.id}`,
    report: `/dashboard/raporlar/${comparisonReport.id}`,
    comparison: `/dashboard/raporlar/${comparisonReport.id}/mukayese`,
    order: `/dashboard/siparisler/${order.id}`,
    stock: "/dashboard/stok",
    finance: "/dashboard/finans",
    support: "/dashboard/yardim",
    ai: "/dashboard/ai-asistan",
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`\n[E2E DEMO HATA] ${error.message}`);
  process.exitCode = 1;
});
