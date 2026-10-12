export const currencyOptions = ["TRY", "USD", "EUR", "GBP"];

export function getBaseCurrency(settings = {}) {
  return settings.base_currency || settings.default_currency || "TRY";
}

// Şirket ayarlarında kur girilmemişse (ör. hiç ayar kaydı yoksa) yabancı
// para birimleri sessizce 1 kabul ediliyordu: 5.000 USD, 5.000 TL olarak
// kaydediliyordu. Panel açılırken TCMB canlı kurları bu önbelleğe alınır ve
// ayar yoksa onlar kullanılır.
const liveRateCache = {};

export function setLiveRateCache(rates = {}) {
  ["USD", "EUR", "GBP"].forEach((currency) => {
    const rate = Number(rates?.[currency] || 0);
    if (rate > 0) liveRateCache[currency] = rate;
  });
}

export function cachedLiveRate(currency) {
  return Number(liveRateCache[String(currency || "").toUpperCase()] || 0);
}

export function getExchangeRate(currency, settings = {}) {
  const baseCurrency = getBaseCurrency(settings);
  if (!currency || currency === baseCurrency) return 1;

  const key = `${String(currency).toLowerCase()}_rate`;
  return Number(settings[key] || 0) || cachedLiveRate(currency) || 1;
}

// Yabancı para birimiyle 1 veya altı kur girilmesi neredeyse her zaman
// eksik/yanlış kur demektir; kayıt öncesi kullanıcı uyarılmalıdır.
export function isSuspiciousRate(currency, rate, settings = {}) {
  const baseCurrency = getBaseCurrency(settings);
  if (!currency || currency === baseCurrency) return false;
  return !(Number(rate) > 1);
}

export function calculateBaseAmount(amount, currency, settings = {}, rate) {
  const exchangeRate = Number(rate || getExchangeRate(currency, settings) || 1);
  return Number(amount || 0) * exchangeRate;
}

export function formatMoney(value, currency = "TRY") {
  return `${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))} ${currency}`;
}
