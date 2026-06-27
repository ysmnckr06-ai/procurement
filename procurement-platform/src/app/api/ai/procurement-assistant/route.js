import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const REQUIRED_HEADINGS = [
  "Proje Özeti",
  "Stoktan Karşılanabilirler",
  "Satınalma Gerekenler",
  "Maliyet Riski",
  "Önerilen Aksiyon",
];

function num(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/\s+/g, " ");
}

function normalizeCode(value) {
  return String(value || "").trim().toLocaleUpperCase("tr-TR").replace(/\s+/g, "");
}

function compactName(value, fallback = "-") {
  const text = String(value || "").trim();
  return text ? text.slice(0, 140) : fallback;
}

function moneyBucket(total, currency = "TRY") {
  return {
    amount: Number(num(total).toFixed(2)),
    currency: currency || "TRY",
  };
}

async function readOwnRows(supabase, table, userId, options = {}) {
  const query = supabase.from(table).select(options.select || "*").eq("user_id", userId);
  if (options.limit) query.limit(options.limit);
  if (options.order) query.order(options.order.column, { ascending: options.order.ascending });

  const { data, error } = await query;
  if (error) {
    const message = String(error.message || "");
    if (message.includes("does not exist") || message.includes("Could not find the table")) {
      return [];
    }
    throw new Error(`${table}: ${message}`);
  }
  return data || [];
}

function findMentionedProject(projects, question) {
  const normalizedQuestion = normalizeText(question);
  const normalizedCodeQuestion = normalizeCode(question);

  const exactCodeMatch = projects.find((project) => {
    const code = normalizeCode(project.project_code);
    return code && normalizedCodeQuestion.includes(code);
  });
  if (exactCodeMatch) return exactCodeMatch;

  return projects.find((project) => {
    const code = normalizeText(project.project_code);
    const name = normalizeText(project.project_name);
    return (
      (code && normalizedQuestion.includes(code)) ||
      (name && (normalizedQuestion.includes(name) || name.includes(normalizedQuestion)))
    );
  }) || null;
}

function projectDisplay(project) {
  if (!project) return "Tüm projeler";
  return [project.project_code, project.project_name].filter(Boolean).join(" - ");
}

function productKeyFromRow(row) {
  const code = normalizeCode(row.product_code || row.productCode || row.urunKodu);
  if (code) return `code:${code}`;
  return `name:${normalizeText(row.product_name || row.productName || row.urunAciklamasi || row.name)}`;
}

function buildProductLookup(products) {
  const byKey = new Map();
  products.forEach((product) => {
    const codeKey = productKeyFromRow(product);
    if (codeKey !== "name:") byKey.set(codeKey, product);
    const nameKey = `name:${normalizeText(product.product_name)}`;
    if (nameKey !== "name:") byKey.set(nameKey, product);
  });
  return byKey;
}

function flattenOrderItems(orders, orderItems) {
  const embedded = orders.flatMap((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    return items.map((item) => ({
      ...item,
      order_id: order.id,
      project_id: order.project_id,
      order_no: order.order_no || order.orderNo || order.id,
      supplier_name: order.supplier_name || order.company || order.partner_name || "",
      status: order.status || "",
      currency: item.currency || order.currency || "TRY",
    }));
  });

  return [...embedded, ...orderItems];
}

function itemQuantity(item) {
  return num(
    item.estimated_quantity ??
      item.quantity ??
      item.miktar ??
      item.qty ??
      item.talepEdilenAdet,
  );
}

function itemUnitPrice(item) {
  return num(
    item.estimated_unit_price ??
      item.unit_price ??
      item.unitPrice ??
      item.birimFiyat ??
      item.netUnitPrice,
  );
}

function itemTotal(item) {
  const explicit = num(
    item.estimated_total ??
      item.total ??
      item.quote_total ??
      item.net_total ??
      item.netTotal,
  );
  if (explicit > 0) return explicit;
  return itemQuantity(item) * itemUnitPrice(item);
}

function summarizeStock({ selectedItems, products, stockMovements }) {
  const productLookup = buildProductLookup(products);
  const stockByKey = new Map();

  products.forEach((product) => {
    const key = productKeyFromRow(product);
    if (!key || key === "name:") return;
    stockByKey.set(key, {
      productCode: product.product_code || "",
      productName: product.product_name || "",
      unit: product.unit || "adet",
      currentStock: num(product.current_stock),
      reservedStock: num(product.reserved_stock),
      freeStock: Math.max(num(product.current_stock) - num(product.reserved_stock), 0),
      criticalStock: num(product.critical_stock || product.min_stock),
      lastUnitPrice: num(product.last_unit_price || product.manual_unit_price),
      currency: product.last_currency || "TRY",
      incoming: 0,
      outgoing: 0,
    });
  });

  stockMovements.forEach((movement) => {
    const key = productKeyFromRow(movement);
    const row = stockByKey.get(key);
    if (!row) return;
    const quantity = num(movement.quantity);
    const type = normalizeText(movement.movement_type);
    if (type.includes("out") || type.includes("cikis") || type.includes("çıkış")) {
      row.outgoing += quantity;
    } else {
      row.incoming += quantity;
    }
  });

  const demandByKey = new Map();
  selectedItems.forEach((item) => {
    const product = item.product_id
      ? products.find((row) => row.id === item.product_id)
      : productLookup.get(productKeyFromRow(item));
    const key = product ? productKeyFromRow(product) : productKeyFromRow(item);
    if (!key || key === "name:") return;

    const existing = demandByKey.get(key) || {
      productCode: product?.product_code || item.product_code || "",
      productName: product?.product_name || item.product_name || "",
      unit: product?.unit || item.unit || "adet",
      requiredQuantity: 0,
      reservedQuantity: 0,
      receivedQuantity: 0,
      estimatedTotal: 0,
    };

    existing.requiredQuantity += itemQuantity(item);
    existing.reservedQuantity += num(item.reserved_quantity);
    existing.receivedQuantity += num(item.received_quantity);
    existing.estimatedTotal += itemTotal(item);
    demandByKey.set(key, existing);
  });

  const availability = new Map(
    [...stockByKey.entries()].map(([key, value]) => [key, value.freeStock]),
  );

  const rows = [...demandByKey.entries()].map(([key, demand]) => {
    const stock = stockByKey.get(key) || {};
    const remainingNeed = Math.max(
      demand.requiredQuantity - demand.reservedQuantity - demand.receivedQuantity,
      0,
    );
    const freeStock = Math.max(num(availability.get(key)), 0);
    const stockCoverable = Math.min(freeStock, remainingNeed);
    availability.set(key, freeStock - stockCoverable);
    const purchaseRequired = Math.max(remainingNeed - stockCoverable, 0);

    return {
      productCode: demand.productCode,
      productName: compactName(demand.productName, "Ürün"),
      unit: demand.unit,
      requiredQuantity: Number(demand.requiredQuantity.toFixed(2)),
      reservedQuantity: Number(demand.reservedQuantity.toFixed(2)),
      receivedQuantity: Number(demand.receivedQuantity.toFixed(2)),
      freeStockBeforeAllocation: Number(freeStock.toFixed(2)),
      stockCoverable: Number(stockCoverable.toFixed(2)),
      purchaseRequired: Number(purchaseRequired.toFixed(2)),
      criticalStock: num(stock.criticalStock),
      estimatedTotal: moneyBucket(demand.estimatedTotal),
    };
  });

  return {
    sampleRows: rows.slice(0, 30),
    totals: {
      lineCount: rows.length,
      requiredQuantity: Number(rows.reduce((sum, row) => sum + row.requiredQuantity, 0).toFixed(2)),
      stockCoverableQuantity: Number(rows.reduce((sum, row) => sum + row.stockCoverable, 0).toFixed(2)),
      purchaseRequiredQuantity: Number(rows.reduce((sum, row) => sum + row.purchaseRequired, 0).toFixed(2)),
      criticalLineCount: rows.filter((row) => row.purchaseRequired > 0 || row.freeStockBeforeAllocation <= row.criticalStock).length,
    },
    stockCoverableTop: rows.filter((row) => row.stockCoverable > 0).slice(0, 12),
    purchaseRequiredTop: rows.filter((row) => row.purchaseRequired > 0).slice(0, 12),
  };
}

function lineBelongsToProjects(line, projectIds) {
  if (projectIds.has(line.project_id)) return true;
  const allocations = Array.isArray(line.allocations) ? line.allocations : [];
  return allocations.some((allocation) =>
    projectIds.has(allocation.projectId || allocation.project_id),
  );
}

function summarizePrices({ quoteItems, orders, orderItems, projectIds }) {
  const relevantQuoteItems = quoteItems.filter((item) => lineBelongsToProjects(item, projectIds));
  const relevantOrderItems = flattenOrderItems(
    orders.filter((order) => projectIds.has(order.project_id)),
    orderItems.filter((item) => lineBelongsToProjects(item, projectIds)),
  ).filter((item) => lineBelongsToProjects(item, projectIds));

  const quoteTotal = relevantQuoteItems.reduce((sum, item) => sum + itemTotal(item), 0);
  const orderTotal = orders
    .filter((order) => projectIds.has(order.project_id))
    .reduce((sum, order) => sum + num(order.order_total_base || order.base_amount || order.order_total || order.total_amount), 0);

  const orderedLineTotal = relevantOrderItems.reduce((sum, item) => sum + itemTotal(item), 0);
  const unitPrices = [...relevantQuoteItems, ...relevantOrderItems]
    .map(itemUnitPrice)
    .filter((value) => value > 0);

  return {
    quote: {
      lineCount: relevantQuoteItems.length,
      total: moneyBucket(quoteTotal),
    },
    order: {
      orderCount: orders.filter((order) => projectIds.has(order.project_id)).length,
      lineCount: relevantOrderItems.length,
      total: moneyBucket(orderTotal || orderedLineTotal),
    },
    unitPrice: {
      min: unitPrices.length ? Number(Math.min(...unitPrices).toFixed(2)) : 0,
      max: unitPrices.length ? Number(Math.max(...unitPrices).toFixed(2)) : 0,
      average: unitPrices.length
        ? Number((unitPrices.reduce((sum, value) => sum + value, 0) / unitPrices.length).toFixed(2))
        : 0,
    },
    openOrders: orders
      .filter((order) => projectIds.has(order.project_id))
      .filter((order) => !["Tam Teslim", "Teslim Edildi", "İptal"].includes(order.status))
      .slice(0, 8)
      .map((order) => ({
        orderNo: order.order_no || order.orderNo || order.id,
        supplier: compactName(order.supplier_name || order.partner_name || order.company),
        status: order.status || "-",
        total: moneyBucket(num(order.order_total_base || order.base_amount || order.order_total || order.total_amount), order.base_currency || order.currency || "TRY"),
      })),
  };
}

function summarizeProjects(projects, selectedProject, selectedItems) {
  const selectedProjects = selectedProject ? [selectedProject] : projects.slice(0, 20);
  const selectedProjectIds = new Set(selectedProjects.map((project) => project.id));
  const itemRows = selectedItems.filter((item) => selectedProjectIds.has(item.project_id));

  return {
    scope: selectedProject ? "matched_project" : "all_projects",
    matchedProject: selectedProject
      ? {
          code: selectedProject.project_code || "",
          name: selectedProject.project_name || "",
          customer: selectedProject.customer_name || "",
          status: selectedProject.status || "",
          plannedEndDate: selectedProject.planned_end_date || null,
          contract: moneyBucket(selectedProject.contract_base_amount || selectedProject.contract_amount, selectedProject.contract_currency || "TRY"),
          budget: moneyBucket(selectedProject.estimated_budget_base_amount || selectedProject.estimated_budget, selectedProject.estimated_budget_currency || "TRY"),
          actualCost: moneyBucket(selectedProject.actual_cost || 0),
        }
      : null,
    projectCount: selectedProjects.length,
    projectNames: selectedProjects.slice(0, 8).map(projectDisplay),
    itemCount: itemRows.length,
    totalEstimatedNeed: moneyBucket(itemRows.reduce((sum, item) => sum + itemTotal(item), 0)),
  };
}

function ensureHeadings(answer) {
  const text = String(answer || "").trim();
  if (REQUIRED_HEADINGS.every((heading) => text.includes(heading))) return text;

  return REQUIRED_HEADINGS.map((heading) => `## ${heading}\n${heading === "Önerilen Aksiyon" ? text || "Analiz üretilemedi." : "Verilen özetten net sonuç çıkarılamadı."}`).join("\n\n");
}

export async function POST(request) {
  try {
    const { question } = await request.json();
    const cleanedQuestion = String(question || "").trim().slice(0, 1200);

    if (!cleanedQuestion) {
      return NextResponse.json({ error: "Lütfen bir soru yazın." }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI Asistan yapılandırması eksik. OPENAI_API_KEY tanımlandıktan sonra analiz üretebilir." },
        { status: 503 },
      );
    }

    const [
      projects,
      projectItems,
      products,
      quoteItems,
      orders,
      orderItems,
      stockMovements,
    ] = await Promise.all([
      readOwnRows(supabase, "projects", user.id, { order: { column: "updated_at", ascending: false } }),
      readOwnRows(supabase, "project_items", user.id),
      readOwnRows(supabase, "products", user.id),
      readOwnRows(supabase, "quote_items", user.id),
      readOwnRows(supabase, "orders", user.id),
      readOwnRows(supabase, "order_items", user.id),
      readOwnRows(supabase, "stock_movements", user.id, { limit: 1000 }),
    ]);

    const matchedProject = findMentionedProject(projects, cleanedQuestion);
    const selectedProjects = matchedProject ? [matchedProject] : projects.slice(0, 20);
    const selectedProjectIds = new Set(selectedProjects.map((project) => project.id));
    const selectedItems = projectItems.filter((item) => selectedProjectIds.has(item.project_id));
    const selectedMovements = stockMovements.filter((movement) =>
      !movement.project_id || selectedProjectIds.has(movement.project_id),
    );

    const stockSummary = summarizeStock({
      selectedItems,
      products,
      stockMovements: selectedMovements,
    });
    const priceSummary = summarizePrices({
      quoteItems,
      orders,
      orderItems,
      projectIds: selectedProjectIds,
    });

    const assistantContext = {
      question: cleanedQuestion,
      generatedAt: new Date().toISOString(),
      readOnlyGuarantee: "Bu route sadece select işlemi yapar; sipariş, stok, fiyat veya ürün kaydı değiştirmez.",
      projectSummary: summarizeProjects(projects, matchedProject, selectedItems),
      stockSummary,
      priceSummary,
      dataCoverage: {
        projects: projects.length,
        project_items: projectItems.length,
        products: products.length,
        quote_items: quoteItems.length,
        orders: orders.length,
        order_items: orderItems.length,
        stock_movements: stockMovements.length,
      },
    };

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.2,
        max_output_tokens: 900,
        input: [
          {
            role: "system",
            content:
              "Sen Corvian içinde çalışan read-only bir satınalma asistanısın. Türkçe, sade ve satınalma yöneticisi gibi konuş. Sadece analiz ve öneri üret. Veritabanına yazma, stok düşme, sipariş oluşturma, ürün silme veya fiyat değiştirme işlemi yaptığını asla söyleme. Cevabı yalnızca şu başlıklarla ver: Proje Özeti, Stoktan Karşılanabilirler, Satınalma Gerekenler, Maliyet Riski, Önerilen Aksiyon.",
          },
          {
            role: "user",
            content: `Kullanıcı sorusu: ${cleanedQuestion}\n\nHam veritabanı değil, özet operasyon verisi:\n${JSON.stringify(assistantContext, null, 2)}`,
          },
        ],
      }),
    });

    const openAiPayload = await openAiResponse.json();
    if (!openAiResponse.ok) {
      return NextResponse.json(
        { error: openAiPayload?.error?.message || "OpenAI yanıtı alınamadı." },
        { status: 502 },
      );
    }

    const answer = ensureHeadings(
      openAiPayload.output_text ||
        openAiPayload.output?.flatMap((item) => item.content || [])
          .map((content) => content.text || "")
          .join("\n"),
    );

    return NextResponse.json({
      answer,
      matchedProject: matchedProject
        ? {
            id: matchedProject.id,
            code: matchedProject.project_code,
            name: matchedProject.project_name,
          }
        : null,
      summary: {
        scope: matchedProject ? "project" : "all_projects",
        purchaseRequiredLines: stockSummary.purchaseRequiredTop.length,
        stockCoverableLines: stockSummary.stockCoverableTop.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "AI asistan çalıştırılamadı." },
      { status: 500 },
    );
  }
}
