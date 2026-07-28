import { analyzeStockMatrix } from "@/lib/stockImport";

const NON_IMPORT_SHEET_NAMES = new Set(["kullanim kilavuzu", "doldurulmus ornek"]);
const MAX_IMPORT_FILE_BYTES = 15 * 1024 * 1024;
const MAX_IMPORT_SHEETS = 50;
const MAX_IMPORT_ROWS_PER_SHEET = 25_000;

function normalizedSheetName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extensionOf(fileName) {
  return String(fileName || "").split(".").pop()?.toLowerCase() || "";
}

export function analyzeStockSheets(sheets, options = {}) {
  const importSheets = sheets.filter(({ sheetName }) => !NON_IMPORT_SHEET_NAMES.has(normalizedSheetName(sheetName)));
  const candidates = (importSheets.length ? importSheets : sheets).map(({ sheetName, matrix }) => {
    const analysis = analyzeStockMatrix(matrix, {
      requiresQuantity: options.requiresQuantity,
      fileName: options.fileName,
      sheetName,
    });
    return { matrix, sheetName, sourceType: "spreadsheet", fileName: options.fileName, ...analysis };
  });
  const suitableSheets = candidates.filter((candidate) => candidate.missingFields.length === 0 && candidate.parsedRows.length > 0);
  const ranked = [...(suitableSheets.length ? suitableSheets : candidates)].sort((a, b) =>
    b.parsedRows.length - a.parsedRows.length
      || b.overallConfidence - a.overallConfidence
      || b.rows.length - a.rows.length);
  if (!ranked.length) throw new Error(`${options.fileName}: Okunabilir worksheet bulunamadı.`);
  return {
    selected: ranked[0],
    candidates,
    suitableSheetNames: suitableSheets.map((candidate) => candidate.sheetName),
  };
}

async function spreadsheetAnalysis(file, options) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    sheetRows: MAX_IMPORT_ROWS_PER_SHEET,
  });
  if (workbook.SheetNames.length > MAX_IMPORT_SHEETS) {
    throw new Error(`${file.name}: En fazla ${MAX_IMPORT_SHEETS} çalışma sayfası içe aktarılabilir.`);
  }
  if (!workbook.SheetNames.length) throw new Error(`${file.name}: Okunabilir worksheet bulunamadı.`);
  const sheets = workbook.SheetNames.flatMap((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return [];
    const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: false, blankrows: false });
    return [{ sheetName, matrix }];
  });
  const result = analyzeStockSheets(sheets, { ...options, fileName: file.name });
  return {
    ...result.selected,
    sheetCandidates: result.candidates,
    suitableSheetNames: result.suitableSheetNames,
  };
}

export function pdfTextItemsToMatrix(items) {
  const lines = [];
  for (const item of items.filter((entry) => String(entry.str || "").trim())) {
    const x = Number(item.transform?.[4] || 0);
    const y = Number(item.transform?.[5] || 0);
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 3);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ text: String(item.str).trim(), x, width: Number(item.width || 0) });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const sorted = line.items.sort((a, b) => a.x - b.x);
      const cells = [];
      for (const item of sorted) {
        const previous = cells.at(-1);
        if (previous && item.x - previous.endX < 10) {
          previous.text = `${previous.text} ${item.text}`.trim();
          previous.endX = item.x + item.width;
        } else {
          cells.push({ text: item.text, endX: item.x + item.width });
        }
      }
      return cells.map((cell) => cell.text);
    })
    .filter((row) => row.some(Boolean));
}

async function pdfMatrix(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const matrix = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    matrix.push(...pdfTextItemsToMatrix(content.items));
  }
  if (!matrix.length) {
    throw new Error("Bu PDF metin içermiyor, Excel yükleyin veya OCR gerekir.");
  }
  return { matrix, sheetName: `PDF (${document.numPages} sayfa)`, sourceType: "pdf" };
}

export async function analyzeStockFile(file, options = {}) {
  const extension = extensionOf(file.name);
  if (!file.size) throw new Error(`${file.name}: Dosya boş görünüyor.`);
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error(`${file.name}: Dosya 15 MB sınırını aşıyor.`);
  }
  if (!["xlsx", "xls", "csv", "pdf"].includes(extension)) {
    throw new Error(`${file.name}: Desteklenmeyen dosya tipi. XLSX, XLS, CSV veya PDF yükleyin.`);
  }
  if (extension !== "pdf") return spreadsheetAnalysis(file, options);
  const extracted = await pdfMatrix(file);
  const analysis = analyzeStockMatrix(extracted.matrix, {
    requiresQuantity: options.requiresQuantity,
    fileName: file.name,
    sheetName: extracted.sheetName,
  });
  return { ...extracted, ...analysis, fileName: file.name };
}
