"use client";

import { supabase } from "../../../lib/supabase.js";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { createWorker } from "tesseract.js";
import { useEffect, useMemo, useRef, useState } from "react";

export default function TaleplerPage() {
  const fileInputRef = useRef(null);
  const imageRef = useRef(null);
  const imageSectionRef = useRef(null);
  const [activeSelectionType, setActiveSelectionType] = useState("");
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionBox, setSelectionBox] = useState(null);
  const [productArea, setProductArea] = useState(null);
  const [quantityArea, setQuantityArea] = useState(null);
  const [unitArea, setUnitArea] = useState(null);
  const [files, setFiles] = useState([]);
  const [parsedSources, setParsedSources] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedProductColumn, setSelectedProductColumn] = useState("");
  const [selectedQuantityColumn, setSelectedQuantityColumn] = useState("");
  const [selectedUnitColumn, setSelectedUnitColumn] = useState("");
  const [normalizedRows, setNormalizedRows] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [message, setMessage] = useState("");
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);

  const selectedSource = useMemo(() => {
    return parsedSources.find((item) => item.id === selectedSourceId);
  }, [parsedSources, selectedSourceId]);

  const columns = selectedSource?.columns || [];
  const previewRows = selectedSource?.rows?.slice(0, 8) || [];

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const normalizeText = (value) => {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/[|¦]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };
  const handleCreateMergedList = () => {
  if (parsedSources.length === 0) {
    setMessage("Önce en az bir kaynak yükleyin.");
    return;
  }

  const mergedMap = new Map();

  parsedSources.forEach((source) => {
    const rows = source.rows || [];

    rows.forEach((row) => {
      let urun = "";
      let miktar = 0;
      let birim = "";

      if (source.sourceType === "image-selected") {
        urun = normalizeText(row.urun);
        miktar = normalizeQuantity(row.miktar);
        birim = normalizeText(row.birim);
      } else if (source.sourceType === "pdf") {
        urun = normalizeText(row.aciklama || row.urun);
        miktar = normalizeQuantity(row.miktar);
        birim = normalizeText(row.birim);
      } else if (source.sourceType === "excel") {
        const keys = Object.keys(row);

        const productKey =
          keys.find((k) => k.toLocaleLowerCase("tr-TR").includes("ürün")) ||
          keys.find((k) => k.toLocaleLowerCase("tr-TR").includes("urun")) ||
          keys.find((k) => k.toLocaleLowerCase("tr-TR").includes("açıklama")) ||
          keys.find((k) => k.toLocaleLowerCase("tr-TR").includes("aciklama"));

        const quantityKey =
          keys.find((k) => k.toLocaleLowerCase("tr-TR").includes("miktar")) ||
          keys.find((k) => k.toLocaleLowerCase("tr-TR").includes("adet")) ||
          keys.find((k) => k.toLocaleLowerCase("tr-TR").includes("qty"));

        const unitKey =
          keys.find((k) => k.toLocaleLowerCase("tr-TR").includes("birim")) ||
          keys.find((k) => k.toLocaleLowerCase("tr-TR").includes("unit"));

        urun = normalizeText(productKey ? row[productKey] : "");
        miktar = normalizeQuantity(quantityKey ? row[quantityKey] : "");
        birim = normalizeText(unitKey ? row[unitKey] : "");
      }

      if (!urun) return;

      const key = `${urun.toLocaleLowerCase("tr-TR")}__${birim.toLocaleLowerCase("tr-TR")}`;

      if (!mergedMap.has(key)) {
        mergedMap.set(key, {
          urun,
          miktar,
          birim,
        });
      } else {
        const existing = mergedMap.get(key);
        existing.miktar += miktar;
        mergedMap.set(key, existing);
      }
    });
  });

  const result = Array.from(mergedMap.values()).map((item, index) => ({
    sira: index + 1,
    urun: item.urun,
    miktar: item.miktar,
    birim: item.birim,
  }));

  setNormalizedRows(result);
  setMessage("Tüm kaynaklar birleştirilerek icmalli liste oluşturuldu.");
  };

  const normalizeQuantity = (value) => {
    const raw = String(value ?? "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .trim();

    if (!raw) return 0;

    const numericMatch = raw
      .replace(/\s+/g, "")
      .replace(/,/g, ".")
      .match(/-?\d+(?:\.\d+)?/);

    if (!numericMatch) return 0;

    const num = Number(numericMatch[0]);
    return Number.isNaN(num) ? 0 : num;
  };

  const cleanOCRLines = (text) => {
    return String(text || "")
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean)
      .filter((line) => {
        const lower = line.toLocaleLowerCase("tr-TR");

        const banned =
          lower.includes("malzeme listesi") ||
          lower.includes("sira no") ||
          lower.includes("ürün kodu") ||
          lower.includes("urun kodu") ||
          lower.includes("açıklama") ||
          lower.includes("aciklama") ||
          lower.includes("miktar") ||
          lower.includes("birim");

        return !banned;
      });
  };

  const cleanProductLine = (line) => {
    let value = normalizeText(line);

    value = value
      .replace(/^\d+\s*/g, "")
      .replace(/^[-–—|]+/g, "")
      .replace(/\bPR[-\s]?\d+\b/gi, "")
      .replace(/\b[A-Z]{1,4}[-]?\d{2,}\b/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    return value;
  };

  const cleanUnitLine = (line) => {
    const value = normalizeText(line).toLocaleLowerCase("tr-TR");

    if (!value) return "";

    if (value.includes("adet") || value === "ad") return "Adet";
    if (value.includes("metre") || value === "mt" || value === "m") return "Metre";
    if (value.includes("takım") || value.includes("takim")) return "Takım";
    if (value.includes("tüp") || value.includes("tup")) return "Tüp";
    if (value.includes("plaka")) return "Plaka";
    if (value.includes("kutu")) return "Kutu";
    if (value.includes("paket")) return "Paket";
    if (value.includes("torba")) return "Torba";
    if (value.includes("kg")) return "Kg";
    if (value.includes("lt") || value === "l") return "Lt";

    return normalizeText(line);
  };

  const cleanQuantityLine = (line) => {
    const num = normalizeQuantity(line);
    return num ? num : "";
  };

  const getImageRelativePoint = (e) => {
    if (!imageRef.current) return null;

    const rect = imageRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    return { x, y };
  };

  const handleImageMouseDown = (e) => {
    const point = getImageRelativePoint(e);
    if (!point) return;

    setIsSelecting(true);
    setSelectionStart({ x: point.x, y: point.y });
    setSelectionBox({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    });
  };

  const handleImageMouseMove = (e) => {
    if (!isSelecting || !selectionStart) return;

    const point = getImageRelativePoint(e);
    if (!point) return;

    const x = Math.min(selectionStart.x, point.x);
    const y = Math.min(selectionStart.y, point.y);
    const width = Math.abs(point.x - selectionStart.x);
    const height = Math.abs(point.y - selectionStart.y);

    setSelectionBox({
      x,
      y,
      width,
      height,
    });
  };

 const startSelectingColumn = (type) => {
  if (!imagePreviewUrl) {
    alert("Önce bir görsel yükle.");
    return;
  }

  setActiveSelectionType(type);

  setSelectionBox(null);
  setSelectionStart(null);

  setTimeout(() => {
    imageSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, 100);
  };

  const handleImageMouseUp = () => {
    if (!isSelecting) return;

  if (!selectionBox?.width || !selectionBox?.height) {
    setIsSelecting(false);
    setSelectionStart(null);
    return;
  }

  if (selectionBox.width < 10 || selectionBox.height < 10) {
    alert("Alan çok küçük.");
    setSelectionBox(null);
    setIsSelecting(false);
    setSelectionStart(null);
    return;
  }

  if (!activeSelectionType) {
    alert("Önce hangi kolonu seçeceğini belirt.");
    setIsSelecting(false);
    setSelectionStart(null);
    return;
  }

  if (activeSelectionType === "product") {
    setProductArea({ ...selectionBox });
  } else if (activeSelectionType === "quantity") {
    setQuantityArea({ ...selectionBox });
  } else if (activeSelectionType === "unit") {
    setUnitArea({ ...selectionBox });
  }

  setActiveSelectionType("");
  setIsSelecting(false);
  setSelectionStart(null);
  setSelectionBox(null);
  };

  const clearSelections = () => {
  setProductArea(null);
  setQuantityArea(null);
  setUnitArea(null);
  setSelectionBox(null);
  setSelectionStart(null);
  setIsSelecting(false);
  setActiveSelectionType("");
  };

  const cropImageArea = (img, area) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;

    const sx = Math.round(area.x * scaleX);
    const sy = Math.round(area.y * scaleY);
    const sw = Math.round(area.width * scaleX);
    const sh = Math.round(area.height * scaleY);

   const scale = 2;

        canvas.width = sw * scale;
        canvas.height = sh * scale;

          ctx.drawImage(
      img,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      canvas.width,
      canvas.height
          );

    return canvas.toDataURL("image/png");
  };

  const recognizeImageFromArea = async (area) => {
  if (!imageRef.current || !area) return "";

  const croppedImage = cropImageArea(imageRef.current, area);
  const worker = await createWorker("tur+eng");

  try {
    const result = await worker.recognize(croppedImage);
    const text = result?.data?.text || "";

    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const cleanedLines = lines.filter((line) => {
      const upper = line.toUpperCase();

      if (
        upper.includes("ÜRÜN") ||
        upper.includes("KOD") ||
        upper.includes("AÇIKLAMA") ||
        upper.includes("MİKTAR") ||
        upper.includes("BİRİM") ||
        upper.includes("SIRA")
      ) {
        return false;
      }

      return true;
    });

    return cleanedLines.join("\n");
  } finally {
    await worker.terminate();
  }
  }; 

  const readExcelFile = async (file) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });

      const newSources = [];

      workbook.SheetNames.forEach((sheetName, index) => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        const detectedColumns =
          jsonData.length > 0 ? Object.keys(jsonData[0]) : [];

        newSources.push({
          id: `${file.name}-excel-${index}`,
          fileName: file.name,
          sourceType: "excel",
          label: `Excel - ${sheetName}`,
          rows: jsonData,
          columns: detectedColumns,
        });
      });

      setParsedSources((prev) => [...prev, ...newSources]);

      if (newSources.length > 0 && !selectedSourceId) {
        setSelectedSourceId(newSources[0].id);
      }

      setSelectedProductColumn("");
      setSelectedQuantityColumn("");
      setSelectedUnitColumn("");
      setNormalizedRows([]);
      setMessage("Excel okundu ✅");
    } catch (error) {
      console.error("Excel okuma hatası:", error);
      setMessage("Excel okuma hatası: " + error.message);
    }
  };

  const readPDFFile = async (file) => {
    try {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      const parsedRows = [];

      for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
        const page = await pdf.getPage(pageIndex);
        const content = await page.getTextContent();

        const textItems = content.items
          .filter((item) => item.str && item.str.trim())
          .map((item) => ({
            text: normalizeText(item.str),
            x: item.transform[4],
            y: item.transform[5],
          }));

        const rowMap = new Map();

        textItems.forEach((item) => {
          const yKey = Math.round(item.y / 3) * 3;

          if (!rowMap.has(yKey)) {
            rowMap.set(yKey, []);
          }

          rowMap.get(yKey).push(item);
        });

        const sortedRows = Array.from(rowMap.entries())
          .sort((a, b) => b[0] - a[0])
          .map(([, items]) =>
            items.sort((a, b) => a.x - b.x).map((item) => item.text)
          );

        sortedRows.forEach((cols) => {
          if (!cols.length) return;

          const firstCell = normalizeText(cols[0] || "").toLocaleLowerCase("tr-TR");
          const secondCell = normalizeText(cols[1] || "").toLocaleLowerCase("tr-TR");
          const thirdCell = normalizeText(cols[2] || "").toLocaleLowerCase("tr-TR");
          const fourthCell = normalizeText(cols[3] || "").toLocaleLowerCase("tr-TR");

          const isHeaderRow =
            firstCell.includes("ürün") ||
            firstCell.includes("urun") ||
            secondCell.includes("açıklama") ||
            secondCell.includes("aciklama") ||
            thirdCell.includes("birim") ||
            fourthCell.includes("miktar") ||
            fourthCell.includes("adet");

          if (isHeaderRow) return;

          parsedRows.push({
            satirNo: parsedRows.length + 1,
            urun: cols[0] || "",
            aciklama: cols[1] || "",
            birim: cols[2] || "",
            miktar: cols[3] || "",
            hamMetin: cols.join(" | "),
          });
        });
      }

      const cleanedRows = parsedRows.filter((row) => {
        return row.urun || row.aciklama || row.birim || row.miktar;
      });

      const detectedColumns =
        cleanedRows.length > 0 ? Object.keys(cleanedRows[0]) : [];

      const newSource = {
        id: `${file.name}-pdf-0`,
        fileName: file.name,
        sourceType: "pdf",
        label: `PDF - ${file.name}`,
        rows: cleanedRows,
        columns: detectedColumns,
      };

      setParsedSources((prev) => [...prev, newSource]);

      if (!selectedSourceId) {
        setSelectedSourceId(newSource.id);
      }

      setSelectedProductColumn("");
      setSelectedQuantityColumn("");
      setSelectedUnitColumn("");
      setNormalizedRows([]);
      setMessage("PDF okundu ✅");
    } catch (error) {
      console.error("PDF okuma hatası:", error);
      setMessage("PDF okuma hatası: " + error.message);
    }
  };

  const handleProcessSelectedAreas = async () => {
    if (!imageRef.current || !imageFile) {
      alert("Önce bir görsel yükle.");
      return;
    }

    if (!productArea || !quantityArea || !unitArea) {
      alert("Lütfen ürün, miktar ve birim alanlarını seç.");
      return;
    }

    setProcessingImage(true);
    setMessage("Seçilen alanlar OCR ile işleniyor...");

    try {
      const [productText, quantityText, unitText] = await Promise.all([
        recognizeImageFromArea(productArea),
        recognizeImageFromArea(quantityArea),
        recognizeImageFromArea(unitArea),
      ]);

      const productLines = cleanOCRLines(productText)
        .map(cleanProductLine)
        .filter(Boolean);

      const quantityLines = cleanOCRLines(quantityText)
        .map(cleanQuantityLine)
        .filter((item) => item !== "");

      const unitLines = cleanOCRLines(unitText)
        .map(cleanUnitLine)
        .filter(Boolean);

      const rowCount = Math.max(
        productLines.length,
        quantityLines.length,
        unitLines.length
      );

      if (rowCount === 0) {
        setMessage("Görselden veri okunamadı.");
        setProcessingImage(false);
        return;
      }

      const parsedRows = Array.from({ length: rowCount }, (_, index) => ({
        satirNo: index + 1,
        urun: productLines[index] || "",
        miktar: quantityLines[index] ?? "",
        birim: unitLines[index] || "",
        hamMetin: [
          productLines[index] || "",
          quantityLines[index] ?? "",
          unitLines[index] || "",
        ]
          .filter(Boolean)
          .join(" | "),
      })).filter((row) => row.urun || row.miktar || row.birim);

      const newSource = {
        id: `${imageFile.name}-image-selected-${Date.now()}`,
        fileName: imageFile.name,
        sourceType: "image-selected",
        label: `Görsel Seçimli - ${imageFile.name}`,
        rows: parsedRows,
        columns: ["satirNo", "urun", "miktar", "birim", "hamMetin"],
      };

      setParsedSources((prev) => {
        const filtered = prev.filter(
          (item) => !(item.fileName === imageFile.name && item.sourceType === "image-selected")
        );
        return [...filtered, newSource];
      });

      setSelectedSourceId(newSource.id);
      setSelectedProductColumn("urun");
      setSelectedQuantityColumn("miktar");
      setSelectedUnitColumn("birim");
      setNormalizedRows([]);

      if (
        productLines.length !== quantityLines.length ||
        productLines.length !== unitLines.length
      ) {
        setMessage(
          `Hazır ✅ Ama dikkat: satır sayıları tam eşleşmedi. Ürün: ${productLines.length}, Miktar: ${quantityLines.length}, Birim: ${unitLines.length}`
        );
      } else {
        setMessage("Görsel alanları başarıyla işlendi ✅");
      }
    } catch (error) {
      console.error("Seçili alan OCR hatası:", error);
      setMessage("Seçili alan işleme hatası: " + error.message);
    } finally {
      setProcessingImage(false);
    }
  };

  const handleFileChange = async (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (!selectedFiles.length) return;

    setFiles((prev) => [...prev, ...selectedFiles]);
    setMessage("");

    for (const file of selectedFiles) {
      if (file.name.match(/\.(xlsx|xls)$/i)) {
        await readExcelFile(file);
      } else if (file.name.match(/\.pdf$/i)) {
        await readPDFFile(file);
      } else if (file.name.match(/\.(png|jpg|jpeg)$/i)) {
        if (imagePreviewUrl) {
          URL.revokeObjectURL(imagePreviewUrl);
        }

        const previewUrl = URL.createObjectURL(file);
        setImagePreviewUrl(previewUrl);
        setImageFile(file);
        setMessage("Görsel yüklendi. Şimdi alanları seçip işle.");
      }
    }

    e.target.value = "";
  };

  const handleRemoveFile = (indexToRemove) => {
    const removedFile = files[indexToRemove];
    const newFiles = files.filter((_, index) => index !== indexToRemove);

    setFiles(newFiles);

    const newParsedSources = parsedSources.filter(
      (item) => item.fileName !== removedFile?.name
    );

    setParsedSources(newParsedSources);

    if (removedFile?.name === imageFile?.name) {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }

      setImagePreviewUrl("");
      setImageFile(null);
      clearSelections();
    }

    if (
      selectedSourceId &&
      parsedSources.some(
        (item) =>
          item.id === selectedSourceId && item.fileName === removedFile?.name
      )
    ) {
      setSelectedSourceId(newParsedSources[0]?.id || "");
      setSelectedProductColumn("");
      setSelectedQuantityColumn("");
      setSelectedUnitColumn("");
      setNormalizedRows([]);
    }
  };

  const handleStartProcess = async () => {
    if (files.length === 0) {
      setMessage("Lütfen önce dosya yükleyin.");
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;

      if (!user) {
        setMessage("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
        setUploading(false);
        return;
      }

      for (const file of files) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${fileExt}`;

        const filePath = `${user.id}/${fileName}`;

        const { error } = await supabase.storage
          .from("talepler")
          .upload(filePath, file);

        if (error) {
          throw error;
        }
      }

      setMessage("Dosyalar başarıyla Supabase Storage'a yüklendi.");
    } catch (error) {
      console.error("Yükleme hatası:", error);
      setMessage("Yükleme hatası: " + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleCreatePreviewList = () => {
    if (!selectedSource) {
      setMessage("Lütfen bir veri kaynağı seçin.");
      return;
    }

    if (
      !selectedProductColumn ||
      !selectedQuantityColumn ||
      !selectedUnitColumn
    ) {
      setMessage("Lütfen ürün, miktar ve birim kolonlarını seçin.");
      return;
    }

    let allRows = [];

    parsedSources.forEach(source => {
    if (!source.rows) return;

    source.rows.forEach(row => {
    allRows.push(row);
      });
      });

    const mergedMap = new Map();

      allRows.forEach((row) => {
      const urun = normalizeText(row[selectedProductColumn]);
      const birim = normalizeText(row[selectedUnitColumn]);
      const miktar = normalizeQuantity(row[selectedQuantityColumn]);

      if (!urun) return;

      const key = `${urun.toLocaleLowerCase("tr-TR")}__${birim.toLocaleLowerCase("tr-TR")}`;

      if (!mergedMap.has(key)) {
        mergedMap.set(key, {
          urun,
          miktar,
          birim,
        });
      } else {
        const existing = mergedMap.get(key);
        existing.miktar += miktar;
        mergedMap.set(key, existing);
      }
    });

    const result = Array.from(mergedMap.values()).map((item, index) => ({
      sira: index + 1,
      urun: item.urun,
      miktar: item.miktar,
      birim: item.birim,
    }));

    setNormalizedRows(result);
    setMessage("Talep listesi icmalli olarak oluşturuldu.");
  };

  const handleExportExcel = () => {
    if (normalizedRows.length === 0) {
      alert("Önce liste oluşturmalısın.");
      return;
    }

    const worksheetData = normalizedRows.map((row) => ({
      Sıra: row.sira,
      Ürün: row.urun,
      Miktar: row.miktar,
      Birim: row.birim,
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Talep Listesi");
    XLSX.writeFile(workbook, "talep_listesi.xlsx");
  };

  const handleExportPDF = () => {
    if (normalizedRows.length === 0) {
      alert("Önce liste oluşturmalısın.");
      return;
    }

    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("Talep Listesi", 14, 15);

    const tableData = normalizedRows.map((row) => [
      row.sira,
      row.urun,
      row.miktar,
      row.birim,
    ]);

    autoTable(doc, {
      startY: 25,
      head: [["Sıra", "Ürün", "Miktar", "Birim"]],
      body: tableData,
      styles: {
        fontSize: 10,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [31, 41, 55],
      },
    });

    doc.save("talep_listesi.pdf");
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-2xl bg-white p-6 shadow-sm md:p-8">
          <h1 className="text-3xl font-bold text-slate-800">Talepler</h1>
          <p className="mt-2 text-slate-600">
            Excel, PDF veya görsel yükleyin. Okunan veri kaynağından ürün,
            miktar ve birim kolonlarını seçerek ön izleme liste oluşturacağız.
          </p>

          <div className="mt-8 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <h2 className="text-xl font-semibold text-slate-800">
              Dosya Yükleme Alanı
            </h2>
            <p className="mt-2 text-slate-600">
              Birden fazla dosya seçebilirsin. Excel, PDF ve görsel dosyalarını
              yükleyebilirsin.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg"
              onChange={handleFileChange}
              className="hidden"
            />

            <button
              onClick={handleButtonClick}
              className="mt-5 rounded-xl bg-slate-800 px-6 py-3 text-white hover:bg-slate-700"
            >
              Dosya Seç
            </button>
          </div>

          {imagePreviewUrl && (
            <div ref={imageSectionRef} className="mt-8">
              <h3 className="text-xl font-semibold text-slate-800">Görsel Seçim</h3>

              <div className="mt-4 flex gap-3 flex-wrap border-4 border-red-500 p-4 bg-yellow-100">
<button
  type="button"
  onClick={() => startSelectingColumn("product")}
  style={{
    backgroundColor: "#2563eb",
    color: "white",
    padding: "10px 16px",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
  }}
>
  Ürün Kolonu Seç
</button>

<button
  type="button"
  onClick={() => startSelectingColumn("quantity")}
  style={{
    backgroundColor: "#16a34a",
    color: "white",
    padding: "10px 16px",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
  }}
>
  Miktar Kolonu Seç
</button>

<button
  type="button"
  onClick={() => startSelectingColumn("unit")}
  style={{
    backgroundColor: "#f97316",
    color: "white",
    padding: "10px 16px",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
  }}
>
  Birim Kolonu Seç
</button>

<button
  type="button"
  onClick={clearSelections}
  style={{
    backgroundColor: "#e2e8f0",
    color: "#1e293b",
    padding: "10px 16px",
    borderRadius: "12px",
    border: "1px solid #cbd5e1",
    cursor: "pointer",
  }}
>
  Seçimleri Temizle
</button>

</div>

<div className="mt-3 text-sm text-slate-700">
  {activeSelectionType === "product" && "Şimdi görsel üzerinde ürün kolonunu seç."}
  {activeSelectionType === "quantity" && "Şimdi görsel üzerinde miktar kolonunu seç."}
  {activeSelectionType === "unit" && "Şimdi görsel üzerinde birim kolonunu seç."}
  {!activeSelectionType &&
    "Yukarıdaki butonlardan birine bas, sayfa görsele gelsin; sonra kolon alanını mouse ile seç."}
</div>

              <div
                className="mt-4"
                style={{ position: "relative", display: "inline-block" }}
                onMouseDown={handleImageMouseDown}
                onMouseMove={handleImageMouseMove}
                onMouseUp={handleImageMouseUp}
              >
                <img
                  ref={imageRef}
                  src={imagePreviewUrl}
                  alt="Yüklenen görsel"
                  style={{
                    maxWidth: "100%",
                    display: "block",
                    userSelect: "none",
                  }}
                  draggable={false}
                />

                {selectionBox && (
                  <div
                    style={{
                      position: "absolute",
                      border: "2px solid red",
                      left: selectionBox.x,
                      top: selectionBox.y,
                      width: selectionBox.width,
                      height: selectionBox.height,
                      pointerEvents: "none",
                    }}
                  />
                )}

                {productArea && (
                  <div
                    style={{
                      position: "absolute",
                      border: "2px solid blue",
                      left: productArea.x,
                      top: productArea.y,
                      width: productArea.width,
                      height: productArea.height,
                      pointerEvents: "none",
                    }}
                  />
                )}

                {quantityArea && (
                  <div
                    style={{
                      position: "absolute",
                      border: "2px solid green",
                      left: quantityArea.x,
                      top: quantityArea.y,
                      width: quantityArea.width,
                      height: quantityArea.height,
                      pointerEvents: "none",
                    }}
                  />
                )}

                {unitArea && (
                  <div
                    style={{
                      position: "absolute",
                      border: "2px solid orange",
                      left: unitArea.x,
                      top: unitArea.y,
                      width: unitArea.width,
                      height: unitArea.height,
                      pointerEvents: "none",
                    }}
                  />
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleProcessSelectedAreas}
                  disabled={processingImage}
                  className="rounded-xl bg-slate-800 px-4 py-2 text-white disabled:opacity-60"
                >
                  {processingImage ? "İşleniyor..." : "Seçilen Alanları İşle"}
                </button>

                <button
                  type="button"
                  onClick={clearSelections}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-slate-800"
                >
                  Seçimleri Temizle
                </button>
              </div>
            </div>
          )}

          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="text-xl font-semibold text-slate-800">
                Yüklenen Dosyalar
              </h3>

              <button
                onClick={handleStartProcess}
                disabled={uploading}
                className="rounded-xl bg-emerald-600 px-5 py-3 text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {uploading ? "Yükleniyor..." : "Storage'a Yükle"}
              </button>
            </div>

            {files.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-slate-500">
                Henüz dosya yüklenmedi.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {files.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div>
                      <p className="break-all font-medium text-slate-800">
                        {file.name}
                      </p>
                      <p className="text-sm text-slate-500">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>

                    <button
                      onClick={() => handleRemoveFile(index)}
                      className="font-medium text-red-600 hover:underline"
                    >
                      Kaldır
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {parsedSources.length > 0 && (
            <div className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <h2 className="text-2xl font-bold text-slate-800">
                Dosya Analizi
              </h2>
              <p className="mt-2 text-slate-600">
                Okunan veri kaynağını seçip kolon eşleştirmesi yapabilirsin.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Veri Kaynağı Seç
                  </label>
                  <select
                    value={selectedSourceId}
                    onChange={(e) => {
                      setSelectedSourceId(e.target.value);
                      setSelectedProductColumn("");
                      setSelectedQuantityColumn("");
                      setSelectedUnitColumn("");
                      setNormalizedRows([]);
                    }}
                    className="w-full rounded-xl border border-slate-300 p-3 outline-none"
                  >
                    <option value="">Seçiniz</option>
                    {parsedSources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Ürün kolonu
                  </label>
                  <select
                    value={selectedProductColumn}
                    onChange={(e) => setSelectedProductColumn(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 outline-none"
                  >
                    <option value="">Seçiniz</option>
                    {columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Miktar kolonu
                  </label>
                  <select
                    value={selectedQuantityColumn}
                    onChange={(e) => setSelectedQuantityColumn(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 outline-none"
                  >
                    <option value="">Seçiniz</option>
                    {columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Birim kolonu
                  </label>
                  <select
                    value={selectedUnitColumn}
                    onChange={(e) => setSelectedUnitColumn(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-3 outline-none"
                  >
                    <option value="">Seçiniz</option>
                    {columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                onClick={handleCreatePreviewList}
                className="mt-6 rounded-xl bg-slate-800 px-5 py-3 text-white hover:bg-slate-700"
              >
                Ön İzleme Listesi Oluştur
              </button>
                <button
                onClick={handleCreateMergedList}
                className="mt-6 ml-3 bg-emerald-600 text-white px-5 py-3 rounded-xl hover:bg-emerald-700"
                    >
                Tüm Kaynakları Birleştir
                  </button>      

              <div className="mt-8">
                <h3 className="text-xl font-semibold text-slate-800">
                  Dosya Ön İzleme
                </h3>

                {previewRows.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-slate-500">
                    Görüntülenecek veri bulunamadı.
                  </div>
                ) : (
                  <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-slate-100">
                        <tr>
                          {columns.map((col) => (
                            <th
                              key={col}
                              className="min-w-[180px] whitespace-nowrap border border-slate-200 px-4 py-3 text-left font-semibold text-slate-700"
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="border-b last:border-b-0">
                            {columns.map((col) => (
                              <td
                                key={col}
                                className="min-w-[160px] break-words px-4 py-3 align-top text-slate-600"
                              >
                                {String(row[col] ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-8">
                <h3 className="text-xl font-semibold text-slate-800">
                  Oluşturulan Talep Ön Listesi
                </h3>

                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    onClick={handleCreatePreviewList}
                    className="rounded-xl bg-blue-600 px-5 py-2 text-white"
                  >
                    Listeyi Oluştur
                  </button>

                  <div className="relative inline-block">
                    <button
                      onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                      className="rounded-xl bg-slate-800 px-5 py-2 text-white"
                    >
                      İndir
                    </button>

                    {showDownloadMenu && (
                      <div className="absolute z-50 mt-2 w-48 rounded-xl border border-slate-200 bg-white shadow-lg">
                        <button
                          onClick={() => {
                            handleExportExcel();
                            setShowDownloadMenu(false);
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-slate-100"
                        >
                          Excel olarak indir
                        </button>
                        <button
                          onClick={() => {
                            handleExportPDF();
                            setShowDownloadMenu(false);
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-slate-100"
                        >
                          PDF olarak indir
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {normalizedRows.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-slate-500">
                    Henüz talep ön listesi oluşturulmadı.
                  </div>
                ) : (
                  <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="border border-slate-200 px-4 py-3 text-left">Sıra</th>
                          <th className="border border-slate-200 px-4 py-3 text-left">Ürün</th>
                          <th className="border border-slate-200 px-4 py-3 text-left">Miktar</th>
                          <th className="border border-slate-200 px-4 py-3 text-left">Birim</th>
                        </tr>
                      </thead>
                      <tbody>
                        {normalizedRows.map((row) => (
                          <tr key={row.sira}>
                            <td className="border border-slate-200 px-4 py-3">{row.sira}</td>
                            <td className="border border-slate-200 px-4 py-3">{row.urun}</td>
                            <td className="border border-slate-200 px-4 py-3">{row.miktar}</td>
                            <td className="border border-slate-200 px-4 py-3">{row.birim}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {message && (
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {message}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}