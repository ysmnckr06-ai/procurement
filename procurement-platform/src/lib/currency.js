export const currencyOptions = ["TRY", "USD", "EUR", "GBP"];

export function getBaseCurrency(settings = {}) {
  return settings.base_currency || settings.default_currency || "TRY";
}

export function getExchangeRate(currency, settings = {}) {
  const baseCurrency = getBaseCurrency(settings);
  if (!currency || currency === baseCurrency) return 1;

  const key = `${String(currency).toLowerCase()}_rate`;
  return Number(settings[key] || 1);
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
