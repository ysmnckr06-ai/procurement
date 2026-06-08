export const liveCurrencyOptions = ["USD", "EUR", "GBP"];

export function rateFromSettings(currency, settings = {}) {
  if (!currency || currency === "TRY") return 1;
  return Number(settings[`${String(currency).toLowerCase()}_rate`] || 1);
}

export async function fetchLiveTryRates() {
  const response = await fetch("https://api.frankfurter.app/latest?from=TRY&to=USD,EUR,GBP", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Canlı kur bilgisi alınamadı.");
  }

  const data = await response.json();
  const rates = { TRY: 1 };
  liveCurrencyOptions.forEach((currency) => {
    const tryToCurrency = Number(data.rates?.[currency] || 0);
    if (tryToCurrency > 0) {
      rates[currency] = 1 / tryToCurrency;
    }
  });

  return {
    date: data.date || new Date().toISOString().slice(0, 10),
    source: "Frankfurter / ECB",
    rates,
  };
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
