// Yeni hesaplar için "örnek verilerle dene" paketi: birkaç stok kartı, iki
// tedarikçi, bir müşteri ve üç proje. Örnek kayıtlar işaretlidir ve tek tuşla
// silinebilir; kullanıcının kendi kayıtlarına dokunulmaz.
export const DEMO_SOURCE = "Örnek veri";
export const DEMO_PREFIX = "ÖRNEK";
const DEMO_PROJECT_MARK = "[ÖRNEK]";

const DEMO_PRODUCTS = [
  ["ORN-SLT-16A", "Schneider", "Otomatik Şalter 16A B 1K", 120, 30, 118.5, "TRY"],
  ["ORN-SLT-25A", "Schneider", "Otomatik Şalter 25A C 3K", 40, 10, 465.0, "TRY"],
  ["ORN-SLT-63A", "ABB", "Otomatik Şalter 63A C 3K", 6, 5, 1240.0, "TRY"],
  ["ORN-KAR-40A", "Siemens", "Kaçak Akım Rölesi 40A 30mA 4K", 18, 5, 1890.0, "TRY"],
  ["ORN-KNT-25A", "Schneider", "Kontaktör 25A 220V 3P", 22, 6, 1325.0, "TRY"],
  ["ORN-KNT-40A", "Schneider", "Kontaktör 40A 220V 3P", 0, 4, 2150.0, "TRY"],
  ["ORN-AKT-200", "Entes", "Akım Trafosu 200/5 Kl0.5", 30, 6, 410.0, "TRY"],
  ["ORN-ENR-ANA", "Entes", "Enerji Analizörü MPR63", 3, 2, 145.0, "EUR"],
  ["ORN-KMP-RLE", "Entes", "Kompanzasyon Rölesi RG3-12", 4, 2, 98.0, "EUR"],
  ["ORN-KND-25", "Epcos", "Kondansatör 25 kVAr 440V", 12, 6, 3150.0, "TRY"],
  ["ORN-SNY-YSL", "Emas", "Sinyal Lambası Yeşil 22mm 220V", 200, 40, 38.0, "TRY"],
  ["ORN-SNY-KRM", "Emas", "Sinyal Lambası Kırmızı 22mm 220V", 180, 40, 38.0, "TRY"],
  ["ORN-BUT-ACL", "Emas", "Acil Stop Butonu 22mm", 25, 10, 145.0, "TRY"],
  ["ORN-KLM-4MM", "Phoenix", "Ray Klemens 4mm Gri", 900, 200, 14.5, "TRY"],
  ["ORN-KLM-16", "Phoenix", "Ray Klemens 16mm Gri", 60, 40, 62.0, "TRY"],
  ["ORN-KBL-4X10", "Öznur", "NYY Kablo 4x10 mm²", 150, 100, 285.0, "TRY"],
  ["ORN-BAR-30X5", "Yerli", "Bakır Bara 30x5 mm", 24, 12, 1450.0, "TRY"],
  ["ORN-PNO-6080", "Yerli", "Pano Gövdesi 60x80x25 IP54", 2, 2, 6800.0, "TRY"],
  ["ORN-PNO-80120", "Yerli", "Pano Gövdesi 80x120x30 IP54", 0, 1, 11200.0, "TRY"],
  ["ORN-NH-160", "ABB", "NH Bıçaklı Sigorta 160A NH1", 9, 6, 210.0, "TRY"],
];

const DEMO_PROJECTS = [
  {
    name: "ÖRNEK · Otel Ana Dağıtım Panosu",
    status: "Devam Ediyor",
    contract: 485000,
    budget: 360000,
    items: [["ORN-SLT-16A", 48], ["ORN-SLT-63A", 8], ["ORN-KAR-40A", 6], ["ORN-KNT-40A", 4], ["ORN-AKT-200", 9], ["ORN-ENR-ANA", 2], ["ORN-KLM-4MM", 320], ["ORN-BAR-30X5", 10], ["ORN-PNO-80120", 2]],
  },
  {
    name: "ÖRNEK · Fabrika Kompanzasyon Panosu",
    status: "Onaylandı",
    contract: 265000,
    budget: 198000,
    items: [["ORN-KND-25", 16], ["ORN-KMP-RLE", 1], ["ORN-KNT-25A", 16], ["ORN-NH-160", 6], ["ORN-PNO-6080", 1], ["ORN-KBL-4X10", 40]],
  },
  {
    name: "ÖRNEK · AVM Aydınlatma Panoları",
    status: "Taslak",
    contract: 142000,
    budget: 101000,
    items: [["ORN-SLT-16A", 60], ["ORN-SLT-25A", 12], ["ORN-SNY-YSL", 24], ["ORN-SNY-KRM", 24], ["ORN-BUT-ACL", 6], ["ORN-KLM-16", 80]],
  },
];

const DEMO_PARTNERS = [
  ["Örnek Elektrik Malzemeleri Ltd.", "Tedarikçi", "İzmir"],
  ["Örnek Pano ve Bara Ltd.", "Tedarikçi", "Ankara"],
  ["Örnek Otelcilik A.Ş.", "Müşteri", "Antalya"],
];

export async function hasDemoData(supabase, userId) {
  const { count } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("source", DEMO_SOURCE);
  return Number(count || 0) > 0;
}

async function nextProjectCodes(supabase, userId, count) {
  const { data } = await supabase.from("projects").select("project_code").eq("user_id", userId);
  const used = new Set((data || []).map((row) => row.project_code));
  const codes = [];
  for (let n = 1; codes.length < count && n < 100000; n += 1) {
    const code = `PRJ-${String(n).padStart(5, "0")}`;
    if (!used.has(code)) codes.push(code);
  }
  return codes;
}

export async function loadDemoData(supabase, userId, { eurRate = 50 } = {}) {
  if (await hasDemoData(supabase, userId)) return { ok: false, message: "Örnek veriler zaten yüklü." };
  const now = new Date().toISOString();

  const { data: products, error: productError } = await supabase
    .from("products")
    .insert(DEMO_PRODUCTS.map(([code, brand, name, stock, critical, price, currency]) => ({
      user_id: userId,
      product_code: code,
      normalized_product_code: code,
      product_name: name,
      brand,
      unit: name.includes("Kablo") ? "metre" : "adet",
      product_type: "component",
      category: "Alt Ürün",
      current_stock: stock,
      reserved_stock: 0,
      min_stock: 0,
      critical_stock: critical,
      last_unit_price: price,
      manual_unit_price: price,
      last_currency: currency,
      source: DEMO_SOURCE,
      notes: "Örnek veri — Ayarlar'dan tek tuşla silinebilir.",
      updated_at: now,
    })))
    .select("id,product_code,product_name,brand,unit,last_unit_price,last_currency");
  if (productError) return { ok: false, message: `Örnek stok kartları eklenemedi: ${productError.message}` };
  const productByCode = new Map(products.map((product) => [product.product_code, product]));

  await supabase.from("suppliers").insert(DEMO_PARTNERS.map(([name, type, city]) => ({
    user_id: userId,
    name,
    firma_adi: name,
    partner_type: type,
    category: type,
    status: "Aktif",
    city,
  })));

  const codes = await nextProjectCodes(supabase, userId, DEMO_PROJECTS.length);
  const start = new Date();
  const end = new Date(Date.now() + 75 * 86400000);
  for (const [index, project] of DEMO_PROJECTS.entries()) {
    const { data: created, error: projectError } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        project_code: codes[index],
        project_name: project.name,
        customer_name: "Örnek Otelcilik A.Ş.",
        customer_partner_name: "Örnek Otelcilik A.Ş.",
        description: `${DEMO_PROJECT_MARK} Örnek proje; Ayarlar'dan silinebilir.`,
        contract_amount: project.contract,
        contract_currency: "TRY",
        contract_exchange_rate: 1,
        contract_base_amount: project.contract,
        estimated_budget: project.budget,
        estimated_budget_currency: "TRY",
        estimated_budget_exchange_rate: 1,
        estimated_budget_base_amount: project.budget,
        start_date: start.toISOString().slice(0, 10),
        planned_end_date: end.toISOString().slice(0, 10),
        project_owner: "Örnek Sorumlu",
        status: project.status,
        actual_cost: 0,
        updated_at: now,
      })
      .select("id")
      .single();
    if (projectError) return { ok: false, message: `Örnek proje eklenemedi: ${projectError.message}` };

    const { error: itemError } = await supabase.from("project_items").insert(project.items.map(([code, quantity]) => {
      const product = productByCode.get(code);
      const price = Number(product?.last_unit_price || 0);
      const currency = product?.last_currency || "TRY";
      const rate = currency === "TRY" ? 1 : eurRate;
      return {
        user_id: userId,
        project_id: created.id,
        product_id: product?.id || null,
        product_code: code,
        product_name: product?.product_name || code,
        brand: product?.brand || "",
        unit: product?.unit || "adet",
        estimated_quantity: quantity,
        estimated_unit_price: price,
        quote_unit_price: price,
        estimated_total: price * quantity,
        quote_total: price * quantity,
        currency,
        exchange_rate: rate,
        status: "Bekliyor",
        item_type: "standalone",
        note: DEMO_SOURCE,
        updated_at: now,
      };
    }));
    if (itemError) return { ok: false, message: `Örnek proje malzemeleri eklenemedi: ${itemError.message}` };
  }

  return { ok: true, message: "Örnek veriler yüklendi: 20 stok kartı, 3 proje, 3 iş ortağı." };
}

export async function removeDemoData(supabase, userId) {
  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .like("description", `${DEMO_PROJECT_MARK}%`);
  const projectIds = (projects || []).map((project) => project.id);

  if (projectIds.length > 0) {
    const [{ count: orderCount }, { count: requestCount }] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("user_id", userId).in("project_id", projectIds),
      supabase.from("requests").select("id", { count: "exact", head: true }).eq("user_id", userId).in("project_id", projectIds),
    ]);
    if (Number(orderCount || 0) + Number(requestCount || 0) > 0) {
      return {
        ok: false,
        message: "Örnek projelerde talep veya sipariş oluşturduğunuz için otomatik silinemiyor. Önce bu talep/siparişleri silin.",
      };
    }
  }

  const { data: products } = await supabase.from("products").select("id").eq("user_id", userId).eq("source", DEMO_SOURCE);
  const productIds = (products || []).map((product) => product.id);

  if (projectIds.length > 0) {
    await supabase.from("stock_movements").delete().eq("user_id", userId).in("project_id", projectIds);
    await supabase.from("project_items").delete().eq("user_id", userId).in("project_id", projectIds);
    const { error } = await supabase.from("projects").delete().eq("user_id", userId).in("id", projectIds);
    if (error) return { ok: false, message: `Örnek projeler silinemedi: ${error.message}` };
  }
  if (productIds.length > 0) {
    await supabase.from("stock_movements").delete().eq("user_id", userId).in("product_id", productIds);
    const { error } = await supabase.from("products").delete().eq("user_id", userId).in("id", productIds);
    if (error) return { ok: false, message: `Örnek stok kartları silinemedi: ${error.message}` };
  }
  await supabase.from("suppliers").delete().eq("user_id", userId).in("name", DEMO_PARTNERS.map(([name]) => name));
  return { ok: true, message: "Örnek veriler silindi." };
}
