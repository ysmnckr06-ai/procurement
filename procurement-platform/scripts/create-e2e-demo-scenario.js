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
  const storagePath = `${tenantUserId}/${order?.id || project.id}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
  const contentSha256 = sha256(buffer);

  const upload = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    cacheControl: "3600",
    contentType: "application/pdf",
    upsert: false,
  });
  if (upload.error) throw new Error(`PDF storage upload basarisiz: ${upload.error.message}`);

  try {
    const document = await insertOne(supabase, "documents", {
      user_id: tenantUserId,
      document_type: type,
      original_file_name: fileName,
      storage_bucket: BUCKET,
      storage_path: storagePath,
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
    });

    await insertOne(supabase, "document_links", {
      document_id: document.id,
      order_id: order?.id || null,
      project_id: project.id,
      user_id: tenantUserId,
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

async function main() {
  const args = parseArgs(process.argv);
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tenantUserId = args["tenant-user-id"] || process.env.E2E_DEMO_TENANT_USER_ID;
  const projectId = args["project-id"] || process.env.E2E_DEMO_PROJECT_ID;
  const projectCode = args["project-code"] || process.env.E2E_DEMO_PROJECT_CODE;

  required(supabaseUrl, "SUPABASE_URL veya NEXT_PUBLIC_SUPABASE_URL gerekli.");
  required(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY gerekli. Frontend env icine koymayin.");
  required(tenantUserId, "--tenant-user-id veya E2E_DEMO_TENANT_USER_ID gerekli.");
  if (!args.confirm) {
    throw new Error("Guvenlik nedeniyle --confirm olmadan kayit olusturulmaz.");
  }
  if (!projectId && !projectCode && !args["create-project"]) {
    throw new Error("--project-id, --project-code veya --create-project gerekli.");
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userResult = await supabase.auth.admin.getUserById(tenantUserId);
  if (userResult.error || !userResult.data?.user) {
    throw new Error(`Tenant kullanicisi auth.users icinde bulunamadi: ${tenantUserId}`);
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

  const runCode = `${TAG}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
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
    project = await insertOne(supabase, "projects", {
      user_id: tenantUserId,
      project_code: `${runCode}-PRJ`,
      project_name: `${TAG} Akilli Fabrika Modernizasyonu`,
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

  const request = await insertOne(supabase, "requests", {
    user_id: tenantUserId,
    project_id: project.id,
    ad: `${TAG} ${project.project_code || project.project_name} Talep Listesi`,
    durum: "Teklif Bekliyor",
    totalitems: purchaseItems.length,
    items: purchaseItems,
  });
  report.created.requests.push({ id: request.id, name: request.ad });

  const suppliers = await insertMany(
    supabase,
    "suppliers",
    supplierNames.map((name, index) => ({
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
    })),
  );
  report.created.suppliers = suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }));

  const offerGroups = makeOfferGroups(purchaseItems, suppliers);
  const offers = await insertMany(
    supabase,
    "offers",
    suppliers.map((supplier, index) => {
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
      return {
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
        analysis: { source: "e2e-demo-scenario", items: supplierItems },
      };
    }),
  );
  report.created.offers = offers.map((offer) => ({ id: offer.id, supplier: offer.supplier_name, total: offer.total_amount }));

  const comparisonReport = await insertOne(supabase, "reports", {
    user_id: tenantUserId,
    project_id: project.id,
    request_id: request.id,
    ad: `${TAG} Mukayese Raporu - ${project.project_code || project.project_name}`,
    durum: "Hazır",
    status: "Hazır",
    analysis: offerGroups,
    data: offerGroups,
    result: offerGroups,
    onerilenFirma: offerGroups[0]?.bestOffer?.firmaAdi || suppliers[0].name,
    recommended_firm: offerGroups[0]?.bestOffer?.firmaAdi || suppliers[0].name,
    currency: "TRY",
    exchange_rate: 1,
    base_currency: "TRY",
    supplier_offer_amount: offerGroups.reduce((sum, group) => sum + Number(group.bestOffer?.netToplam || 0), 0),
    base_amount: offerGroups.reduce((sum, group) => sum + Number(group.bestOffer?.netToplamTRY || 0), 0),
  });
  report.created.reports.push({ id: comparisonReport.id, name: comparisonReport.ad });

  const orderItems = bestOrderItems(comparisonReport, suppliers);
  const bestSupplier = suppliers.find((supplier) => supplier.name === orderItems[0]?.supplierName) || suppliers[0];
  const orderTotal = orderItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const orderNo = `SIP-${new Date().getFullYear()}-${runCode.slice(-6)}`;
  const order = await insertOne(supabase, "orders", {
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

  for (const offer of offers) {
    const offerDocument = await uploadDocument({
      supabase,
      tenantUserId,
      project,
      order,
      type: "teklif",
      fileName: `${safeFileName(offer.supplier_name)}-teklif.pdf`,
      title: `${TAG} Tedarikci Teklifi`,
      lines: [`Tedarikci: ${offer.supplier_name}`, `Talep: ${request.ad}`, `Tarih: ${today()}`],
      rows: (offer.items || []).map((item) => ({
        product_code: item.product_code,
        product_name: item.product_name,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.net_unit_price,
        total: item.total,
      })),
      documentNumber: `TEK-${runCode}-${offers.indexOf(offer) + 1}`,
      supplierName: offer.supplier_name,
      invoiceTotal: Number(offer.total_amount || 0),
    });
    report.created.documents.push({ id: offerDocument.id, file: offerDocument.original_file_name, type: "teklif" });
  }

  const comparisonDocument = await uploadDocument({
    supabase,
    tenantUserId,
    project,
    order,
    type: "diger",
    fileName: `${runCode}-mukayese-raporu.pdf`,
    title: `${TAG} Mukayese Raporu`,
    lines: [`Proje: ${project.project_code || project.project_name}`, `Talep: ${request.ad}`, `Onerilen firma: ${bestSupplier.name}`],
    rows: invoiceRows,
    documentNumber: `MUK-${runCode}`,
    supplierName: bestSupplier.name,
    invoiceTotal: orderTotal,
  });
  report.created.documents.push({ id: comparisonDocument.id, file: comparisonDocument.original_file_name, type: "mukayese" });

  const deliveryDocument = await uploadDocument({
    supabase,
    tenantUserId,
    project,
    order,
    type: "irsaliye",
    fileName: `${runCode}-irsaliye.pdf`,
    title: `${TAG} Irsaliye`,
    lines: [`Irsaliye No: IRS-${runCode}`, `Siparis No: ${order.order_no}`, `Tedarikci: ${bestSupplier.name}`, `Teslim tarihi: ${today(2)}`],
    rows: invoiceRows,
    documentNumber: `IRS-${runCode}`,
    supplierName: bestSupplier.name,
  });
  report.created.documents.push({ id: deliveryDocument.id, file: deliveryDocument.original_file_name, type: "irsaliye" });

  const invoiceDocument = await uploadDocument({
    supabase,
    tenantUserId,
    project,
    order,
    type: "fatura",
    fileName: `${runCode}-fatura.pdf`,
    title: `${TAG} Fatura`,
    lines: [`Fatura No: FAT-${runCode}`, `Siparis No: ${order.order_no}`, `Ara toplam: ${money(orderTotal)} TRY`, `KDV: ${money(orderTotal * 0.2)} TRY`, `Genel toplam: ${money(orderTotal * 1.2)} TRY`],
    rows: invoiceRows,
    documentNumber: `FAT-${runCode}`,
    supplierName: bestSupplier.name,
    invoiceTotal: orderTotal,
  });
  report.created.documents.push({ id: invoiceDocument.id, file: invoiceDocument.original_file_name, type: "fatura" });

  const receiptRows = orderItems.map((item, index) => ({
    item,
    quantity: index === 0 ? Math.max(1, Math.floor(Number(item.quantity || 1) / 2)) : Number(item.quantity || 1),
  }));

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
      throw new Error(`Teslim alma RPC basarisiz: ${receiptResult.error.message}`);
    }
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

  const orderPayment = await maybeInsertOne(supabase, "order_payments", {
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

  const projectExpense = await maybeInsertOne(supabase, "project_expenses", {
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

  const projectPayment = await maybeInsertOne(supabase, "project_payments", {
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

  const supportTicket = await maybeInsertOne(supabase, "support_tickets", {
    tenant_id: tenantUserId,
    created_by: tenantUserId,
    customer_email: userResult.data.user.email,
    customer_name: userResult.data.user.user_metadata?.full_name || `${TAG} Demo Kullanici`,
    company_name: userResult.data.user.user_metadata?.company_name || `${TAG} Demo Firma`,
    subject: `${TAG} Siparis belge kontrolu`,
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
