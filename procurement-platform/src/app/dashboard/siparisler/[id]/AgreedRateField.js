"use client";

import { useEffect, useState } from "react";

// Sipariş bir para biriminde, fatura başka birinde (ör. EUR sipariş, TL fatura)
// kesildiğinde hangi günün kuruyla anlaşıldığı sorulur. Saklanan kur:
// "1 sipariş para birimi = X fatura para birimi". Fatura tutarı / X = sipariş
// para birimindeki karşılığı; fiyat ve toplam kontrolü bu kurla yapılır.
export const RATE_BASIS_LABELS = {
  siparis: "Sipariş günü kuru",
  fatura: "Fatura günü kuru (TCMB)",
  sabit: "Siparişte sabitlenen kur",
  elle: "Elle girilen kur",
};

const cache = new Map();

async function tryRates(date) {
  const key = date || "today";
  if (!cache.has(key)) {
    cache.set(
      key,
      fetch(`/api/live-rates${date ? `?date=${date}` : ""}`)
        .then((response) => response.json())
        .catch(() => null),
    );
  }
  return cache.get(key);
}

function formatRate(value) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 }).format(Number(value || 0));
}

function formatMoney(value, currency) {
  return `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))} ${currency}`;
}

export async function resolveAgreedRate({ basis, order, invoiceCurrency, invoiceDate }) {
  const orderCurrency = String(order?.currency || "TRY").toUpperCase();
  const target = String(invoiceCurrency || "TRY").toUpperCase();
  if (orderCurrency === target) return { rate: 1, date: invoiceDate || null, source: "aynı para birimi" };
  const orderDate = String(order?.exchange_rate_date || order?.order_date || order?.created_at || "").slice(0, 10);
  const orderRate = Number(order?.exchange_rate || 0);

  // Siparişte TL karşılığı kaydedildiyse (EUR sipariş, TL fatura) doğrudan kullanılır.
  if ((basis === "siparis" || basis === "sabit") && target === "TRY" && orderRate > 0) {
    return { rate: orderRate, date: orderDate || null, source: basis === "sabit" ? "siparişte sabitlenen kur" : "sipariş kaydındaki kur" };
  }
  const date = basis === "fatura" ? invoiceDate : orderDate;
  if (!date) return { rate: 0, date: null, source: basis === "fatura" ? "Önce fatura tarihini girin." : "Sipariş tarihi bulunamadı." };
  const data = await tryRates(date);
  const rates = data?.rates || {};
  const orderTry = orderCurrency === "TRY" ? 1 : Number(rates[orderCurrency] || 0);
  const targetTry = target === "TRY" ? 1 : Number(rates[target] || 0);
  if (!(orderTry > 0 && targetTry > 0)) return { rate: 0, date, source: "Kur alınamadı; elle girin." };
  return { rate: orderTry / targetTry, date: data?.date || date, source: data?.source || "TCMB" };
}

export default function AgreedRateField({ order, form, onFormChange }) {
  const orderCurrency = String(order?.currency || "TRY").toUpperCase();
  const invoiceCurrency = String(form.currency || "TRY").toUpperCase();
  const visible = form.document_type === "fatura" && orderCurrency !== invoiceCurrency;
  const [info, setInfo] = useState("");
  const basis = form.exchange_rate_basis || (order?.rate_locked ? "sabit" : "siparis");

  useEffect(() => {
    if (!visible || basis === "elle") return undefined;
    let cancelled = false;
    setInfo("Kur alınıyor...");
    resolveAgreedRate({ basis, order, invoiceCurrency, invoiceDate: form.document_date }).then((result) => {
      if (cancelled) return;
      setInfo(result.rate > 0 ? `${result.source}${result.date ? ` · ${result.date}` : ""}` : result.source);
      onFormChange((prev) => ({
        ...prev,
        exchange_rate_basis: basis,
        exchange_rate: result.rate > 0 ? String(Number(result.rate.toFixed(6))) : "",
        exchange_rate_date: result.date || "",
      }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, basis, invoiceCurrency, form.document_date, order?.id]);

  if (!visible) return null;

  const rate = Number(form.exchange_rate || 0);
  const orderTotal = Number(order?.total_amount || 0);
  const invoiceTotal = Number(form.tax_exclusive_amount || form.invoice_total || 0);
  const expected = rate > 0 ? orderTotal * rate : 0;
  const diffPercent = expected > 0 && invoiceTotal > 0 ? ((invoiceTotal - expected) / expected) * 100 : null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 md:col-span-2 xl:col-span-3">
      <div className="text-sm font-black text-amber-900">
        Sipariş {orderCurrency}, fatura {invoiceCurrency}: hangi günün kuruyla anlaşıldı?
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">Anlaşılan kur</span>
          <select
            value={basis}
            onChange={(event) => onFormChange((prev) => ({ ...prev, exchange_rate_basis: event.target.value }))}
            className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm"
          >
            <option value="siparis">{RATE_BASIS_LABELS.siparis}</option>
            <option value="fatura">{RATE_BASIS_LABELS.fatura}</option>
            {order?.rate_locked && <option value="sabit">{RATE_BASIS_LABELS.sabit}</option>}
            <option value="elle">{RATE_BASIS_LABELS.elle}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-slate-600">1 {orderCurrency} = ? {invoiceCurrency}</span>
          <input
            type="number"
            step="any"
            min="0"
            value={form.exchange_rate || ""}
            readOnly={basis !== "elle"}
            onChange={(event) => onFormChange((prev) => ({ ...prev, exchange_rate: event.target.value }))}
            className={`w-full rounded-xl border border-slate-300 p-3 text-sm ${basis === "elle" ? "bg-white" : "bg-slate-100"}`}
          />
        </label>
        <div className="text-xs font-semibold text-slate-600">
          {basis === "elle" ? "Tedarikçiyle anlaştığınız kuru yazın." : info}
          {expected > 0 && (
            <div className="mt-1 font-bold text-slate-800">
              Bu kurla beklenen fatura: {formatMoney(expected, invoiceCurrency)}
              {diffPercent !== null && (
                <span className={Math.abs(diffPercent) <= 1 ? " text-emerald-700" : " text-red-700"}>
                  {" "}({diffPercent >= 0 ? "+" : ""}{diffPercent.toFixed(1)}%)
                </span>
              )}
            </div>
          )}
          {rate > 0 && <div className="mt-1">1 {orderCurrency} = {formatRate(rate)} {invoiceCurrency}</div>}
        </div>
      </div>
    </div>
  );
}
