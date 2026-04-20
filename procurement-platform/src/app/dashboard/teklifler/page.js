"use client";

import { useState } from "react";

export default function TekliflerPage() {
  const [files, setFiles] = useState([]);
  const [parsedSources, setParsedSources] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");

  const [selectedCodeColumn, setSelectedCodeColumn] = useState("");
  const [selectedDescriptionColumn, setSelectedDescriptionColumn] = useState("");
  const [selectedRequestedQtyColumn, setSelectedRequestedQtyColumn] = useState("");
  const [selectedSupplierColumn, setSelectedSupplierColumn] = useState("");
  const [selectedSupplierQtyColumn, setSelectedSupplierQtyColumn] = useState("");
  const [selectedCurrencyColumn, setSelectedCurrencyColumn] = useState("");
  const [selectedUnitPriceColumn, setSelectedUnitPriceColumn] = useState("");
  const [selectedDiscountColumn, setSelectedDiscountColumn] = useState("");
  const [selectedTermColumn, setSelectedTermColumn] = useState("");
  const [selectedLeadTimeColumn, setSelectedLeadTimeColumn] = useState("");

  const [normalizedRows, setNormalizedRows] = useState([]);
  const [comparisonRows, setComparisonRows] = useState([]);
  const [recommendedRows, setRecommendedRows] = useState([]);

  const [exchangeRates, setExchangeRates] = useState({
    TRY: 1,
    USD: 39.2,
    EUR: 42.8,
  });

  const [message, setMessage] = useState("");

  const selectedSource = parsedSources.find(
    (item) => item.id === selectedSourceId
  );

  const columns = selectedSource?.columns || [];
  const previewRows = selectedSource?.rows?.slice(0, 8) || [];

  const handleFileUpload = (e) => {
    const uploadedFiles = Array.from(e.target.files).slice(0, 15);
    setFiles((prev) => [...prev, ...uploadedFiles].slice(0, 15));

    // geçici demo veri
    const demoSource = {
      id: "demo-1",
      fileName: uploadedFiles[0]?.name || "demo.xlsx",
      columns: [
        "urunKodu",
        "urunAciklamasi",
        "talepEdilenAdet",
        "firmaAdi",
        "firmaAdedi",
        "paraBirimi",
        "birimFiyat",
        "iskonto",
        "vade",
        "termin",
      ],
      rows: [
        {
          urunKodu: "PRD001",
          urunAciklamasi: "Kalem",
          talepEdilenAdet: 10,
          firmaAdi: "A Firması",
          firmaAdedi: 10,
          paraBirimi: "TRY",
          birimFiyat: 10,
          iskonto: 5,
          vade: "60 gün",
          termin: "Stok",
        },
        {
          urunKodu: "",
          urunAciklamasi: "Defter",
          talepEdilenAdet: 20,
          firmaAdi: "B Firması",
          firmaAdedi: 15,
          paraBirimi: "USD",
          birimFiyat: 2,
          iskonto: 10,
          vade: "45 gün",
          termin: "1 hafta",
        },
      ],
    };

    setParsedSources([demoSource]);
    setSelectedSourceId("demo-1");
    setMessage("Teklif dosyaları yüklendi.");
  };

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-800">Teklifler</h1>
        <p className="mt-2 text-sm text-slate-600">
          Excel, PDF veya görsel teklif dosyalarını yükleyin. Sistem ürünleri
          firma bazlı karşılaştırarak mukayese oluşturacaktır.
        </p>

        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6">
          <h2 className="text-lg font-semibold text-slate-800">Dosya Yükleme Alanı</h2>
          <p className="mt-1 text-sm text-slate-600">
            En fazla 15 teklif dosyası yükleyebilirsiniz.
          </p>

          <input
            type="file"
            multiple
            onChange={handleFileUpload}
            className="mt-4 block w-full rounded-xl border border-slate-300 bg-white p-3"
          />
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-800">Yüklenen Teklif Dosyaları</h2>

          {files.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Henüz dosya yüklenmedi.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700"
                >
                  {file.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-800">Teklif Analizi</h2>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Veri Kaynağı
              </label>
              <select
                value={selectedSourceId}
                onChange={(e) => setSelectedSourceId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 p-3"
              >
                <option value="">Seçiniz</option>
                {parsedSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.fileName}
                  </option>
                ))}
              </select>
            </div>

            {[
              ["Ürün kodu kolonu", selectedCodeColumn, setSelectedCodeColumn],
              ["Ürün açıklaması kolonu", selectedDescriptionColumn, setSelectedDescriptionColumn],
              ["Talep edilen adet kolonu", selectedRequestedQtyColumn, setSelectedRequestedQtyColumn],
              ["Firma adı kolonu", selectedSupplierColumn, setSelectedSupplierColumn],
              ["Firma adedi kolonu", selectedSupplierQtyColumn, setSelectedSupplierQtyColumn],
              ["Para birimi kolonu", selectedCurrencyColumn, setSelectedCurrencyColumn],
              ["Birim fiyat kolonu", selectedUnitPriceColumn, setSelectedUnitPriceColumn],
              ["İskonto kolonu", selectedDiscountColumn, setSelectedDiscountColumn],
              ["Vade kolonu", selectedTermColumn, setSelectedTermColumn],
              ["Termin kolonu", selectedLeadTimeColumn, setSelectedLeadTimeColumn],
            ].map(([label, value, setter]) => (
              <div key={label}>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  {label}
                </label>
                <select
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-3"
                >
                  <option value="">Seçiniz</option>
                  {columns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-800">Teklif Ön İzleme</h2>

          {previewRows.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Henüz ön izleme verisi yok.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col}
                        className="border border-slate-200 px-4 py-3 text-left"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i}>
                      {columns.map((col) => (
                        <td
                          key={`${i}-${col}`}
                          className="border border-slate-200 px-4 py-3"
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

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-800">Kur Bilgileri</h2>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {Object.entries(exchangeRates).map(([currency, rate]) => (
              <div key={currency}>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  {currency} Kuru
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={rate}
                  onChange={(e) =>
                    setExchangeRates((prev) => ({
                      ...prev,
                      [currency]: Number(e.target.value),
                    }))
                  }
                  className="w-full rounded-xl border border-slate-300 p-3"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-800">Mukayese Raporu</h2>
          <p className="mt-3 text-sm text-slate-500">
            Henüz mukayese raporu oluşturulmadı.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-800">
            Alınması Gereken Firma Raporu
          </h2>
          <p className="mt-3 text-sm text-slate-500">
            Henüz öneri raporu oluşturulmadı.
          </p>
        </div>

        {message && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {message}
          </div>
        )}
      </div>
    </div>
  );
}