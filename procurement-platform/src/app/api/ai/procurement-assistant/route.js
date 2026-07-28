import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const QUESTIONS = {
  system_overview: { title: "Sistemin genel durumu", description: "Projelerden teslimatlara kadar açık işlerin kısa özeti." },
  stock_risk: { title: "Riskli stoklar", description: "Kullanılabilir stoğu kritik seviyede veya tükenmiş ürünler." },
  stock_coverage: { title: "Stoktan karşılanabilecek ihtiyaçlar", description: "Mevcut stokla karşılanabilecek proje ihtiyaçları." },
  request_queue: { title: "İşlem bekleyen talepler", description: "Henüz teklif veya sipariş aşamasına ilerlememiş talepler." },
  offer_waiting: { title: "Teklif bekleyen işler", description: "Talep açılmış fakat yeterli teklif alınmamış işler." },
  comparison_gaps: { title: "Mukayese kontrolü", description: "Eksik teklif, eksik miktar ve inceleme gerektiren kalemler." },
  open_orders: { title: "Açık ve geciken siparişler", description: "Teslimatı tamamlanmamış veya termini aşılmış siparişler." },
  delivery_gaps: { title: "Eksik teslimatlar", description: "Sipariş edilen ve teslim alınan miktarlar arasındaki fark." },
  cost_hotspots: { title: "Yüksek maliyetli kalemler", description: "Tutarı en yüksek ürün ve sipariş kalemleri." },
  data_quality: { title: "Veri kalitesi kontrolü", description: "Eksik kod, fiyat, para birimi, termin veya firma bilgileri." },
};

const n = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
};
const text = (value, fallback = "-") => String(value || "").trim() || fallback;
const money = (value, currency = "TRY") => `${n(value).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ${currency}`;
const dateValue = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

async function rows(supabase, table, userId) {
  const { data, error } = await supabase.from(table).select("*").eq("user_id", userId);
  if (!error) return data || [];
  const message = String(error.message || "");
  if (message.includes("does not exist") || message.includes("Could not find")) return [];
  throw new Error(`${table}: ${message}`);
}

function embeddedItems(records) {
  return records.flatMap((record) =>
    (Array.isArray(record.items) ? record.items : []).map((item) => ({ ...item, parent: record })),
  );
}

function productIdentity(item) {
  return text(item.product_code || item.code || item.urunKodu || item.product_name || item.name, "Ürün bilgisi yok");
}

function requestItems(requests) {
  return embeddedItems(requests).map((item) => ({
    ...item,
    requestNo: item.parent.request_no || item.parent.request_number || item.parent.no || item.parent.id,
    requestStatus: item.parent.status || item.parent.durum,
  }));
}

function orderItems(orders, storedItems) {
  const embedded = embeddedItems(orders).map((item) => ({
    ...item,
    orderNo: item.parent.order_no || item.parent.order_number || item.parent.id,
    supplier: item.parent.supplier_name || item.parent.partner_name || item.parent.company,
    termin: item.parent.termin_date || item.parent.delivery_date,
    orderStatus: item.parent.status || item.parent.durum,
    currency: item.currency || item.parent.currency || "TRY",
  }));
  return [...embedded, ...storedItems];
}

function response(questionId, headline, summary, metrics, columns, resultRows, findings, actions, emptyMessage) {
  return {
    mode: "rule_based_read_only",
    generatedAt: new Date().toISOString(),
    question: { id: questionId, ...QUESTIONS[questionId] },
    analysis: { headline, summary, metrics, columns, rows: resultRows, findings, actions, emptyMessage },
  };
}

export async function POST(request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });

    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Geçersiz JSON isteği." }, { status: 400 });
    const questionId = String(body?.questionId || "system_overview");
    if (!QUESTIONS[questionId]) return NextResponse.json({ error: "Geçersiz kontrol seçildi." }, { status: 400 });

    const [projects, projectItems, products, requests, offers, reports, orders, storedOrderItems] = await Promise.all([
      rows(supabase, "projects", user.id),
      rows(supabase, "project_items", user.id),
      rows(supabase, "products", user.id),
      rows(supabase, "requests", user.id),
      rows(supabase, "offers", user.id),
      rows(supabase, "reports", user.id),
      rows(supabase, "orders", user.id),
      rows(supabase, "order_items", user.id),
    ]);
    const reqItems = requestItems(requests);
    const ordItems = orderItems(orders, storedOrderItems);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (questionId === "system_overview") {
      const openRequests = requests.filter((item) => !/tamam|kapal|sipariş/i.test(text(item.status || item.durum, ""))).length;
      const openOrders = orders.filter((item) => !/teslim|tamam|iptal/i.test(text(item.status || item.durum, ""))).length;
      const riskyProducts = products.filter((p) => n(p.current_stock) - n(p.reserved_stock) <= n(p.critical_stock || p.min_stock)).length;
      return NextResponse.json(response(questionId, "Operasyon özeti hazır", "Sistem kayıtları salt okunur olarak kontrol edildi.", [
        { label: "Proje", value: projects.length, tone: "blue" }, { label: "Açık talep", value: openRequests, tone: "amber" },
        { label: "Açık sipariş", value: openOrders, tone: "indigo" }, { label: "Riskli stok", value: riskyProducts, tone: riskyProducts ? "red" : "green" },
      ], [{ key: "area", label: "Alan" }, { key: "status", label: "Durum" }, { key: "note", label: "Açıklama" }], [
        { area: "Projeler", status: `${projects.length} kayıt`, note: `${projectItems.length} proje kalemi izleniyor.` },
        { area: "Talepler", status: `${openRequests} açık`, note: `${offers.length} teklif kaydı bulunuyor.` },
        { area: "Siparişler", status: `${openOrders} açık`, note: `${orders.length} toplam sipariş bulunuyor.` },
      ], riskyProducts ? [`${riskyProducts} stok kartı kritik seviyede veya altında.`] : ["Kritik stok sinyali bulunmadı."], ["Önce kırmızı ve gecikmiş kayıtları inceleyin.", "Eksik veri kontrolünü düzenli çalıştırın."], "Henüz operasyon kaydı yok."));
    }

    if (questionId === "stock_risk") {
      const risky = products.map((p) => ({
        code: productIdentity(p), name: text(p.product_name || p.name), available: n(p.current_stock) - n(p.reserved_stock),
        critical: n(p.critical_stock || p.min_stock), reserved: n(p.reserved_stock),
      })).filter((p) => p.available <= p.critical).sort((a, b) => a.available - b.available).slice(0, 50);
      return NextResponse.json(response(questionId, `${risky.length} riskli stok kartı`, "Kullanılabilir stok, kritik seviye ile karşılaştırıldı.", [
        { label: "Riskli kart", value: risky.length, tone: risky.length ? "red" : "green" },
        { label: "Stok kartı", value: products.length, tone: "blue" },
      ], [{ key: "code", label: "Kod" }, { key: "name", label: "Ürün" }, { key: "available", label: "Kullanılabilir" }, { key: "critical", label: "Kritik seviye" }, { key: "reserved", label: "Ayrılan" }], risky, risky.length ? ["Kullanılabilir stok kritik seviyenin altında olanlar önceliklidir."] : [], ["Tükenen ürünlerin açık talep ve sipariş durumunu kontrol edin."], "Riskli stok bulunmadı."));
    }

    if (questionId === "stock_coverage") {
      const lookup = new Map(products.map((p) => [productIdentity(p).toLocaleUpperCase("tr-TR"), p]));
      const covered = reqItems.map((item) => {
        const product = lookup.get(productIdentity(item).toLocaleUpperCase("tr-TR"));
        const need = n(item.quantity || item.requested_quantity || item.miktar);
        const available = product ? Math.max(n(product.current_stock) - n(product.reserved_stock), 0) : 0;
        return { code: productIdentity(item), request: text(item.requestNo), need, available, covered: Math.min(need, available) };
      }).filter((item) => item.covered > 0).sort((a, b) => b.covered - a.covered).slice(0, 50);
      return NextResponse.json(response(questionId, `${covered.length} talep kalemi stoktan karşılanabilir`, "Talep miktarı ile boşta kullanılabilir stok karşılaştırıldı.", [{ label: "Karşılanabilir kalem", value: covered.length, tone: "green" }], [{ key: "code", label: "Ürün" }, { key: "request", label: "Talep" }, { key: "need", label: "İhtiyaç" }, { key: "available", label: "Kullanılabilir" }, { key: "covered", label: "Stoktan karşılanır" }], covered, [], ["Stok rezervasyonunu taleple ilişkilendirerek yapın."], "Stoktan karşılanabilecek açık talep kalemi bulunmadı."));
    }

    if (questionId === "request_queue") {
      const queued = requests.filter((r) => !/tamam|kapal|sipariş/i.test(text(r.status || r.durum, ""))).map((r) => ({
        no: text(r.request_no || r.request_number || r.no || r.id), status: text(r.status || r.durum, "Yeni"),
        owner: text(r.requested_by || r.created_by_name || r.department), items: Array.isArray(r.items) ? r.items.length : n(r.totalitems || r.item_count),
        date: text(r.created_at ? new Date(r.created_at).toLocaleDateString("tr-TR") : ""),
      }));
      return NextResponse.json(response(questionId, `${queued.length} talep işlem bekliyor`, "Tamamlanmamış talepler listelendi.", [{ label: "Bekleyen talep", value: queued.length, tone: queued.length ? "amber" : "green" }], [{ key: "no", label: "Talep no" }, { key: "status", label: "Durum" }, { key: "owner", label: "Açan / birim" }, { key: "items", label: "Kalem" }, { key: "date", label: "Tarih" }], queued, [], ["Yeni talepleri teklif toplama sürecine alın."], "İşlem bekleyen talep yok."));
    }

    if (questionId === "offer_waiting") {
      const counts = offers.reduce((map, o) => map.set(String(o.request_id), (map.get(String(o.request_id)) || 0) + 1), new Map());
      const waiting = requests.map((r) => ({ no: text(r.request_no || r.request_number || r.no || r.id), status: text(r.status || r.durum, "Yeni"), offers: counts.get(String(r.id)) || 0, items: Array.isArray(r.items) ? r.items.length : n(r.totalitems || r.item_count) })).filter((r) => r.offers < 2 && !/tamam|kapal|sipariş/i.test(r.status));
      return NextResponse.json(response(questionId, `${waiting.length} talepte teklif ihtiyacı var`, "Karşılaştırma için iki teklif eşiği kullanıldı.", [{ label: "Teklif bekleyen", value: waiting.length, tone: waiting.length ? "amber" : "green" }, { label: "Toplam teklif", value: offers.length, tone: "blue" }], [{ key: "no", label: "Talep no" }, { key: "status", label: "Durum" }, { key: "items", label: "Kalem" }, { key: "offers", label: "Teklif sayısı" }], waiting, waiting.length ? ["Tek teklifli taleplerde fiyat mukayesesi sınırlıdır."] : [], ["Eksik teklifleri tamamlayın veya tek kaynak gerekçesi kaydedin."], "Teklif bekleyen talep yok."));
    }

    if (questionId === "comparison_gaps") {
      const gaps = reqItems.map((item) => {
        const required = n(item.quantity || item.requested_quantity || item.miktar);
        const related = offers.flatMap((offer) => (Array.isArray(offer.items) ? offer.items : []).map((row) => ({ ...row, offer }))).filter((row) => productIdentity(row).toLocaleUpperCase("tr-TR") === productIdentity(item).toLocaleUpperCase("tr-TR"));
        const maxOffered = Math.max(0, ...related.map((row) => n(row.quantity || row.miktar)));
        return { code: productIdentity(item), request: text(item.requestNo), required, offered: maxOffered, offerCount: related.length, gap: Math.max(required - maxOffered, 0) };
      }).filter((row) => row.offerCount === 0 || row.gap > 0).slice(0, 50);
      return NextResponse.json(response(questionId, `${gaps.length} kalem inceleme gerektiriyor`, "Talep ve teklif miktarları ürün kodu üzerinden karşılaştırıldı.", [{ label: "Kontrol gereken", value: gaps.length, tone: gaps.length ? "red" : "green" }, { label: "Mukayese raporu", value: reports.length, tone: "blue" }], [{ key: "code", label: "Ürün" }, { key: "request", label: "Talep" }, { key: "required", label: "Talep" }, { key: "offered", label: "En yüksek teklif" }, { key: "gap", label: "Eksik" }, { key: "offerCount", label: "Teklif" }], gaps, gaps.length ? ["Eksik miktarlı teklif otomatik olarak tam teklif kabul edilmemelidir."] : [], ["Eksik kalemleri tamamlatın; şüpheli eşleşmeleri manuel doğrulayın."], "Mukayese açığı bulunmadı."));
    }

    if (questionId === "open_orders") {
      const open = orders.map((o) => {
        const termin = dateValue(o.termin_date || o.delivery_date || o.expected_delivery_date);
        const delivered = n(o.received_total || o.delivered_quantity);
        const ordered = n(o.total_quantity || o.quantity) || (Array.isArray(o.items) ? o.items.reduce((s, i) => s + n(i.quantity), 0) : 0);
        return { no: text(o.order_no || o.order_number || o.id), supplier: text(o.supplier_name || o.partner_name), status: text(o.status || o.durum, "Açık"), termin: termin ? termin.toLocaleDateString("tr-TR") : "Belirtilmedi", remaining: Math.max(ordered - delivered, 0), overdue: termin && termin < today && delivered < ordered ? "Gecikmiş" : "-" };
      }).filter((o) => !/teslim|tamam|iptal/i.test(o.status));
      const overdue = open.filter((o) => o.overdue === "Gecikmiş").length;
      return NextResponse.json(response(questionId, `${open.length} açık sipariş`, "Sipariş durumu, termin ve kalan miktar birlikte kontrol edildi.", [{ label: "Açık", value: open.length, tone: "amber" }, { label: "Gecikmiş", value: overdue, tone: overdue ? "red" : "green" }], [{ key: "no", label: "Sipariş no" }, { key: "supplier", label: "Tedarikçi" }, { key: "status", label: "Durum" }, { key: "termin", label: "Termin" }, { key: "remaining", label: "Kalan" }, { key: "overdue", label: "Uyarı" }], open, overdue ? [`${overdue} sipariş termin tarihini aşmış görünüyor.`] : [], ["Geciken siparişlerde tedarikçi teyidi ve yeni termin kaydı oluşturun."], "Açık sipariş yok."));
    }

    if (questionId === "delivery_gaps") {
      const missing = ordItems.map((i) => { const ordered = n(i.quantity || i.ordered_quantity || i.miktar); const received = n(i.received_quantity || i.delivered_quantity || i.accepted_quantity || i.gelen); return { no: text(i.orderNo || i.order_no || i.order_id), code: productIdentity(i), supplier: text(i.supplier || i.supplier_name), ordered, received, remaining: Math.max(ordered - received, 0) }; }).filter((i) => i.remaining > 0).sort((a, b) => b.remaining - a.remaining).slice(0, 50);
      return NextResponse.json(response(questionId, `${missing.length} eksik teslimat kalemi`, "Sipariş miktarı ile teslim alınan miktar karşılaştırıldı.", [{ label: "Eksik kalem", value: missing.length, tone: missing.length ? "amber" : "green" }], [{ key: "no", label: "Sipariş" }, { key: "supplier", label: "Tedarikçi" }, { key: "code", label: "Ürün" }, { key: "ordered", label: "Sipariş" }, { key: "received", label: "Teslim" }, { key: "remaining", label: "Kalan" }], missing, [], ["Teslim belgesiyle miktarı doğrulayın ve kısmi teslimi kaydedin."], "Eksik teslimat yok."));
    }

    if (questionId === "cost_hotspots") {
      const costly = ordItems.map((i) => { const quantity = n(i.quantity || i.miktar); const unit = n(i.net_unit_price || i.unit_price || i.birim_fiyat); const currency = text(i.currency, "TRY"); return { code: productIdentity(i), supplier: text(i.supplier || i.supplier_name), quantity, unit: money(unit, currency), total: money(n(i.total_amount || i.total) || quantity * unit, currency), numericTotal: n(i.total_amount || i.total) || quantity * unit }; }).filter((i) => i.numericTotal > 0).sort((a, b) => b.numericTotal - a.numericTotal).slice(0, 20).map(({ numericTotal, ...item }) => item);
      return NextResponse.json(response(questionId, "En yüksek maliyetli kalemler", "Sipariş kalemleri kendi para birimlerindeki tutara göre sıralandı; farklı para birimleri doğrudan birbirine eşit kabul edilmedi.", [{ label: "Fiyatlı kalem", value: costly.length, tone: "blue" }], [{ key: "code", label: "Ürün" }, { key: "supplier", label: "Tedarikçi" }, { key: "quantity", label: "Miktar" }, { key: "unit", label: "Birim fiyat" }, { key: "total", label: "Toplam" }], costly, ["Farklı para birimlerini kesin karar öncesinde işlem tarihindeki sabit kurla karşılaştırın."], ["Yüksek tutarlı kalemlerde mukayese ve onay kaydını kontrol edin."], "Fiyat bilgisi bulunan sipariş kalemi yok."));
    }

    const issues = [];
    products.forEach((p) => { if (!p.product_code) issues.push({ area: "Stok", record: text(p.product_name || p.id), issue: "Ürün kodu eksik", severity: "Yüksek" }); if (!p.unit) issues.push({ area: "Stok", record: productIdentity(p), issue: "Birim eksik", severity: "Orta" }); });
    orders.forEach((o) => { const id = text(o.order_no || o.id); if (!o.supplier_name && !o.partner_name) issues.push({ area: "Sipariş", record: id, issue: "Tedarikçi eksik", severity: "Yüksek" }); if (!o.currency) issues.push({ area: "Sipariş", record: id, issue: "Para birimi eksik", severity: "Yüksek" }); if (!o.termin_date && !o.delivery_date) issues.push({ area: "Sipariş", record: id, issue: "Termin belirtilmemiş", severity: "Orta" }); });
    offers.forEach((o) => { if (!o.firma_adi && !o.supplier_name && !o.company_name) issues.push({ area: "Teklif", record: text(o.dosya_adi || o.id), issue: "Firma adı eksik", severity: "Yüksek" }); });
    return NextResponse.json(response(questionId, `${issues.length} veri kalitesi uyarısı`, "Kritik kimlik ve süreç alanları kontrol edildi.", [{ label: "Uyarı", value: issues.length, tone: issues.length ? "red" : "green" }], [{ key: "area", label: "Alan" }, { key: "record", label: "Kayıt" }, { key: "issue", label: "Sorun" }, { key: "severity", label: "Önem" }], issues.slice(0, 100), issues.length ? ["Eksik veriler analiz ve rapor güvenilirliğini düşürür."] : [], ["Önce yüksek önem seviyesindeki kayıtları düzeltin."], "Eksik veya şüpheli temel veri bulunmadı."));
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Sistem kontrolü tamamlanamadı." }, { status: 500 });
  }
}
