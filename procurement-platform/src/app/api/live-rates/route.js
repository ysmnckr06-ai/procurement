import { NextResponse } from "next/server";

const TARGETS = ["USD", "EUR", "GBP"];

function normalizeRatesFromFrankfurter(data) {
  const rates = { TRY: 1 };
  TARGETS.forEach((currency) => {
    const tryToCurrency = Number(data?.rates?.[currency] || 0);
    if (tryToCurrency > 0) rates[currency] = 1 / tryToCurrency;
  });
  return {
    date: data?.date || new Date().toISOString().slice(0, 10),
    source: "Frankfurter / ECB",
    rates,
  };
}

function normalizeRatesFromOpenExchange(data) {
  const usdTry = Number(data?.rates?.TRY || 0);
  const rates = { TRY: 1 };
  if (usdTry > 0) {
    rates.USD = usdTry;
    rates.EUR = Number(data?.rates?.TRY || 0) / Number(data?.rates?.EUR || 0);
    rates.GBP = Number(data?.rates?.TRY || 0) / Number(data?.rates?.GBP || 0);
  }
  return {
    date: data?.timestamp ? new Date(data.timestamp * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    source: "OpenExchangeRates",
    rates,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Kur servisi yanıt vermedi: ${response.status}`);
  return response.json();
}

export async function GET() {
  const errors = [];

  try {
    const data = await fetchJson("https://api.frankfurter.app/latest?from=TRY&to=USD,EUR,GBP");
    const result = normalizeRatesFromFrankfurter(data);
    if (TARGETS.every((currency) => Number(result.rates[currency] || 0) > 0)) {
      return NextResponse.json(result);
    }
    errors.push("Frankfurter eksik kur döndürdü.");
  } catch (error) {
    errors.push(error?.message || "Frankfurter alınamadı.");
  }

  try {
    const data = await fetchJson("https://open.er-api.com/v6/latest/USD");
    const result = normalizeRatesFromOpenExchange(data);
    if (TARGETS.every((currency) => Number(result.rates[currency] || 0) > 0)) {
      return NextResponse.json(result);
    }
    errors.push("Yedek servis eksik kur döndürdü.");
  } catch (error) {
    errors.push(error?.message || "Yedek kur servisi alınamadı.");
  }

  return NextResponse.json(
    {
      date: new Date().toISOString().slice(0, 10),
      source: "unavailable",
      rates: { TRY: 1 },
      errors,
    },
    { status: 503 },
  );
}
