import { cachedLiveRate } from "@/lib/currency";

export const liveCurrencyOptions = ["USD", "EUR", "GBP"];

export function rateFromSettings(currency, settings = {}) {
  if (!currency || currency === "TRY") return 1;
  return Number(settings[`${String(currency).toLowerCase()}_rate`] || 0) || cachedLiveRate(currency) || 1;
}

// Aynı sayfada birden çok bileşen kur ister; 60 sn içinde tek istek yapılır.
let liveRatesCache = null;

export async function fetchLiveTryRates() {
  const now = Date.now();
  if (liveRatesCache && now - liveRatesCache.at < 60000) return liveRatesCache.promise;
  const promise = fetch("/api/live-rates", { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error("Canlı kur bilgisi alınamadı.");
    return response.json();
  });
  liveRatesCache = { at: now, promise };
  promise.catch(() => {
    if (liveRatesCache?.promise === promise) liveRatesCache = null;
  });
  return promise;
}

export function liveRateFor(currency, liveRates) {
  if (!currency || currency === "TRY") return 1;
  return Number(liveRates?.rates?.[currency] || 0);
}

export function rateDiffPercent(fixedRate, currentRate) {
  const fixed = Number(fixedRate || 0);
  const current = Number(currentRate || 0);
  if (fixed <= 0 || current <= 0) return 0;
  return ((current - fixed) / fixed) * 100;
}

export function convertedTryAmount(amount, rate) {
  return Number(amount || 0) * Number(rate || 1);
}
