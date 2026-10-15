import { NextResponse } from "next/server";

const TARGETS = ["USD", "EUR", "GBP"];

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  const turkishDate = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (turkishDate) {
    return `${turkishDate[3]}-${turkishDate[2]}-${turkishDate[1]}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

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
  const date = normalizeIsoDate(String(xmlText || "").match(/Tarih="([^"]+)"/)?.[1]);
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
    date: normalizeIsoDate(data?.date),
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

function tcmbArchiveUrl(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `https://www.tcmb.gov.tr/kurlar/${year}${month}/${day}${month}${year}.xml`;
}

// Geçmiş tarih: TCMB o gün kur yayımlamadıysa (hafta sonu/tatil) en fazla 7 gün
// geriye gidilir; dönen "date" kullanılan yayın tarihidir.
async function historicalRates(isoDate) {
  const errors = [];
  const start = new Date(`${isoDate}T12:00:00Z`);
  for (let back = 0; back <= 7; back += 1) {
    const day = new Date(start.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    try {
      const response = await fetch(tcmbArchiveUrl(day), { cache: "force-cache" });
      if (!response.ok) continue;
      const result = normalizeRatesFromTcmb(await response.text());
      if (TARGETS.every((currency) => Number(result.rates[currency] || 0) > 0)) {
        return NextResponse.json({ ...result, requestedDate: isoDate, date: day });
      }
    } catch (error) {
      errors.push(error?.message || "TCMB arşivi alınamadı.");
      break;
    }
  }
  try {
    const data = await fetchJson(`https://api.frankfurter.app/${isoDate}?from=TRY&to=USD,EUR,GBP`);
    const result = normalizeRatesFromFrankfurter(data);
    if (TARGETS.every((currency) => Number(result.rates[currency] || 0) > 0)) {
      return NextResponse.json({ ...result, requestedDate: isoDate });
    }
  } catch (error) {
    errors.push(error?.message || "Frankfurter alınamadı.");
  }
  return NextResponse.json({ requestedDate: isoDate, source: "unavailable", rates: { TRY: 1 }, errors }, { status: 503 });
}

export async function GET(request) {
  const errors = [];
  const requestedDate = new URL(request.url).searchParams.get("date");
  if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate < new Date().toISOString().slice(0, 10)) {
    return historicalRates(requestedDate);
  }

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
