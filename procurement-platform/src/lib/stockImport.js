const COLUMN_ALIASES = {
  productCode: ["urun kodu", "product code", "product_code", "kod"],
  productName: ["urun adi", "urun aciklamasi", "product name", "product_name", "aciklama", "urun"],
  brand: ["marka", "brand"],
  unit: ["birim", "unit"],
  quantity: ["stok", "mevcut stok", "quantity", "miktar", "adet", "sayim"],
};

export const STOCK_IMPORT_ACCEPT = ".xlsx,.xls,.csv";

export function normalizeImportHeader(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function mapStockImportColumns(headers) {
  const normalizedHeaders = headers.map((header) => [header, normalizeImportHeader(header)]);
  return Object.fromEntries(
    Object.entries(COLUMN_ALIASES).map(([field, aliases]) => {
      const normalizedAliases = aliases.map(normalizeImportHeader);
      const match = normalizedHeaders.find(([, header]) => normalizedAliases.includes(header));
      return [field, match?.[0] || null];
    }),
  );
}

export function validateStockImportColumns(mapping, requiresQuantity) {
  const missing = [];
  if (!mapping.productName) missing.push("urun adi / urun aciklamasi / product_name");
  if (requiresQuantity && !mapping.quantity) missing.push("stok / mevcut stok / quantity");
  return missing;
}

export function parseStockNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const decimalSeparator = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? "," : ".";
  const cleaned = raw
    .replace(new RegExp(`[^0-9${decimalSeparator === "," ? "," : "\\."}-]`, "g"), "")
    .replace(decimalSeparator, ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStockImportRows(rows, mapping, requiresQuantity, fileName, sheetName) {
  return rows.flatMap((source, index) => {
    const productName = String(source[mapping.productName] ?? "").trim();
    const quantity = requiresQuantity ? parseStockNumber(source[mapping.quantity]) : 0;
    if (!productName || (requiresQuantity && quantity === null)) return [];

    return [{
      rowNumber: index + 2,
      fileName,
      sheetName,
      productCode: String(source[mapping.productCode] ?? "").trim(),
      productName,
      brand: String(source[mapping.brand] ?? "").trim(),
      unit: String(source[mapping.unit] ?? "").trim() || "adet",
      quantity,
    }];
  });
}

export function stockImportExpectedColumns(requiresQuantity) {
  return requiresQuantity
    ? "Beklenen zorunlu kolonlar: urun adi/urun aciklamasi/product_name ve stok/mevcut stok/quantity."
    : "Beklenen zorunlu kolon: urun adi/urun aciklamasi/product_name.";
}
