"use client";
import { useState } from "react";

export default function TaleplerPage() {
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [reportPath, setReportPath] = useState("");
  const [rows, setRows] = useState([]);

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files));
  };

  const handleAnalyze = async () => {
    if (files.length === 0) {
      setMessage("Lütfen dosya yükleyin.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    console.log("GÖNDERİLEN DOSYALAR:", files.map((f) => f.name));

    try {
      const response = await fetch("http://127.0.0.1:8000/analyze-requests", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!data.success) {
        setMessage(data.warnings?.join(", ") || "Hata oluştu.");
        setIsLoading(false);
        return;
      }

      setRows(data.rows);
      setReportPath(data.reportPath);
      setMessage("Talep listesi oluşturuldu ✅");
    } catch (err) {
      setMessage("Backend bağlantı hatası ❌");
    }

    setIsLoading(false);
  };

  const handleDownload = () => {
    if (!reportPath) return;
    window.open(`http://127.0.0.1:8000${reportPath}`, "_blank");
  };

  const handleSendToOffers = () => {
    localStorage.setItem("talepListesi", JSON.stringify(rows));
    window.location.href = "/dashboard/teklifler";
  };

  return (
    <div className="p-6 space-y-6">

      <h1 className="text-2xl font-bold">Talepler</h1>

      {/* DOSYA YÜKLE */}
      <div className="bg-white p-4 rounded-xl shadow">
        <input type="file" multiple onChange={handleFileChange} />
      </div>

      {/* BUTONLAR */}
      <div className="flex gap-3">
        <button
          onClick={handleAnalyze}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl"
        >
          Talep Listesini Oluştur
        </button>

        <button
          onClick={handleDownload}
          disabled={!reportPath}
          className="bg-green-600 text-white px-4 py-2 rounded-xl"
        >
          Excel İndir
        </button>

        <button
          onClick={handleSendToOffers}
          disabled={rows.length === 0}
          className="bg-purple-600 text-white px-4 py-2 rounded-xl"
        >
          Tekliflere Aktar
        </button>
      </div>

      {/* MESAJ */}
      {message && <div className="text-sm">{message}</div>}

      {/* ÖNİZLEME TABLO */}
      {rows.length > 0 && (
        <div className="bg-white p-4 rounded-xl shadow">
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-gray-200">
                <th>Sıra</th>
                <th>Kod</th>
                <th>Açıklama</th>
                <th>Adet</th>
                <th>Birim</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{r.urunKodu}</td>
                  <td>{r.urunAciklamasi}</td>
                  <td>{r.talepEdilenAdet}</td>
                  <td>{r.birim}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}