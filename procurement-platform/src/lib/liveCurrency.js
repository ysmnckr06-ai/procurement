export const liveCurrencyOptions = ["USD", "EUR", "GBP"];

export function rateFromSettings(currency, settings = {}) {
  if (!currency || currency === "TRY") return 1;
  return Number(settings[`${String(currency).toLowerCase()}_rate`] || 1);
}

export async function fetchLiveTryRates() {
  const response = await fetch("/api/live-rates", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Canlı kur bilgisi alınamadı.");
  }

  return response.json();
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
