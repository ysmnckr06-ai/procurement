"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { findOrCreateBusinessPartner } from "@/lib/businessPartners";

function num(value) { return Number(value || 0) || 0; }
function normalize(value) { return String(value || "").trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " "); }
function supplierName(offer) { return offer?.firmaAdi || offer?.firma || "Bilinmeyen tedarikçi"; }
function money(value, currency = "TRY") {
  return `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(value))} ${currency}`;
}
function groupKey(index) { return `group-${index}`; }
function normalizedCurrency(value) { return String(value || "").trim().toUpperCase(); }
function projectSummary(group) {
  const rows = Array.isArray(group?.allocations) ? group.allocations : [];
  const totals = new Map();
  rows.forEach((row) => {
    const key = row.projectCode || row.projectName || row.projectId;
    if (key) totals.set(key, (totals.get(key) || 0) + num(row.quantity));
  });
  return Array.from(totals.entries()).map(([key, quantity]) => `${key}: ${quantity}`).join(" · ") || "Proje bağı yok";
}
function comparisonOrderKey(name, currency, exchangeRate) {
  return `${normalize(name)}|${normalizedCurrency(currency)}|${num(exchangeRate).toFixed(6)}`;
}
function offerOriginalTotal(group, offer) {
  return num(offer?.netToplam) || num(offer?.netBirimFiyat) * num(group?.purchaseQuantity || group?.talepEdilenAdet || offer?.firmaAdedi);
}
function offerTryTotal(group, offer) {
  const explicitTryTotal = num(offer?.netToplamTRY);
  if (explicitTryTotal > 0) return explicitTryTotal;
  const currency = normalizedCurrency(offer?.paraBirimi) || "TRY";
  const rate = currency === "TRY" ? 1 : num(offer?.kur);
  return offerOriginalTotal(group, offer) * (rate || 1);
}

function proportionalAllocations(allocations, targetQuantity) {
  const source = Array.isArray(allocations) ? allocations.filter((row) => num(row.quantity) > 0) : [];
  const total = source.reduce((sum, row) => sum + num(row.quantity), 0);
  if (!source.length || total <= 0) return [];
  let used = 0;
  return source.map((row, index) => {
    const quantity = index === source.length - 1
      ? Math.max(targetQuantity - used, 0)
      : Math.min(Number((targetQuantity * num(row.quantity) / total).toFixed(6)), Math.max(targetQuantity - used, 0));
    used += quantity;
    return { ...row, quantity };
  }).filter((row) => row.quantity > 0);
}

export default function ComparisonPage() {
  const { id } = useParams();
  const router = useRouter();
  const creatingRef = useRef(false);
  const [report, setReport] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [selectedOffers, setSelectedOffers] = useState({});
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const [reportResult, supplierResult] = await Promise.all([
        supabase.from("reports").select("*").eq("id", id).eq("user_id", user.id).single(),
        supabase.from("suppliers").select("id,name,score,status,partner_type").eq("user_id", user.id),
      ]);
      if (reportResult.error || !reportResult.data) {
        setMessage("Mukayese raporu bulunamadı veya erişim yetkiniz yok.");
        return;
      }
      setReport(reportResult.data);
      setSuppliers(supplierResult.data || []);
      const defaults = {};
      (Array.isArray(reportResult.data.analysis) ? reportResult.data.analysis : []).forEach((group, index) => {
        const offers = Array.isArray(group.offers) ? group.offers : [];
        const bestIndex = offers.findIndex((offer) => normalize(supplierName(offer)) === normalize(supplierName(group.bestOffer)));
        if (bestIndex >= 0) defaults[groupKey(index)] = bestIndex;
      });
      setSelectedOffers(defaults);
    }
    load();
  }, [id, router]);

  const groups = useMemo(() => Array.isArray(report?.analysis) ? report.analysis : [], [report]);
  const supplierMap = useMemo(() => new Map(suppliers.map((supplier) => [normalize(supplier.name), supplier])), [suppliers]);
  const selectedSummary = useMemo(() => {
    const selectedRows = groups
      .map((group, index) => ({ group, offer: group.offers?.[selectedOffers[groupKey(index)]] }))
      .filter((row) => row.offer);
    const totalTry = selectedRows.reduce((sum, row) => sum + offerTryTotal(row.group, row.offer), 0);
    const foreignCurrencies = Array.from(new Set(selectedRows
      .map((row) => normalizedCurrency(row.offer?.paraBirimi))
      .filter((currency) => currency && currency !== "TRY")));
    return { selectedCount: selectedRows.length, totalTry, foreignCurrencies };
  }, [groups, selectedOffers]);

  async function createOrders() {
    if (!report || creatingRef.current) return;
    const selections = groups
      .map((group, index) => ({ group, offer: group.offers?.[selectedOffers[groupKey(index)]] }))
      .filter((row) => row.offer);
    if (!selections.length) { setMessage("Siparişe dönüştürmek için en az bir teklif seçin."); return; }

    const validationErrors = [];
    selections.forEach(({ group, offer }) => {
      const currency = normalizedCurrency(offer.paraBirimi);
      const submittedRate = num(offer.kur);
      const exchangeRate = currency === "TRY" && submittedRate <= 0 ? 1 : submittedRate;
      const itemLabel = `${group.urunKodu || "Kodsuz"} · ${group.urunAciklamasi || "Ürün"}`;
      if (!currency) validationErrors.push(`${itemLabel}: para birimi eksik`);
      if (!currency || exchangeRate <= 0) validationErrors.push(`${itemLabel}: geçerli kur eksik`);
      if (num(offer.firmaAdedi) < num(group.purchaseQuantity || group.talepEdilenAdet)) {
        validationErrors.push(`${itemLabel}: teklif miktarı talep miktarını tam karşılamıyor`);
      }
      const allocationProjectIds = (group.allocations || []).map((allocation) => allocation.projectId).filter(Boolean);
      if (allocationProjectIds.length === 0 && !report.project_id) {
        validationErrors.push(`${itemLabel}: proje bağı yok`);
      }
    });
    if (validationErrors.length > 0) {
      setMessage(`Sipariş oluşturulmadı. ${validationErrors.join(" | ")}`);
      return;
    }

    creatingRef.current = true; setCreating(true); setMessage("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { creatingRef.current = false; setCreating(false); router.push("/login"); return; }

    const bySupplier = new Map();
    selections.forEach(({ group, offer }) => {
      const name = supplierName(offer);
      const currency = normalizedCurrency(offer.paraBirimi);
      const exchangeRate = currency === "TRY" && num(offer.kur) <= 0 ? 1 : num(offer.kur);
      const supplierLookupKey = normalize(name);
      const key = comparisonOrderKey(name, currency, exchangeRate);
      if (!bySupplier.has(key)) {
        bySupplier.set(key, {
          key,
          name,
          partner: supplierMap.get(supplierLookupKey),
          currency,
          exchangeRate,
          items: [],
        });
      }
      const quantity = num(group.purchaseQuantity || group.talepEdilenAdet);
      bySupplier.get(key).items.push({
        rowId: `report-${report.id}-${group.urunKodu || group.normalizedProductCode || bySupplier.get(key).items.length}`,
        productId: group.productId || null,
        productCode: group.urunKodu || group.normalizedProductCode || "",
        productName: group.urunAciklamasi || "",
        unit: group.birim || "adet",
        quantity,
        deliveredQuantity: 0,
        unitPrice: num(offer.birimFiyat),
        discount: num(offer.iskonto),
        netUnitPrice: num(offer.netBirimFiyat),
        total: num(offer.netToplam) || num(offer.netBirimFiyat) * quantity,
        currency,
        paymentTerm: offer.vade || "",
        deliveryTerm: offer.termin || "",
        allocations: proportionalAllocations(group.allocations, quantity),
        sourceReportId: report.id,
      });
    });

    const { data: existing, error: existingError } = await supabase
      .from("orders")
      .select("id,order_no,partner_name,supplier_name,currency,exchange_rate")
      .eq("user_id", user.id)
      .eq("report_id", report.id);
    if (existingError) {
      setMessage(`Mükerrer sipariş kontrolü yapılamadı: ${existingError.message}`);
      creatingRef.current = false; setCreating(false); return;
    }
    const selectedKeys = new Set(bySupplier.keys());
    const duplicateGroups = (existing || []).filter((order) => selectedKeys.has(comparisonOrderKey(
      order.partner_name || order.supplier_name,
      order.currency,
      order.exchange_rate,
    )));
    if (duplicateGroups.length > 0) {
      setMessage(`Bu mukayese grubundan sipariş zaten oluşturulmuş: ${duplicateGroups.map((order) => order.order_no).join(", ")}`);
      creatingRef.current = false; setCreating(false); return;
    }

    for (const entry of bySupplier.values()) {
      if (entry.partner) continue;
      const partner = await findOrCreateBusinessPartner(supabase, user.id, {
        name: entry.name,
        partnerType: "Tedarikçi",
        allowCreate: true,
        matchPartnerType: true,
        notes: "Mukayese sonucu siparişe seçildi.",
      });
      if (!partner) {
        setMessage(`${entry.name} için tedarikçi kartı oluşturulamadı. Sipariş oluşturulmadı.`);
        creatingRef.current = false; setCreating(false); return;
      }
      entry.partner = partner;
    }

    const today = new Date().toISOString().slice(0, 10);
    const suffix = String(report.id).replaceAll("-", "").slice(0, 6).toUpperCase();
    const payloads = Array.from(bySupplier.values()).map((entry, index) => {
      const currency = entry.currency;
      const rate = entry.exchangeRate;
      const total = entry.items.reduce((sum, item) => sum + num(item.total), 0);
      const projectIds = Array.from(new Set(entry.items.flatMap((item) => item.allocations.map((allocation) => allocation.projectId)).filter(Boolean)));
      return {
        user_id: user.id,
        order_no: `SIP-${new Date().getFullYear()}-${suffix}-${String(index + 1).padStart(2, "0")}`,
        supplier_name: entry.name,
        partner_id: entry.partner?.id || null,
        partner_name: entry.partner?.name || entry.name,
        partner_type: entry.partner?.partner_type || "Tedarikçi",
        product_name: `${entry.items.length} kalem · Mukayese siparişi`,
        quantity: entry.items.reduce((sum, item) => sum + num(item.quantity), 0),
        order_date: today,
        status: "Taslak",
        project_id: projectIds.length === 1 ? projectIds[0] : projectIds.length === 0 ? report.project_id : null,
        report_id: report.id,
        items: entry.items,
        total_amount: total,
        original_amount: total,
        order_total: total,
        currency,
        exchange_rate: rate,
        exchange_rate_date: today,
        base_currency: "TRY",
        base_amount: total * rate,
        order_total_base: total * rate,
        remaining_amount: total,
        remaining_amount_base: total * rate,
        note: `${report.ad || "Talep mukayesesi"} üzerinden oluşturuldu. Rapor: ${report.id}`,
      };
    });
    const { data: orders, error } = await supabase.from("orders").insert(payloads).select("id,order_no");
    if (error) {
      const duplicateMessage = error.code === "23505" || /orders_comparison_group_unique_idx/i.test(error.message || "")
        ? "Bu mukayese grubundan sipariş zaten oluşturulmuş. İkinci kayıt engellendi."
        : `Siparişler oluşturulamadı; işlem geri alındı: ${error.message}`;
      setMessage(duplicateMessage);
      creatingRef.current = false; setCreating(false); return;
    }
    await supabase.from("reports").update({ durum: "Tamamlandı" }).eq("id", report.id).eq("user_id", user.id);
    localStorage.setItem("lastCreatedComparisonOrders", JSON.stringify(orders || []));
    setMessage(`${orders?.length || 0} tedarikçi siparişi oluşturuldu. Proje allocation bilgileri sipariş kalemlerinde korundu.`);
    creatingRef.current = false; setCreating(false);
  }

  if (!report) return <div className="min-h-screen bg-slate-100 p-8"><div className="mx-auto max-w-5xl rounded-2xl bg-white p-6">{message || "Mukayese yükleniyor..."}</div></div>;

  return <div className="min-h-screen bg-slate-100 p-4 sm:p-8"><main className="mx-auto max-w-7xl space-y-5">
    <div className="rounded-3xl bg-slate-950 p-6 text-white"><Link href={`/dashboard/raporlar/${report.id}`} className="text-sm font-bold text-blue-200">← Rapor özetine dön</Link><div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-sm font-bold text-blue-200">{report.ad || "Talep Mukayesesi"}</div><h1 className="mt-1 text-3xl font-black">Profesyonel Mukayese</h1><p className="mt-2 text-sm text-slate-300">Kalem bazında teklifleri; miktar, iskonto, kur, vade, termin ve risk etkileriyle karşılaştırın. Siparişler tedarikçiye göre gruplanır ve kaynak rapora bağlanır.</p></div><button type="button" onClick={createOrders} disabled={creating} className="rounded-xl bg-emerald-600 px-5 py-3 font-black text-white disabled:bg-slate-500">{creating ? "Siparişler oluşturuluyor..." : "Seçilenlerden Sipariş Oluştur"}</button></div></div>
    {message && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 font-semibold text-blue-900">{message} {message.includes("oluşturuldu") && <Link href="/dashboard/siparisler" className="ml-2 underline">Siparişlere git</Link>}</div>}
    <section className="rounded-2xl border border-blue-100 bg-blue-50 p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-black text-blue-950">Seçili teklif TL dip toplamı</h2>
          <p className="mt-1 text-sm font-semibold text-blue-800">
            Dövizli teklifler analizde kaydedilen kurla TL karşılığına çevrilir.
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black text-blue-950">{money(selectedSummary.totalTry, "TRY")}</div>
          <div className="mt-1 text-xs font-bold text-blue-700">
            {selectedSummary.selectedCount} seçili kalem
            {selectedSummary.foreignCurrencies.length > 0 ? ` · Döviz: ${selectedSummary.foreignCurrencies.join(", ")}` : ""}
          </div>
        </div>
      </div>
    </section>
    {groups.map((group, groupIndex) => {
      const offers = Array.isArray(group.offers) ? group.offers : [];
      const bestName = normalize(supplierName(group.bestOffer));
      return <section key={groupKey(groupIndex)} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b bg-slate-50 p-4"><div className="font-black text-blue-900">{group.urunKodu || "Kodsuz"} · {group.urunAciklamasi}</div><div className="mt-1 flex flex-wrap gap-3 text-xs font-bold text-slate-600"><span>Talep edilen: {group.talepEdilenAdet} {group.birim}</span><span>Teklif sayısı: {offers.length}</span><span>Projeler: {projectSummary(group)}</span></div></div>
        <div className="overflow-x-auto"><table className="min-w-[1450px] w-full text-left text-xs"><thead className="bg-white text-slate-500"><tr><th className="p-3">Seç</th><th className="p-3">Tedarikçi / Puan</th><th className="p-3">Miktar</th><th className="p-3">Birim fiyat</th><th className="p-3">İskonto</th><th className="p-3">Net fiyat</th><th className="p-3">Toplam</th><th className="p-3">Para birimi</th><th className="p-3">Kur</th><th className="p-3">TL karşılığı</th><th className="p-3">Vade</th><th className="p-3">Termin</th><th className="p-3">Sonuç</th></tr></thead><tbody>
          {offers.map((offer, offerIndex) => { const name = supplierName(offer); const isBest = normalize(name) === bestName; const supplier = supplierMap.get(normalize(name)); return <tr key={`${name}-${offerIndex}`} className={`border-t ${isBest ? "bg-emerald-50" : ""}`}><td className="p-3"><input type="radio" name={groupKey(groupIndex)} checked={selectedOffers[groupKey(groupIndex)] === offerIndex} onChange={() => setSelectedOffers((current) => ({ ...current, [groupKey(groupIndex)]: offerIndex }))} /></td><td className="p-3"><div className="font-black text-slate-900">{name}</div><div className="text-blue-700">Puan: {supplier?.score ?? 80}/100</div></td><td className="p-3">{offer.firmaAdedi || group.purchaseQuantity || group.talepEdilenAdet}</td><td className="p-3">{money(offer.birimFiyat, offer.paraBirimi)}</td><td className="p-3">%{num(offer.iskonto)}</td><td className="p-3">{money(offer.netBirimFiyat, offer.paraBirimi)}</td><td className="p-3">{money(offer.netToplam || num(offer.netBirimFiyat) * num(group.purchaseQuantity || group.talepEdilenAdet), offer.paraBirimi)}</td><td className="p-3">{offer.paraBirimi || "TRY"}</td><td className="p-3">{num(offer.kur) || 1}</td><td className="p-3 font-black">{money(offerTryTotal(group, offer), "TRY")}</td><td className="p-3">{offer.vade || `${offer.vadeDays || 0} gün`}</td><td className="p-3">{offer.termin || `${offer.terminDays || 0} gün`}</td><td className="p-3">{isBest ? <span className="rounded-full bg-emerald-600 px-3 py-1 font-black text-white">En iyi teklif</span> : <span className="rounded-full bg-slate-200 px-3 py-1 font-bold text-slate-700">Alternatif</span>}</td></tr>; })}
        </tbody></table></div>
      </section>;
    })}
  </main></div>;
}
