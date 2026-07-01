import { NextResponse } from "next/server";

const TARGETS = ["USD", "EUR", "GBP"];

function textBetween(text, start, end) {
  const match = String(text || "").match(new RegExp(`${start}([\\s\\S]*?)${end}`));
  return match?.[1]?.trim() || "";
}

function normalizeRatesFromTcmb(xmlText) {
  const rates = { TRY: 1 };
  const currencyBlocks = String(xmlText || "").match(/<Currency[\s\S]*?<\/Currency>/g) || [];
  TARGETS.forEach((currency) => {
    const block = currencyBlocks.find((row) =>
      row.includes(`CurrencyCode="${currency}"`) || row.includes(`Kod="${currency}"`)
    ) || "";
    const unit = Number(textBetween(block, "<Unit>", "</Unit>")) || 1;
    const selling = Number(textBetween(block, "<ForexSelling>", "</ForexSelling>"));
    if (selling > 0) rates[currency] = selling / unit;
  });
  const date = String(xmlText || "").match(/Tarih="([^"]+)"/)?.[1] || new Date().toISOString().slice(0, 10);
  return {
    date,
    source: "TCMB döviz satış",
    rates,
  };
}

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

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Kur servisi yanıt vermedi: ${response.status}`);
  return response.text();
}

export async function GET() {
  const errors = [];

  try {
    const data = await fetchText("https://www.tcmb.gov.tr/kurlar/today.xml");
    const result = normalizeRatesFromTcmb(data);
    if (TARGETS.every((currency) => Number(result.rates[currency] || 0) > 0)) {
      return NextResponse.json(result);
    }
    errors.push("TCMB eksik kur döndürdü.");
  } catch (error) {
    errors.push(error?.message || "TCMB alınamadı.");
  }

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
