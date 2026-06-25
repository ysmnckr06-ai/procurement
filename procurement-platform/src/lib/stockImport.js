export const STOCK_IMPORT_ACCEPT = ".xlsx,.xls,.csv,.pdf";

export const STOCK_IMPORT_FIELDS = [
  { key: "productCode", label: "Ürün kodu", required: false },
  { key: "productName", label: "Ürün adı / açıklaması", required: true },
  { key: "brand", label: "Marka", required: false },
  { key: "unit", label: "Birim", required: false },
  { key: "quantity", label: "Miktar / stok", required: true },
  { key: "unitPrice", label: "Birim fiyat", required: false },
];

const COLUMN_ALIASES = {
  productCode: ["urun kodu", "malzeme kodu", "stok kodu", "product code", "product_code", "sku", "kod"],
  productName: ["urun adi", "urun aciklamasi", "malzeme adi", "malzeme aciklamasi", "product name", "product_name", "description", "aciklama", "urun", "malzeme"],
  brand: ["marka", "malzeme markasi", "malzeme markası", "urun markasi", "ürün markası", "brand", "uretici"],
  unit: ["birim", "unit", "olcu birimi"],
  quantity: ["stok miktari", "mevcut stok", "stok", "miktar", "adet", "qty", "quantity", "sayim", "count"],
  unitPrice: ["birim fiyat", "unit price", "fiyat", "price", "net fiyat"],
};

const UNIT_VALUES = new Set(["adet", "ad", "pcs", "pc", "kg", "gr", "g", "mt", "m", "metre", "cm", "mm", "lt", "l", "paket", "pk", "koli", "set", "takim"]);

export function normalizeImportHeader(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_/\\-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasScore(value, alias) {
  if (!value) return 0;
  if (value === alias) return 1;
  if (value.includes(alias) || alias.includes(value)) return Math.min(value.length, alias.length) >= 3 ? 0.82 : 0;
  const valueTokens = new Set(value.split(" "));
  const aliasTokens = alias.split(" ");
  const overlap = aliasTokens.filter((token) => valueTokens.has(token)).length;
  return overlap ? 0.55 + (0.2 * overlap / Math.max(valueTokens.size, aliasTokens.length)) : 0;
}

function headerFieldScore(value, field) {
  const normalized = normalizeImportHeader(value);
  return Math.max(0, ...COLUMN_ALIASES[field].map((alias) => aliasScore(normalized, normalizeImportHeader(alias))));
}

function normalizedMatrix(matrix) {
  const width = Math.max(0, ...matrix.map((row) => row.length));
  return matrix
    .map((row) => Array.from({ length: width }, (_, index) => String(row[index] ?? "").trim()))
    .filter((row) => row.some(Boolean));
}

export function detectHeaderRow(matrix) {
  const rows = normalizedMatrix(matrix);
  let best = { index: -1, score: 0, fieldCount: 0 };
  rows.slice(0, 20).forEach((row, index) => {
    const fieldScores = Object.keys(COLUMN_ALIASES).map((field) => Math.max(...row.map((cell) => headerFieldScore(cell, field))));
    const fieldCount = fieldScores.filter((score) => score >= 0.55).length;
    const score = fieldScores.reduce((sum, value) => sum + value, 0);
    if (fieldCount > best.fieldCount || (fieldCount === best.fieldCount && score > best.score)) best = { index, score, fieldCount };
  });
  return best.fieldCount >= 2 ? best : { index: -1, score: best.score, fieldCount: best.fieldCount };
}

export function parseStockNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const original = String(value ?? "").trim();
  if (/[a-zA-ZÇĞİÖŞÜçğıöşü]/.test(original)
    && !/^[-+]?\s*\d[\d.,\s]*(adet|ad|pcs|pc|kg|gr|g|mt|m|cm|mm|lt|l|try|tl|usd|eur)?$/i.test(original)) return null;
  let raw = original.replace(/\s/g, "");
  if (!raw || !/[0-9]/.test(raw)) return null;
  raw = raw.replace(/[^0-9,.-]/g, "");
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    raw = raw.replace(decimal === "," ? /\./g : /,/g, "").replace(decimal, ".");
  } else if (comma >= 0) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if ((raw.match(/\./g) || []).length > 1) {
    raw = raw.replace(/\./g, "");
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function columnStats(values) {
  const present = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  const numeric = present.filter((value) => parseStockNumber(value) !== null);
  const units = present.filter((value) => UNIT_VALUES.has(normalizeImportHeader(value)));
  const codeLike = present.filter((value) => value.length <= 28 && /[a-zA-Z]/.test(value) && /[0-9]/.test(value) && !/\s{2,}/.test(value));
  const alpha = present.filter((value) => /[a-zA-ZÇĞİÖŞÜçğıöşü]/.test(value) && parseStockNumber(value) === null);
  const averageLength = present.length ? present.reduce((sum, value) => sum + value.length, 0) / present.length : 0;
  const denominator = Math.max(1, present.length);
  return {
    present: present.length,
    numericRatio: numeric.length / denominator,
    unitRatio: units.length / denominator,
    codeRatio: codeLike.length / denominator,
    alphaRatio: alpha.length / denominator,
    averageLength,
    decimalRatio: numeric.filter((value) => /[.,]\d{2}$/.test(value)).length / denominator,
  };
}

function chooseUnique(candidates, used, minimum = 0.45) {
  const candidate = candidates.sort((a, b) => b.score - a.score).find((item) => !used.has(item.index) && item.score >= minimum);
  if (candidate) used.add(candidate.index);
  return candidate || null;
}

export function inferStockColumns(matrix, options = {}) {
  const rows = normalizedMatrix(matrix);
  const requiresQuantity = options.requiresQuantity !== false;
  const detectedHeader = detectHeaderRow(rows);
  const headerRowIndex = options.headerRowIndex ?? detectedHeader.index;
  const dataStartIndex = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
  const headers = headerRowIndex >= 0 ? rows[headerRowIndex] : [];
  const width = Math.max(0, ...rows.map((row) => row.length));
  const samplesByColumn = Array.from({ length: width }, (_, index) => rows.slice(dataStartIndex, dataStartIndex + 100).map((row) => row[index]));
  const stats = samplesByColumn.map(columnStats);
  const mapping = {};
  const confidence = {};
  const used = new Set();

  for (const field of Object.keys(COLUMN_ALIASES)) {
    const headerCandidates = headers.map((header, index) => ({ index, score: headerFieldScore(header, field) }));
    const match = chooseUnique(headerCandidates, used, 0.55);
    if (match) {
      mapping[field] = match.index;
      confidence[field] = match.score;
    }
  }

  const contentScores = {
    unit: stats.map((stat, index) => ({ index, score: stat.unitRatio })),
    productCode: stats.map((stat, index) => ({ index, score: stat.codeRatio * 0.9 + (stat.averageLength > 2 && stat.averageLength < 24 ? 0.1 : 0) })),
    productName: stats.map((stat, index) => ({ index, score: stat.alphaRatio * 0.55 + Math.min(stat.averageLength / 45, 0.45) })),
    quantity: stats.map((stat, index) => ({ index, score: stat.numericRatio * 0.9 + (stat.decimalRatio < 0.5 ? 0.1 : 0) })),
    unitPrice: stats.map((stat, index) => ({ index, score: stat.numericRatio * 0.65 + stat.decimalRatio * 0.35 })),
    brand: stats.map((stat, index) => ({ index, score: stat.alphaRatio * 0.55 + (stat.averageLength >= 2 && stat.averageLength <= 20 ? 0.2 : 0) })),
  };

  for (const field of ["unit", "productCode", "productName", "quantity", "unitPrice", "brand"]) {
    if (mapping[field] !== undefined) continue;
    const minimum = field === "brand" || field === "unitPrice" ? 0.66 : 0.48;
    const match = chooseUnique(contentScores[field], used, minimum);
    mapping[field] = match?.index ?? null;
    confidence[field] = match?.score ?? 0;
  }

  if (!requiresQuantity) {
    mapping.quantity = mapping.quantity ?? null;
  }
  const columns = Array.from({ length: width }, (_, index) => ({
    index,
    label: headers[index] || `Kolon ${index + 1}`,
    samples: samplesByColumn[index].filter((value) => String(value ?? "").trim()).slice(0, 3),
  }));
  return { rows, headerRowIndex, dataStartIndex, columns, mapping, confidence };
}

export function validateStockImportColumns(mapping, requiresQuantity) {
  const missing = [];
  if (mapping.productName === null || mapping.productName === undefined) missing.push("Ürün adı / açıklaması");
  if (requiresQuantity && (mapping.quantity === null || mapping.quantity === undefined)) missing.push("Miktar / stok");
  return missing;
}

export function buildStockImportRows(analysis, mapping, requiresQuantity, fileName, sheetName) {
  if (validateStockImportColumns(mapping, requiresQuantity).length) return [];
  return analysis.rows.slice(analysis.dataStartIndex).flatMap((source, index) => {
    const productName = String(source[mapping.productName] ?? "").trim();
    const quantity = requiresQuantity ? parseStockNumber(source[mapping.quantity]) : 0;
    if (!productName || (requiresQuantity && quantity === null)) return [];
    return [{
      rowNumber: analysis.dataStartIndex + index + 1,
      fileName,
      sheetName,
      productCode: mapping.productCode !== null ? String(source[mapping.productCode] ?? "").trim() : "",
      productName,
      brand: mapping.brand !== null ? String(source[mapping.brand] ?? "").trim() : "",
      unit: mapping.unit !== null ? String(source[mapping.unit] ?? "").trim() || "adet" : "adet",
      quantity,
      unitPrice: mapping.unitPrice !== null ? parseStockNumber(source[mapping.unitPrice]) : null,
    }];
  });
}

export function analyzeStockMatrix(matrix, options = {}) {
  const inferred = inferStockColumns(matrix, options);
  const requiresQuantity = options.requiresQuantity !== false;
  const mapping = { ...inferred.mapping, ...(options.mapping || {}) };
  const confidence = { ...inferred.confidence };
  Object.keys(options.mapping || {}).forEach((field) => { confidence[field] = 1; });
  const missingFields = validateStockImportColumns(mapping, requiresQuantity);
  const weakFields = Object.entries(mapping)
    .filter(([field, column]) => column !== null && confidence[field] < 0.6)
    .map(([field]) => STOCK_IMPORT_FIELDS.find((item) => item.key === field)?.label || field);
  const parsedRows = buildStockImportRows(inferred, mapping, requiresQuantity, options.fileName, options.sheetName);
  const requiredScores = [confidence.productName || 0, ...(requiresQuantity ? [confidence.quantity || 0] : [])];
  const overallConfidence = requiredScores.length ? Math.round(requiredScores.reduce((sum, score) => sum + score, 0) / requiredScores.length * 100) : 0;
  return { ...inferred, mapping, confidence, missingFields, weakFields, parsedRows, overallConfidence };
}

// Compatibility helpers for callers that already provide object rows.
export function mapStockImportColumns(headers) {
  const analysis = inferStockColumns([headers]);
  return Object.fromEntries(Object.entries(analysis.mapping).map(([field, index]) => [field, index === null ? null : headers[index]]));
}

export function parseStockImportRows(rows, mapping, requiresQuantity, fileName, sheetName) {
  const headers = Object.keys(rows[0] || {});
  const matrix = [headers, ...rows.map((row) => headers.map((header) => row[header]))];
  const indexMapping = Object.fromEntries(Object.entries(mapping).map(([field, header]) => [field, header === null ? null : headers.indexOf(header)]));
  const analysis = inferStockColumns(matrix, { headerRowIndex: 0 });
  return buildStockImportRows(analysis, indexMapping, requiresQuantity, fileName, sheetName);
}

export function stockImportExpectedColumns(requiresQuantity) {
  return requiresQuantity
    ? "Zorunlu alanlar: ürün adı/açıklaması ve miktar/stok. Önizlemede ilgili kolonları manuel seçebilirsiniz."
    : "Zorunlu alan: ürün adı/açıklaması. Önizlemede ilgili kolonu manuel seçebilirsiniz.";
}
