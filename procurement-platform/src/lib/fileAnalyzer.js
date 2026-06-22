import { analyzeStockMatrix } from "@/lib/stockImport";

function extensionOf(fileName) {
  return String(fileName || "").split(".").pop()?.toLowerCase() || "";
}

async function spreadsheetMatrix(file) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  if (!workbook.SheetNames.length) throw new Error(`${file.name}: Okunabilir sheet bulunamadı.`);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) throw new Error(`${file.name}: "${sheetName}" sheet'i okunamadı.`);
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: false, blankrows: false });
  return { matrix, sheetName, sourceType: "spreadsheet" };
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
  if (!["xlsx", "xls", "csv", "pdf"].includes(extension)) {
    throw new Error(`${file.name}: Desteklenmeyen dosya tipi. XLSX, XLS, CSV veya PDF yükleyin.`);
  }
  const extracted = extension === "pdf" ? await pdfMatrix(file) : await spreadsheetMatrix(file);
  const analysis = analyzeStockMatrix(extracted.matrix, {
    requiresQuantity: options.requiresQuantity,
    fileName: file.name,
    sheetName: extracted.sheetName,
  });
  return { ...extracted, ...analysis, fileName: file.name };
}
